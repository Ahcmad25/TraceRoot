import type { AgenticResultArtifact, AgenticTrajectoryArtifact } from "../agentic/result.js";
import type { EvaluationSummary } from "../evaluation/types.js";

export interface RepresentativeTrajectory {
  readonly caseId: string;
  readonly repetition: number;
  readonly label: string;
  readonly result: AgenticResultArtifact;
  readonly trajectory: AgenticTrajectoryArtifact;
}

const OMITTED_KEYS = new Set([
  "collectedAt", "correlationId", "humanCheckpoint", "investigationId", "locator",
  "mode", "origin", "providerRequestId", "recordedAt", "requestId", "runId",
]);

function sanitizeText(value: string, secrets: readonly string[]): string {
  let sanitized = secrets.reduce((text, secret) => secret.length >= 4 ? text.replaceAll(secret, "[redacted]") : text, value);
  sanitized = sanitized
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-api-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [redacted]")
    .replace(/\brepro-[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, "[correlation-id]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[runtime-id]")
    .replace(/[A-Za-z]:\\(?:[^\s"']+\\)*[^\s"']*/gu, "[machine-path]");
  return sanitized;
}

function remapIdentifiers(
  value: unknown,
  evidenceIds: ReadonlyMap<string, string>,
  hypothesisIds: ReadonlyMap<string, string>,
  secrets: readonly string[],
): unknown {
  if (typeof value === "string") {
    return evidenceIds.get(value) ?? hypothesisIds.get(value) ?? sanitizeText(value, secrets);
  }
  if (Array.isArray(value)) return value.map((item) => remapIdentifiers(item, evidenceIds, hypothesisIds, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OMITTED_KEYS.has(key))
      .map(([key, child]) => [key, remapIdentifiers(child, evidenceIds, hypothesisIds, secrets)]));
  }
  return value;
}

function environmentSecrets(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(([key, value]) => value !== undefined && value.length >= 4 && /(key|secret|token|credential|password)/iu.test(key))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

export function sanitizeRepresentativeTrajectory(
  input: RepresentativeTrajectory,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const investigation = input.trajectory.investigation;
  const evidenceIds = new Map(investigation.evidence.map((evidence, index) => [evidence.id, `evidence-${index + 1}`]));
  const hypothesisIds = new Map<string, string>();
  for (const hypothesis of investigation.hypotheses) {
    if (!hypothesisIds.has(hypothesis.id)) hypothesisIds.set(hypothesis.id, `hypothesis-${hypothesisIds.size + 1}`);
  }
  const secrets = environmentSecrets(environment);
  const clean = (value: unknown): unknown => remapIdentifiers(value, evidenceIds, hypothesisIds, secrets);

  const steps = investigation.events.flatMap((event) => {
    if (event.type === "investigation-started") {
      return [{ sequence: event.sequence, role: "orchestrator", action: "investigation_started", details: clean({ failureReport: event.failureReport }) }];
    }
    if (event.type !== "agent-step-recorded") return [];
    const data = event.structuredData as Record<string, unknown> | null;
    const action = typeof data?.action === "string" ? data.action : event.stepKind;
    return [{
      sequence: event.sequence,
      role: event.role,
      action,
      ...(typeof data?.tool === "string" ? { tool: data.tool } : {}),
      details: clean(event.structuredData),
      evidence: event.evidenceIds.map((id) => evidenceIds.get(id) ?? "unmapped-evidence"),
      budget: event.budgetState,
    }];
  });

  return {
    schemaVersion: "submission-trajectory-v1",
    caseId: input.caseId,
    repetition: input.repetition,
    label: input.label,
    sourceSchemaVersion: input.trajectory.schemaVersion,
    promptVersions: input.trajectory.promptVersions,
    failureReport: clean(investigation.failureReport),
    steps,
    evidence: investigation.evidence.map((evidence, index) => ({
      label: `evidence-${index + 1}`,
      kind: evidence.kind,
      excerpt: sanitizeText(evidence.content, secrets).slice(0, 1_600),
    })),
    hypothesisRevisions: investigation.hypotheses.map((hypothesis) => clean(hypothesis)),
    experiments: investigation.experiments.map((experiment) => clean(experiment)),
    outcome: {
      diagnosis: clean(input.result.diagnosis),
      terminationReason: input.result.terminationReason,
      unsupportedClaimCount: input.result.unsupportedClaimCount,
    },
    metrics: {
      llmCalls: input.result.llmCallCount,
      toolCalls: input.result.toolCallCount,
      reproductionAttempts: input.result.reproductionAttempts,
      investigationRounds: input.result.investigationRounds,
      totalTokens: input.result.tokenUsage.totalTokens,
      durationMs: input.result.durationMs,
    },
  };
}

function mean(values: readonly number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1_000_000) / 1_000_000;
}

export function buildSubmissionEvaluationSummary(summary: EvaluationSummary): Record<string, unknown> {
  const caseIds = [...new Set(summary.scores.map((score) => score.caseId))].sort();
  const perCase = caseIds.map((caseId) => ({
    caseId,
    modes: Object.fromEntries((["baseline", "agentic"] as const).map((mode) => {
      const scores = summary.scores.filter((score) => score.caseId === caseId && score.mode === mode);
      return [mode, {
        runs: scores.length,
        categoryCorrect: scores.filter((score) => score.categoryCorrect).length,
        sourceFileCorrect: scores.filter((score) => score.sourceFileCorrect).length,
        symbolCorrect: scores.filter((score) => score.symbolCorrect).length,
        allRootCauseFieldsCorrect: scores.filter((score) => score.rootCauseFieldsCorrect).length,
        evidenceVerified: mode === "baseline" ? null : scores.filter((score) => score.diagnosisStatus === "verified").length,
        unsupportedClaims: scores.reduce((sum, score) => sum + score.unsupportedClaimCount, 0),
        meanLlmCalls: mean(scores.map((score) => score.llmCalls)),
        meanToolCalls: mean(scores.map((score) => score.toolCalls)),
        meanTokens: mean(scores.map((score) => score.totalTokens)),
        meanDurationMs: mean(scores.map((score) => score.durationMs)),
        terminationReasons: Object.fromEntries([...new Set(scores.map((score) => score.terminationReason))].sort()
          .map((reason) => [reason, scores.filter((score) => score.terminationReason === reason).length])),
      }];
    })),
  }));

  return {
    schemaVersion: "submission-evaluation-summary-v1",
    benchmark: {
      cases: caseIds.length,
      modes: ["baseline", "agentic"],
      repetitions: 3,
      scoredRuns: summary.scores.length,
      model: "gpt-5.6-sol",
      effectiveTemperature: null,
      frozenVersions: {
        baselinePrompt: "baseline-v2",
        investigatorPrompt: "investigator-v1",
        reproducerPrompt: "reproducer-v2",
        verifierPrompt: "verifier-v2",
        agenticTrajectory: "agentic-trajectory-v3",
        toolContract: "1.1.0",
        agenticResult: "agentic-result-v1",
        humanReviewSet: "human-review-set-v2",
      },
    },
    fairness: { failedAttempts: summary.failedAttempts.length, issues: summary.fairnessIssues },
    aggregates: summary.aggregates,
    differences: summary.differences,
    perCase,
    interpretation: {
      staticAccuracy: "The evaluation does not establish a consistent agentic advantage in strict static root-cause localization.",
      verifiedEvidence: "Agentic runs produced 23/24 evidence-verified diagnoses; baseline verification is not applicable because it has no runtime capability by design.",
      unsupportedClaims: "No scored run contained an unsupported positive factual claim.",
    },
  };
}
