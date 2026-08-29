import { performance } from "node:perf_hooks";
import type { z } from "zod";
import type { CaseArtifacts } from "../artifacts/types.js";
import type { Diagnosis } from "../domain/diagnosis.js";
import { InvestigationJournal } from "../domain/investigation-journal.js";
import type { Evidence, Hypothesis } from "../domain/investigation.js";
import { generateStructured } from "../llm/client.js";
import type { LlmConfiguration, LlmProvider, StructuredLlmResult, TokenUsage } from "../llm/types.js";
import type { ToolName, ToolResult } from "../tools/contracts.js";
import type { ExecuteReproductionData } from "../tools/execute-reproduction.js";
import { roleMessages, INVESTIGATOR_PROMPT_VERSION, REPRODUCER_PROMPT_VERSION, VERIFIER_PROMPT_VERSION } from "./prompts.js";
import {
  agentHypothesisSchema,
  investigatorProviderResponseSchema,
  reproducerProviderResponseSchema,
  verifierDecisionSchema,
  INVESTIGATOR_JSON_SCHEMA,
  REPRODUCER_JSON_SCHEMA,
  VERIFIER_JSON_SCHEMA,
  type AgentHypothesis,
  type InvestigatorDecision,
  type ReproducerDecision,
  type VerifierDecision,
} from "./schemas.js";
import type { AgenticTools } from "./toolset.js";

export interface AgenticLimits {
  readonly investigationRounds: number;
  readonly activeHypotheses: number;
  readonly reproductionAttempts: number;
  readonly totalToolCalls: number;
  readonly maxLlmCalls: number;
  readonly maxTotalTokens: number;
  readonly maxWallClockMs: number;
}

export const DEFAULT_AGENTIC_LIMITS: AgenticLimits = Object.freeze({
  investigationRounds: 2,
  activeHypotheses: 3,
  reproductionAttempts: 3,
  totalToolCalls: 12,
  maxLlmCalls: 20,
  maxTotalTokens: 100_000,
  maxWallClockMs: 120_000,
});

export interface AgenticRunResult {
  readonly diagnosis: Diagnosis;
  readonly terminationReason: string;
  readonly unsupportedClaimCount: number;
  readonly unsupportedReferences: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly metrics: {
    readonly llmCalls: number;
    readonly tokenUsage: TokenUsage;
    readonly toolCalls: Readonly<Record<ToolName, number>>;
    readonly totalToolCalls: number;
    readonly investigationRounds: number;
    readonly reproductionAttempts: number;
    readonly durationMs: number;
  };
  readonly promptVersions: {
    readonly investigator: string;
    readonly reproducer: string;
    readonly verifier: string;
  };
  readonly trajectory: ReturnType<InvestigationJournal["snapshot"]>;
}

interface MutableState {
  rounds: number;
  llmCalls: number;
  tokens: TokenUsage;
  reproductionAttempts: number;
  toolCounts: Record<ToolName, number>;
  hypotheses: Map<string, Hypothesis>;
  unsupported: Set<string>;
  unsupportedClaims: Set<string>;
  verifierLimitations: Set<string>;
  verifierFeedback: string | null;
  runtimePolicyFeedback: string | null;
  policyCorrectionCount: number;
  lastReproduction: { hypothesisId: string; data: ExecuteReproductionData; evidenceIds: string[] } | null;
}

type InvestigatorAction = InvestigatorDecision["action"];

interface InvestigatorRuntimeState {
  readonly budget: {
    readonly investigationRoundsUsed: number;
    readonly investigationRoundsMax: number;
    readonly investigationRoundsRemaining: number;
    readonly activeHypothesesUsed: number;
    readonly activeHypothesesMax: number;
    readonly reproductionAttemptsUsed: number;
    readonly reproductionAttemptsMax: number;
    readonly reproductionAttemptsRemaining: number;
    readonly toolCallsUsed: number;
    readonly toolCallsMax: number;
    readonly toolCallsRemaining: number;
    readonly llmCallsUsed: number;
    readonly llmCallsMax: number;
    readonly totalTokensUsed: number;
    readonly totalTokensMax: number;
  };
  readonly activeHypothesisIds: readonly string[];
  readonly reproductionAllowed: boolean;
  readonly allowedNextActions: readonly InvestigatorAction[];
}

function clampLimits(input: Partial<AgenticLimits> = {}): AgenticLimits {
  const positive = (value: number | undefined, fallback: number, hardMax?: number) =>
    Math.max(1, Math.min(value ?? fallback, hardMax ?? Number.MAX_SAFE_INTEGER));
  return {
    investigationRounds: positive(input.investigationRounds, 2, 2),
    activeHypotheses: positive(input.activeHypotheses, 3, 3),
    reproductionAttempts: positive(input.reproductionAttempts, 3, 3),
    totalToolCalls: positive(input.totalToolCalls, 12, 12),
    maxLlmCalls: positive(input.maxLlmCalls, 20),
    maxTotalTokens: positive(input.maxTotalTokens, 100_000),
    maxWallClockMs: positive(input.maxWallClockMs, 120_000),
  };
}

function totalTools(state: MutableState): number {
  return Object.values(state.toolCounts).reduce((sum, value) => sum + value, 0);
}

function budgets(state: MutableState): Record<string, number> {
  return {
    investigationRounds: state.rounds,
    activeHypotheses: state.hypotheses.size,
    reproductionAttempts: state.reproductionAttempts,
    totalToolCalls: totalTools(state),
    llmCalls: state.llmCalls,
    totalTokens: state.tokens.totalTokens,
  };
}

function investigatorRuntimeState(state: MutableState, limits: AgenticLimits): InvestigatorRuntimeState {
  const toolCallsUsed = totalTools(state);
  const activeHypothesisIds = [...state.hypotheses.keys()];
  const toolBudgetAvailable = toolCallsUsed < limits.totalToolCalls;
  const reproductionAllowed = activeHypothesisIds.length > 0
    && state.reproductionAttempts < limits.reproductionAttempts
    && toolBudgetAvailable
    && state.llmCalls < limits.maxLlmCalls
    && state.tokens.totalTokens < limits.maxTotalTokens;
  const allowedNextActions: InvestigatorAction[] = [];
  if (toolBudgetAvailable) {
    allowedNextActions.push("search_source", "read_source", "search_logs");
  }
  if (state.hypotheses.size < limits.activeHypotheses) {
    allowedNextActions.push("propose_hypotheses");
  }
  if (reproductionAllowed) {
    allowedNextActions.push("request_reproduction");
  }
  allowedNextActions.push("finish_inconclusive");
  return Object.freeze({
    budget: Object.freeze({
      investigationRoundsUsed: state.rounds,
      investigationRoundsMax: limits.investigationRounds,
      investigationRoundsRemaining: Math.max(0, limits.investigationRounds - state.rounds),
      activeHypothesesUsed: state.hypotheses.size,
      activeHypothesesMax: limits.activeHypotheses,
      reproductionAttemptsUsed: state.reproductionAttempts,
      reproductionAttemptsMax: limits.reproductionAttempts,
      reproductionAttemptsRemaining: Math.max(0, limits.reproductionAttempts - state.reproductionAttempts),
      toolCallsUsed,
      toolCallsMax: limits.totalToolCalls,
      toolCallsRemaining: Math.max(0, limits.totalToolCalls - toolCallsUsed),
      llmCallsUsed: state.llmCalls,
      llmCallsMax: limits.maxLlmCalls,
      totalTokensUsed: state.tokens.totalTokens,
      totalTokensMax: limits.maxTotalTokens,
    }),
    activeHypothesisIds: Object.freeze(activeHypothesisIds),
    reproductionAllowed,
    allowedNextActions: Object.freeze(allowedNextActions),
  });
}

function falseBudgetExhaustionClaims(decision: Extract<InvestigatorDecision, { action: "finish_inconclusive" }>, runtime: InvestigatorRuntimeState): string[] {
  const claim = `${decision.arguments.explanation} ${decision.reason}`;
  const falseClaims: string[] = [];
  const claimsInvestigationExhausted = /(?:investigation|rounds?)(?:\s+and\s+\w+)?\s+budgets?\s+(?:is|are|was|were|has been|have been)?\s*exhausted/iu.test(claim);
  const claimsToolsExhausted = /tool(?:\s+calls?)?\s+budgets?\s+(?:is|are|was|were|has been|have been)?\s*exhausted/iu.test(claim)
    || /no\s+(?:more\s+)?tool\s+calls?\s+(?:are\s+)?(?:available|remaining|left)/iu.test(claim);
  const claimsReproductionExhausted = /reproduction(?:\s+attempts?)?\s+budgets?\s+(?:is|are|was|were|has been|have been)?\s*exhausted/iu.test(claim)
    || /no\s+(?:more\s+)?reproduction\s+attempts?\s+(?:are\s+)?(?:available|remaining|left)/iu.test(claim);
  const claimsAllBudgetsExhausted = /\b(?:all|the)\s+budgets?\s+(?:is|are|was|were|has been|have been)?\s*exhausted/iu.test(claim);
  if (claimsInvestigationExhausted && runtime.budget.investigationRoundsRemaining > 0) falseClaims.push("investigation_rounds");
  if (claimsToolsExhausted && runtime.budget.toolCallsRemaining > 0) falseClaims.push("tool_calls");
  if (claimsReproductionExhausted && runtime.budget.reproductionAttemptsRemaining > 0) falseClaims.push("reproduction_attempts");
  if (claimsAllBudgetsExhausted && runtime.allowedNextActions.some((action) => action !== "finish_inconclusive")) falseClaims.push("all_budgets");
  return [...new Set(falseClaims)];
}

function usagePlus(current: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  return usage === undefined ? current : {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    totalTokens: current.totalTokens + usage.totalTokens,
  };
}

function evidenceIds(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = Array.isArray(record.evidenceIds) ? record.evidenceIds.filter((id): id is string => typeof id === "string") : [];
  const hypotheses = Array.isArray((record.arguments as Record<string, unknown> | undefined)?.hypotheses)
    ? ((record.arguments as Record<string, unknown>).hypotheses as Array<Record<string, unknown>>)
      .flatMap((hypothesis) => [hypothesis.supportingEvidenceIds, hypothesis.contradictingEvidenceIds])
      .flatMap((ids) => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [])
    : [];
  return [...new Set([...direct, ...hypotheses])];
}

function sanitizeForJournal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForJournal);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      /(authorization|cookie|api.?key|token|secret|password|credential)/iu.test(key) ? "[REDACTED]" : sanitizeForJournal(child),
    ]));
  }
  return value;
}

export async function runAgenticInvestigation(input: {
  readonly investigationId: string;
  readonly artifacts: CaseArtifacts;
  readonly provider: LlmProvider;
  readonly configuration: LlmConfiguration;
  readonly tools: AgenticTools;
  readonly limits?: Partial<AgenticLimits>;
  readonly clock?: () => Date;
}): Promise<AgenticRunResult> {
  const started = performance.now();
  const clock = input.clock ?? (() => new Date());
  const limits = clampLimits(input.limits);
  const journal = new InvestigationJournal({
    investigationId: input.investigationId,
    caseId: input.artifacts.caseId,
    mode: "agentic",
    failureReport: input.artifacts.manifest.failureReport,
    clock,
  });
  journal.recordEvidence({
    id: "evidence-report",
    kind: "report",
    origin: "artifact-loader",
    locator: `report:${input.artifacts.caseId}`,
    content: JSON.stringify(input.artifacts.manifest.failureReport),
    collectedAt: clock().toISOString(),
  });
  const state: MutableState = {
    rounds: 1,
    llmCalls: 0,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    reproductionAttempts: 0,
    toolCounts: { search_source: 0, read_source: 0, search_logs: 0, execute_reproduction: 0 },
    hypotheses: new Map(),
    unsupported: new Set(),
    unsupportedClaims: new Set(),
    verifierLimitations: new Set(),
    verifierFeedback: null,
    runtimePolicyFeedback: null,
    policyCorrectionCount: 0,
    lastReproduction: null,
  };

  const knownEvidence = () => new Set(journal.snapshot().evidence.map((evidence) => evidence.id));
  const recordStep = (
    role: "orchestrator" | "investigator" | "reproducer" | "verifier",
    promptVersion: string | null,
    stepKind: "role-decision" | "tool-invocation" | "tool-result" | "hypothesis-change" | "reproduction-result" | "verifier-feedback" | "termination",
    structuredData: unknown,
    ids: readonly string[] = [],
  ) => journal.recordAgentStep({
    role,
    promptVersion,
    stepKind,
    structuredData,
    evidenceIds: ids.filter((id) => knownEvidence().has(id)),
    budgetState: budgets(state),
    humanCheckpoint: null,
  });
  const context = (extra: unknown = {}) => ({
    caseId: input.artifacts.caseId,
    failureReport: input.artifacts.manifest.failureReport,
    artifactInventory: {
      sources: input.artifacts.sources.map(({ path, sha256 }) => ({ path, sha256 })),
      logs: input.artifacts.logs.map(({ path, sha256 }) => ({ path, sha256 })),
      aggregateHash: input.artifacts.hashes.aggregate,
    },
    evidence: journal.snapshot().evidence.map(({ id, kind, locator, content }) => ({ id, kind, locator, content: content.slice(0, 8_000) })),
    recentSteps: journal.snapshot().events
      .filter((event) => event.type === "agent-step-recorded")
      .slice(-12)
      .map(({ role, stepKind, structuredData, evidenceIds: ids }) => ({ role, stepKind, structuredData, evidenceIds: ids })),
    hypotheses: [...state.hypotheses.values()],
    verifierFeedback: state.verifierFeedback,
    runtimePolicyFeedback: state.runtimePolicyFeedback,
    runtimeState: investigatorRuntimeState(state, limits),
    ...extra as Record<string, unknown>,
  });
  const budgetStop = (): string | null => {
    if (performance.now() - started >= limits.maxWallClockMs) return "wall_clock_budget_exhausted";
    if (state.llmCalls >= limits.maxLlmCalls) return "llm_call_budget_exhausted";
    if (state.tokens.totalTokens >= limits.maxTotalTokens) return "token_budget_exhausted";
    return null;
  };
  const callRole = async <T>(
    role: "investigator" | "reproducer" | "verifier",
    version: string,
    schemaName: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    jsonSchema: Readonly<Record<string, unknown>>,
    roleContext: () => unknown,
  ): Promise<StructuredLlmResult<T> | null> => {
    if (budgetStop() !== null) return null;
    state.llmCalls += 1;
    const result = await generateStructured<T>(input.provider, {
      configuration: input.configuration,
      messages: roleMessages(role, roleContext()),
      responseSchemaName: schemaName,
      responseSchema: schema,
      responseJsonSchema: jsonSchema,
    });
    state.tokens = usagePlus(state.tokens, result.usage);
    if (result.ok) {
      const refs = evidenceIds(result.value);
      for (const ref of refs) if (!knownEvidence().has(ref)) state.unsupported.add(ref);
      recordStep(role, version, "role-decision", sanitizeForJournal(result.value), refs);
    } else {
      recordStep(role, version, "role-decision", {
        error: result.error.code,
        message: result.error.message,
        ...(result.error.providerCode === undefined ? {} : { providerCode: result.error.providerCode }),
        ...(result.error.validationDiagnostic === undefined ? {} : { validationDiagnostic: result.error.validationDiagnostic }),
      });
    }
    return result;
  };
  const ingestToolResult = <T>(tool: ToolName, result: ToolResult<T>, invocation: unknown): string[] => {
    state.toolCounts[tool] += 1;
    recordStep("orchestrator", null, "tool-invocation", { tool, arguments: invocation });
    if (!result.ok) {
      recordStep("orchestrator", null, "tool-result", { tool, ok: false, error: result.error, durationMs: result.durationMs });
      return [];
    }
    for (const evidence of result.evidence) journal.recordEvidence(evidence);
    const ids = result.evidence.map((evidence) => evidence.id);
    recordStep("orchestrator", null, "tool-result", {
      tool, ok: true, truncated: result.truncated, durationMs: result.durationMs,
    }, ids);
    return ids;
  };

  let terminationReason = "evidence_insufficient";
  let finalDiagnosis: Diagnosis | null = null;
  main: while (finalDiagnosis === null) {
    const stop = budgetStop();
    if (stop !== null) { terminationReason = stop; break; }
    const investigator = await callRole<InvestigatorDecision>(
      "investigator", INVESTIGATOR_PROMPT_VERSION, "traceroot_investigator_decision",
      investigatorProviderResponseSchema, INVESTIGATOR_JSON_SCHEMA, () => context(),
    );
    if (investigator === null) { terminationReason = budgetStop() ?? "llm_budget_exhausted"; break; }
    if (!investigator.ok) {
      terminationReason = investigator.error.code === "INVALID_JSON"
        ? "invalid_json"
        : investigator.error.code === "INVALID_STRUCTURED_OUTPUT" ? "invalid_structured_output" : "provider_error";
      break;
    }
    const decision = investigator.value;
    if (decision.action !== "finish_inconclusive") state.runtimePolicyFeedback = null;

    if (decision.action === "search_source" || decision.action === "read_source" || decision.action === "search_logs") {
      if (totalTools(state) >= limits.totalToolCalls) { terminationReason = "tool_budget_exhausted"; break; }
      if (decision.action === "search_source") {
        ingestToolResult("search_source", await input.tools.searchSource(decision.arguments), decision.arguments);
      } else if (decision.action === "read_source") {
        ingestToolResult("read_source", await input.tools.readSource(decision.arguments), decision.arguments);
      } else {
        ingestToolResult("search_logs", await input.tools.searchLogs(decision.arguments), decision.arguments);
      }
      continue;
    }
    if (decision.action === "propose_hypotheses") {
      const next = new Map(state.hypotheses);
      let valid = true;
      const accepted: Hypothesis[] = [];
      for (const candidate of decision.arguments.hypotheses) {
        const refs = [...candidate.supportingEvidenceIds, ...candidate.contradictingEvidenceIds];
        for (const ref of refs) if (!knownEvidence().has(ref)) { state.unsupported.add(ref); valid = false; }
        const parsed = agentHypothesisSchema.safeParse(candidate);
        if (!parsed.success) valid = false;
        if (valid) {
          const hypothesis: Hypothesis = {
            id: candidate.id, statement: candidate.statement, faultCategory: candidate.faultCategory,
            suspectedSourceFile: candidate.suspectedFile, suspectedSymbol: candidate.suspectedSymbol,
            mechanism: candidate.mechanism, verificationPlan: candidate.verificationPlan,
            supportingEvidenceIds: candidate.supportingEvidenceIds,
            contradictingEvidenceIds: candidate.contradictingEvidenceIds,
            confidence: candidate.confidence, status: "proposed",
          };
          next.set(candidate.id, hypothesis);
          accepted.push(hypothesis);
        }
      }
      if (!valid || next.size > limits.activeHypotheses) { terminationReason = next.size > limits.activeHypotheses ? "hypothesis_budget_exhausted" : "unsupported_hypothesis_evidence"; break; }
      for (const hypothesis of accepted) journal.recordHypothesis(hypothesis);
      state.hypotheses = next;
      recordStep("orchestrator", null, "hypothesis-change", { activeHypothesisIds: [...next.keys()] });
      continue;
    }
    if (decision.action === "finish_inconclusive") {
      const runtime = investigatorRuntimeState(state, limits);
      const falseClaims = falseBudgetExhaustionClaims(decision, runtime);
      if (falseClaims.length > 0) {
        if (state.policyCorrectionCount >= 1) { terminationReason = "false_budget_exhaustion_claim"; break; }
        state.policyCorrectionCount += 1;
        state.runtimePolicyFeedback = `The previous finish_inconclusive action incorrectly claimed these budgets were exhausted: ${falseClaims.join(", ")}. Use runtimeState as authoritative and choose only from allowedNextActions.`;
        continue;
      }
      terminationReason = "investigator_finished_inconclusive";
      break;
    }
    const hypothesis = state.hypotheses.get(decision.arguments.hypothesisId);
    if (hypothesis === undefined) { terminationReason = "invalid_investigator_action"; break; }
    if (state.reproductionAttempts >= limits.reproductionAttempts) { terminationReason = "reproduction_budget_exhausted"; break; }
    const reproducer = await callRole<ReproducerDecision>(
      "reproducer", REPRODUCER_PROMPT_VERSION, "traceroot_reproducer_decision",
      reproducerProviderResponseSchema, REPRODUCER_JSON_SCHEMA, () => context({ hypothesis }),
    );
    if (reproducer === null) { terminationReason = budgetStop() ?? "llm_budget_exhausted"; break; }
    if (!reproducer.ok) {
      terminationReason = reproducer.error.code === "INVALID_JSON"
        ? "invalid_json"
        : reproducer.error.code === "INVALID_STRUCTURED_OUTPUT" ? "invalid_structured_output" : "provider_error";
      break;
    }
    if (reproducer.value.hypothesisId !== hypothesis.id) { terminationReason = "invalid_reproducer_action"; break; }
    const experiment = reproducer.value;
    const sensitiveHeader = Object.keys(experiment.request.headers ?? {}).find((name) => /(authorization|cookie|api.?key|token|secret)/iu.test(name));
    if (experiment.request.path.startsWith("/__control") || sensitiveHeader !== undefined) { terminationReason = "forbidden_reproduction_request"; break; }
    if (totalTools(state) >= limits.totalToolCalls) { terminationReason = "tool_budget_exhausted"; break; }
    state.reproductionAttempts += 1;
    const reproductionRequest = experiment.request.body === null
      ? { ...experiment.request, body: undefined }
      : experiment.request;
    const expectations = {
      required: {
        method: input.artifacts.manifest.failureReport.method,
        path: input.artifacts.manifest.failureReport.endpoint,
        status: input.artifacts.manifest.failureReport.observedStatus,
        bodyContains: input.artifacts.manifest.failureReport.observedError,
      },
      supporting: { logContains: experiment.expected.supporting.logContains },
    };
    const reproductionResult = await input.tools.executeReproduction({ request: reproductionRequest, expectations });
    const reproductionEvidence = ingestToolResult("execute_reproduction", reproductionResult, {
      request: reproductionRequest, expectations,
    });
    if (!reproductionResult.ok) { terminationReason = "reproduction_tool_failed"; break; }
    state.lastReproduction = { hypothesisId: hypothesis.id, data: reproductionResult.data, evidenceIds: reproductionEvidence };
    const testedHypothesis: Hypothesis = { ...hypothesis, status: "tested" };
    state.hypotheses.set(hypothesis.id, testedHypothesis);
    journal.recordHypothesis(testedHypothesis);
    journal.recordExperiment({
      id: `experiment-${state.reproductionAttempts}`, hypothesisId: hypothesis.id, request: reproductionRequest,
      expectedObservation: JSON.stringify(expectations), actualObservation: JSON.stringify(reproductionResult.data.response),
      evidenceIds: reproductionEvidence, outcome: reproductionResult.data.outcome,
    });
    recordStep("orchestrator", null, "reproduction-result", {
      hypothesisId: hypothesis.id, outcome: reproductionResult.data.outcome,
      correlationId: reproductionResult.data.correlationId,
    }, reproductionEvidence);

    const verifier = await callRole<VerifierDecision>(
      "verifier", VERIFIER_PROMPT_VERSION, "traceroot_verifier_decision",
      verifierDecisionSchema, VERIFIER_JSON_SCHEMA,
      () => context({ hypothesis, reproduction: reproductionResult.data }),
    );
    if (verifier === null) { terminationReason = budgetStop() ?? "llm_budget_exhausted"; break; }
    if (!verifier.ok) {
      terminationReason = verifier.error.code === "INVALID_JSON"
        ? "invalid_json"
        : verifier.error.code === "INVALID_STRUCTURED_OUTPUT" ? "invalid_structured_output" : "provider_error";
      break;
    }
    if (verifier.value.hypothesisId !== hypothesis.id) { terminationReason = "invalid_verifier_output"; break; }
    const verdict = verifier.value;
    for (const ref of verdict.evidenceIds) if (!knownEvidence().has(ref)) state.unsupported.add(ref);
    for (const claim of verdict.unsupportedClaims) state.unsupportedClaims.add(claim);
    for (const limitation of verdict.limitations) state.verifierLimitations.add(limitation);
    recordStep("verifier", VERIFIER_PROMPT_VERSION, "verifier-feedback", verdict, verdict.evidenceIds);
    if (verdict.outcome === "verified") {
      const evidence = journal.snapshot().evidence;
      const cited = new Set(verdict.evidenceIds);
      const prerequisites = hypothesis.supportingEvidenceIds.some((id) => evidence.some((item) => item.id === id && item.kind === "source"))
        && reproductionResult.data.outcome === "reproduced"
        && reproductionEvidence.some((id) => evidence.some((item) => item.id === id && item.kind === "http"))
        && reproductionEvidence.every((id) => cited.has(id))
        && verdict.evidenceIds.every((id) => knownEvidence().has(id))
        && verdict.unsupportedClaims.length === 0;
      if (!prerequisites) { terminationReason = "verification_prerequisites_failed"; break; }
      const supportedHypothesis: Hypothesis = { ...hypothesis, status: "supported" };
      state.hypotheses.set(hypothesis.id, supportedHypothesis);
      journal.recordHypothesis(supportedHypothesis);
      recordStep("orchestrator", null, "hypothesis-change", { hypothesisId: hypothesis.id, status: "supported" }, verdict.evidenceIds);
      finalDiagnosis = {
        status: "verified", category: hypothesis.faultCategory,
        sourceFile: hypothesis.suspectedSourceFile, symbol: hypothesis.suspectedSymbol,
        causalMechanism: hypothesis.mechanism, explanation: verdict.explanation,
        confidence: hypothesis.confidence, evidenceIds: verdict.evidenceIds,
        reproductionSummary: `Reproduced with ${reproductionResult.data.correlationId}; observed failure signature matched.`,
        limitations: verdict.limitations,
      };
      terminationReason = "verified";
      break main;
    }
    if (verdict.outcome === "contradiction") {
      const rejectedHypothesis: Hypothesis = { ...hypothesis, status: "rejected" };
      state.hypotheses.delete(hypothesis.id);
      journal.recordHypothesis(rejectedHypothesis);
      recordStep("orchestrator", null, "hypothesis-change", { hypothesisId: hypothesis.id, status: "rejected" }, verdict.evidenceIds);
      state.verifierFeedback = verdict.explanation;
      continue;
    }
    if (state.rounds >= limits.investigationRounds) { terminationReason = "evidence_insufficient_after_max_rounds"; break; }
    state.rounds += 1;
    state.verifierFeedback = verdict.missingEvidenceRequest ?? verdict.explanation;
  }

  if (finalDiagnosis === null) {
    const candidate = [...state.hypotheses.values()].find((item) => item.status !== "rejected");
    finalDiagnosis = candidate === undefined ? {
      status: "inconclusive", category: "unknown", sourceFile: "unknown", symbol: "unknown",
      causalMechanism: "Available evidence is insufficient to identify a root cause.",
      explanation: "TraceRoot terminated without enough supported evidence for a diagnosis.", confidence: 0,
      evidenceIds: ["evidence-report"], reproductionSummary: "No verified reproduction established root cause.",
      limitations: [...state.verifierLimitations, terminationReason],
    } : {
      status: "unverified", category: candidate.faultCategory,
      sourceFile: candidate.suspectedSourceFile, symbol: candidate.suspectedSymbol,
      causalMechanism: candidate.mechanism,
      explanation: "A causal hypothesis was formed but did not satisfy verification prerequisites.",
      confidence: candidate.confidence,
      evidenceIds: candidate.supportingEvidenceIds.filter((id) => knownEvidence().has(id)),
      reproductionSummary: state.lastReproduction === null ? "No reproduction completed." : `Last outcome: ${state.lastReproduction.data.outcome}.`,
      limitations: [...state.verifierLimitations, terminationReason],
    };
  }
  recordStep("orchestrator", null, "termination", { reason: terminationReason, finalStatus: finalDiagnosis.status }, finalDiagnosis.evidenceIds);
  journal.recordDiagnosis(finalDiagnosis);
  return Object.freeze({
    diagnosis: finalDiagnosis,
    terminationReason,
    unsupportedClaimCount: state.unsupported.size + state.unsupportedClaims.size,
    unsupportedReferences: Object.freeze([...state.unsupported]),
    unsupportedClaims: Object.freeze([...state.unsupportedClaims]),
    metrics: Object.freeze({
      llmCalls: state.llmCalls, tokenUsage: state.tokens,
      toolCalls: Object.freeze({ ...state.toolCounts }), totalToolCalls: totalTools(state),
      investigationRounds: state.rounds, reproductionAttempts: state.reproductionAttempts,
      durationMs: Math.round((performance.now() - started) * 1_000) / 1_000,
    }),
    promptVersions: Object.freeze({
      investigator: INVESTIGATOR_PROMPT_VERSION,
      reproducer: REPRODUCER_PROMPT_VERSION,
      verifier: VERIFIER_PROMPT_VERSION,
    }),
    trajectory: journal.snapshot(),
  });
}
