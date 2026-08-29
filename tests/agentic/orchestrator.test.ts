import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ArtifactLoader } from "../../src/artifacts/loader.js";
import type { CaseArtifacts } from "../../src/artifacts/types.js";
import { runAgenticInvestigation, type AgenticLimits } from "../../src/agentic/orchestrator.js";
import type { AgenticTools } from "../../src/agentic/toolset.js";
import type { Evidence, ReproductionRequest } from "../../src/domain/investigation.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { LlmProviderError, type RawLlmResponse } from "../../src/llm/types.js";
import type { ExecuteReproductionData, ReproductionExpectations } from "../../src/tools/execute-reproduction.js";
import type { ReadSourceData } from "../../src/tools/read-source.js";
import type { SearchLogsData } from "../../src/tools/search-logs.js";
import type { SearchSourceData } from "../../src/tools/search-source.js";
import { TOOL_VERSION, type ToolName, type ToolResult } from "../../src/tools/contracts.js";

const workspaceRoot = resolve(process.cwd());
const configuration = { modelId: "fake-agentic", temperature: 0, timeoutMs: 5_000 } as const;
const at = "2026-01-01T00:00:00.000Z";
let artifacts: CaseArtifacts;

beforeAll(async () => {
  const loaded = await new ArtifactLoader(workspaceRoot).load("case-001");
  if (!loaded.ok) throw new Error(loaded.error.message);
  artifacts = loaded.artifacts;
});

function response(output: unknown): RawLlmResponse {
  return { output, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, providerRequestId: "fake-request" };
}

function hypothesis(id: string, evidenceIds: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    statement: `Hypothesis ${id}`,
    faultCategory: "input-validation",
    suspectedFile: "src/target-api/services/user-service.ts",
    suspectedSymbol: "registerUser",
    mechanism: "An unchecked optional value is dereferenced before persistence.",
    supportingEvidenceIds: [...evidenceIds],
    contradictingEvidenceIds: [],
    confidence: 0.8,
    verificationPlan: "Send the smallest request that omits the optional value and compare the failure signature.",
    ...overrides,
  };
}

const search = (query = "registerUser") => ({ action: "search_source", arguments: { query }, reason: "Locate relevant request handling source." });
const searchLogs = (query = "ERROR") => ({ action: "search_logs", arguments: { query }, reason: "Inspect the reported failure logs." });
const propose = (...items: ReturnType<typeof hypothesis>[]) => ({ action: "propose_hypotheses", arguments: { hypotheses: items }, reason: "Rank evidence-backed causes." });
const reproduce = (hypothesisId: string) => ({ action: "request_reproduction", arguments: { hypothesisId }, reason: "Test the concrete causal mechanism." });
const finish = (
  explanation = "No supported next action remains.",
  reason = "Evidence is insufficient.",
) => ({ action: "finish_inconclusive", arguments: { explanation }, reason });
const experiment = (hypothesisId: string, path = "/api/users/register", logContains: readonly string[] = ["ERROR"]) => ({
  hypothesisId,
  request: { method: "POST", path, body: { email: "test@example.com" } },
  expected: { supporting: { logContains: [...logContains] } },
  reason: "Exercise the suspected branch with one controlled request.",
});
const verdict = (
  outcome: "verified" | "insufficient_evidence" | "contradiction",
  hypothesisId: string,
  evidenceIds: string[],
  missing: string | null = null,
  unsupportedClaims: string[] = [],
  limitations: string[] = [],
) => ({
  outcome,
  hypothesisId,
  explanation: outcome === "verified" ? "Source and runtime evidence establish the same causal chain." : `${outcome} requires another investigation step.`,
  evidenceIds,
  missingEvidenceRequest: missing,
  unsupportedClaims,
  limitations,
});

function evidence(id: string, kind: Evidence["kind"], origin: ToolName): Evidence {
  return { id, kind, origin, locator: `case-001/${id}`, content: `observation:${id}`, collectedAt: at };
}

function success<T>(tool: ToolName, data: T, observations: readonly Evidence[]): ToolResult<T> {
  return { ok: true, tool, toolVersion: TOOL_VERSION, data, evidence: observations, durationMs: 1, truncated: false };
}

class ScriptedTools implements AgenticTools {
  public readonly calls: ToolName[] = [];
  public readonly requests: ReproductionRequest[] = [];
  public reproductionOutcomes: ExecuteReproductionData["outcome"][];
  #source = 0;
  #logs = 0;
  #reproductions = 0;

  public constructor(outcomes: ExecuteReproductionData["outcome"][] = ["reproduced"]) {
    this.reproductionOutcomes = [...outcomes];
  }

  public async searchSource(input: unknown): Promise<ToolResult<SearchSourceData>> {
    this.calls.push("search_source");
    this.#source += 1;
    return success("search_source", { query: JSON.stringify(input), matches: [], totalMatches: 1 }, [evidence(`ev-source-${this.#source}`, "source", "search_source")]);
  }

  public async readSource(_input: unknown): Promise<ToolResult<ReadSourceData>> {
    this.calls.push("read_source");
    this.#source += 1;
    return success("read_source", { path: "src/target-api/services/user-service.ts", startLine: 1, endLine: 2, content: "source", bytes: 6 }, [evidence(`ev-source-${this.#source}`, "source", "read_source")]);
  }

  public async searchLogs(input: unknown): Promise<ToolResult<SearchLogsData>> {
    this.calls.push("search_logs");
    this.#logs += 1;
    return success("search_logs", { query: JSON.stringify(input), matches: [], totalMatches: 1 }, [evidence(`ev-log-${this.#logs}`, "log", "search_logs")]);
  }

  public async executeReproduction(input: { request: ReproductionRequest; expectations: ReproductionExpectations }): Promise<ToolResult<ExecuteReproductionData>> {
    this.calls.push("execute_reproduction");
    this.requests.push(input.request);
    this.#reproductions += 1;
    const outcome = this.reproductionOutcomes.shift() ?? "inconclusive";
    const data: ExecuteReproductionData = {
      outcome,
      correlationId: `correlation-${this.#reproductions}`,
      resetSucceeded: true,
      response: { status: outcome === "inconclusive" ? null : 500, body: { error: "failure" }, bodyText: "failure" },
      logs: [],
      assertions: [],
      ...(outcome === "inconclusive" ? { reason: "Target response unavailable" } : {}),
    };
    return success("execute_reproduction", data, [
      evidence(`ev-http-${this.#reproductions}`, "http", "execute_reproduction"),
      evidence(`ev-runtime-log-${this.#reproductions}`, "log", "execute_reproduction"),
    ]);
  }
}

class NoRuntimeEvidenceTools extends ScriptedTools {
  public override async executeReproduction(input: { request: ReproductionRequest; expectations: ReproductionExpectations }): Promise<ToolResult<ExecuteReproductionData>> {
    this.calls.push("execute_reproduction");
    this.requests.push(input.request);
    return success("execute_reproduction", {
      outcome: "reproduced", correlationId: "correlation-no-evidence", resetSucceeded: true,
      response: { status: 500, body: { error: "failure" }, bodyText: "failure" }, logs: [], assertions: [],
    }, []);
  }
}

class SupportingObservationTools extends ScriptedTools {
  public override async executeReproduction(input: { request: ReproductionRequest; expectations: ReproductionExpectations }): Promise<ToolResult<ExecuteReproductionData>> {
    this.calls.push("execute_reproduction");
    this.requests.push(input.request);
    const correlationId = "correlation-supporting-observations";
    const assertions: ExecuteReproductionData["assertions"] = [
      { kind: "method", requirement: "required", expected: input.expectations.required.method, actual: input.request.method, passed: true },
      { kind: "path", requirement: "required", expected: input.expectations.required.path, actual: input.request.path, passed: true },
      { kind: "status", requirement: "required", expected: input.expectations.required.status, actual: 500, passed: true },
      { kind: "body", requirement: "required", expected: input.expectations.required.bodyContains, actual: "user registration failed", passed: true },
      ...input.expectations.supporting.logContains.map((marker) => ({
        kind: "log" as const,
        requirement: "supporting" as const,
        expected: marker,
        actual: "USER_REGISTRATION_UNHANDLED Cannot read properties of undefined (reading 'name')",
        passed: marker === "USER_REGISTRATION_UNHANDLED",
      })),
    ];
    return success("execute_reproduction", {
      outcome: "reproduced",
      correlationId,
      resetSucceeded: true,
      response: { status: 500, body: { error: "user registration failed" }, bodyText: "user registration failed" },
      logs: [{ sequence: 1, requestId: correlationId, level: "error", message: "USER_REGISTRATION_UNHANDLED", details: { message: "Cannot read properties of undefined (reading 'name')" } }],
      assertions,
    }, [
      evidence("ev-http-1", "http", "execute_reproduction"),
      evidence("ev-runtime-log-1", "log", "execute_reproduction"),
    ]);
  }
}

async function run(outputs: unknown[], tools = new ScriptedTools(), limits?: Partial<AgenticLimits>) {
  const provider = new FakeLlmProvider(outputs.map(response));
  const result = await runAgenticInvestigation({
    investigationId: "investigation-test",
    artifacts,
    provider,
    configuration,
    tools,
    ...(limits === undefined ? {} : { limits }),
    clock: () => new Date(at),
  });
  return { result, provider, tools };
}

function investigatorContexts(provider: FakeLlmProvider): Array<Record<string, unknown>> {
  return provider.requests
    .filter((request) => request.responseSchemaName === "traceroot_investigator_decision")
    .map((request) => JSON.parse(request.messages[1]?.content ?? "{}") as Record<string, unknown>);
}

describe("bounded agentic orchestrator", () => {
  it("finds source evidence, reproduces, and verifies", async () => {
    const { result, provider } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"]),
    ]);
    expect({ status: result.diagnosis.status, reason: result.terminationReason }).toEqual({ status: "verified", reason: "verified" });
    expect(result.terminationReason).toBe("verified");
    expect(provider.callCount).toBe(5);
    expect(result.metrics.toolCalls).toEqual({ search_source: 1, read_source: 0, search_logs: 0, execute_reproduction: 1 });
    const ids = new Set(result.trajectory.evidence.map((item) => item.id));
    expect(result.diagnosis.evidenceIds.every((id) => ids.has(id))).toBe(true);
  });

  it("rejects a failed first hypothesis and verifies the second", async () => {
    const tools = new ScriptedTools(["not-reproduced", "reproduced"]);
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"]), hypothesis("hyp-2", ["ev-source-1"], { suspectedSymbol: "parseProfile" })),
      reproduce("hyp-1"), experiment("hyp-1"), verdict("contradiction", "hyp-1", ["ev-http-1", "ev-runtime-log-1"]),
      reproduce("hyp-2"), experiment("hyp-2"), verdict("verified", "hyp-2", ["ev-source-1", "ev-http-2", "ev-runtime-log-2"]),
    ], tools);
    expect(result.diagnosis.status).toBe("verified");
    expect(result.diagnosis.symbol).toBe("parseProfile");
    expect(result.trajectory.hypotheses.some((item) => item.id === "hyp-1" && item.status === "rejected")).toBe(true);
    expect(result.metrics.reproductionAttempts).toBe(2);
  });

  it("rejects a loud secondary log hypothesis before verifying the upstream cause", async () => {
    const tools = new ScriptedTools(["not-reproduced", "reproduced"]);
    const secondary = hypothesis("hyp-audit", ["ev-log-1"], { suspectedSymbol: "writeAuditEvent", mechanism: "The audit sink emits the loud error." });
    const upstream = hypothesis("hyp-upstream", ["ev-source-1"], { suspectedSymbol: "registerUser" });
    const { result } = await run([
      searchLogs(), search(), propose(secondary, upstream), reproduce("hyp-audit"), experiment("hyp-audit"),
      verdict("contradiction", "hyp-audit", ["ev-http-1", "ev-runtime-log-1"]), reproduce("hyp-upstream"), experiment("hyp-upstream"),
      verdict("verified", "hyp-upstream", ["ev-source-1", "ev-http-2", "ev-runtime-log-2"]),
    ], tools);
    expect(result.diagnosis.status).toBe("verified");
    expect(result.diagnosis.symbol).toBe("registerUser");
    expect(result.trajectory.hypotheses.some((item) => item.id === "hyp-audit" && item.status === "rejected")).toBe(true);
  });

  it("uses one additional investigation round after precise insufficient-evidence feedback", async () => {
    const { result } = await run([
      searchLogs(), propose(hypothesis("hyp-1", ["ev-log-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("insufficient_evidence", "hyp-1", ["ev-log-1", "ev-http-1", "ev-runtime-log-1"], "Obtain source evidence for the dereference."),
      search(), propose(hypothesis("hyp-1", ["ev-log-1", "ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-2", "ev-runtime-log-2"]),
    ], new ScriptedTools(["reproduced", "reproduced"]));
    expect({ status: result.diagnosis.status, reason: result.terminationReason }).toEqual({ status: "verified", reason: "verified" });
    expect(result.metrics.investigationRounds).toBe(2);
  });

  it("stops at a tool budget and does not execute the over-budget action", async () => {
    const tools = new ScriptedTools();
    const { result } = await run([search("one"), search("two")], tools, { totalToolCalls: 1 });
    expect(result.terminationReason).toBe("tool_budget_exhausted");
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(tools.calls).toEqual(["search_source"]);
  });

  it("classifies a schema-invalid action as invalid_structured_output without invoking a tool", async () => {
    const tools = new ScriptedTools();
    const { result, provider } = await run([{ action: "execute_shell", arguments: { command: "whoami" }, reason: "invalid" }], tools);
    expect(result.terminationReason).toBe("invalid_structured_output");
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(provider.callCount).toBe(1);
    expect(tools.calls).toEqual([]);
  });

  it("classifies non-JSON model output as invalid_json", async () => {
    const tools = new ScriptedTools();
    const { result } = await run(["{not-json"], tools);
    expect(result.terminationReason).toBe("invalid_json");
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(tools.calls).toEqual([]);
  });

  it("preserves a sanitized schema-validation diagnostic in the trajectory", async () => {
    const fixture = JSON.parse(await readFile(resolve("tests/fixtures/agentic/investigator-invalid-hypothesis-id.json"), "utf8")) as unknown;
    const { result } = await run([fixture]);
    expect(result.terminationReason).toBe("invalid_structured_output");
    const decision = result.trajectory.events.find((event) => event.type === "agent-step-recorded"
      && event.role === "investigator" && event.stepKind === "role-decision");
    expect(decision).toMatchObject({
      type: "agent-step-recorded",
      structuredData: {
        error: "INVALID_STRUCTURED_OUTPUT",
        validationDiagnostic: {
          actionDiscriminator: "propose_hypotheses",
          topLevelKeys: ["action", "arguments", "reason"],
          validationIssues: [expect.objectContaining({
            path: ["arguments", "hypotheses", 0, "id"],
            expected: "string satisfying regex constraint",
            receivedType: "string",
            receivedValueSummary: "\"hypothesis-1\"",
            message: "Invalid",
          })],
        },
      },
    });
  });

  it("reserves invalid_investigator_action for a schema-valid action rejected by runtime state", async () => {
    const tools = new ScriptedTools();
    const { result } = await run([reproduce("hyp-missing")], tools);
    expect(result.terminationReason).toBe("invalid_investigator_action");
    expect(tools.calls).toEqual([]);
  });

  it("classifies an Investigator provider failure separately from an invalid action", async () => {
    const tools = new ScriptedTools();
    const provider = new FakeLlmProvider([new LlmProviderError("invalid_response", "Provider response could not be parsed", false)]);
    const result = await runAgenticInvestigation({
      investigationId: "provider-failure", artifacts, provider, configuration, tools, clock: () => new Date(at),
    });
    expect(result.terminationReason).toBe("provider_error");
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(tools.calls).toEqual([]);
  });

  it("refuses verifier acceptance when reproduction is inconclusive", async () => {
    const tools = new ScriptedTools(["inconclusive"]);
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"]),
    ], tools);
    expect(result.diagnosis.status).toBe("unverified");
    expect(result.terminationReason).toBe("verification_prerequisites_failed");
  });

  it("cannot verify a diagnosis when runtime evidence is absent", async () => {
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1"]),
    ], new NoRuntimeEvidenceTools());
    expect(result.diagnosis.status).toBe("unverified");
    expect(result.terminationReason).toBe("verification_prerequisites_failed");
  });

  it("keeps failed supporting observations available to the Verifier without changing reproduced", async () => {
    const { result, provider } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"),
      experiment("hyp-1", "/api/users/register", ["USER_REGISTRATION_UNHANDLED", "profile"]),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"]),
    ], new SupportingObservationTools());
    expect(result.terminationReason).toBe("verified");
    const verifierRequest = provider.requests.find((request) => request.responseSchemaName === "traceroot_verifier_decision");
    const verifierContext = JSON.parse(verifierRequest?.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(verifierContext).toMatchObject({
      reproduction: {
        outcome: "reproduced",
        assertions: expect.arrayContaining([
          expect.objectContaining({ requirement: "supporting", expected: "profile", passed: false }),
        ]),
      },
    });
  });

  it("accepts verification with a limitation and preserves the limitation in the diagnosis and trajectory", async () => {
    const limitation = "The evidence does not establish which 4xx response would be contractually appropriate.";
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"], null, [], [limitation]),
    ]);

    expect(result.terminationReason).toBe("verified");
    expect(result.diagnosis.status).toBe("verified");
    expect(result.diagnosis.limitations).toEqual([limitation]);
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.trajectory.events).toContainEqual(expect.objectContaining({
      type: "agent-step-recorded",
      role: "verifier",
      structuredData: expect.objectContaining({ limitations: [limitation], unsupportedClaims: [] }),
    }));
  });

  it("rejects verification containing an unsupported positive factual claim", async () => {
    const unsupportedClaim = "The API contract requires HTTP 422 for this request.";
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"], null, [unsupportedClaim]),
    ]);

    expect(result.terminationReason).toBe("verification_prerequisites_failed");
    expect(result.diagnosis.status).toBe("unverified");
    expect(result.unsupportedClaims).toEqual([unsupportedClaim]);
  });

  it("rejects a reproduced failure when the Verifier reports insufficient evidence", async () => {
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("insufficient_evidence", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"], "Obtain evidence that excludes the alternative branch."),
    ], new ScriptedTools(["reproduced"]), { investigationRounds: 1 });

    expect(result.trajectory.experiments[0]?.outcome).toBe("reproduced");
    expect(result.diagnosis.status).not.toBe("verified");
    expect(result.terminationReason).toBe("evidence_insufficient_after_max_rounds");
  });

  it("allows the Verifier to contradict a reproduced experiment", async () => {
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("contradiction", "hyp-1", ["ev-http-1", "ev-runtime-log-1"]), finish("The tested hypothesis was contradicted."),
    ]);
    expect(result.trajectory.experiments[0]?.outcome).toBe("reproduced");
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(result.trajectory.activeHypotheses).toEqual([]);
    expect(result.trajectory.hypotheses.at(-1)).toMatchObject({ id: "hyp-1", status: "rejected" });
    expect(result.terminationReason).not.toBe("verified");
  });

  it("returns explicitly inconclusive when evidence remains insufficient", async () => {
    const { result } = await run([finish()]);
    expect(result.diagnosis.status).toBe("inconclusive");
    expect(result.terminationReason).toBe("investigator_finished_inconclusive");
  });

  it("advertises live budgets, active hypotheses, and reproduction availability exactly", async () => {
    const { provider } = await run([
      search(),
      propose(hypothesis("hyp-1", ["ev-source-1"])),
      finish("The source evidence is not sufficient to continue safely."),
    ]);
    const contexts = investigatorContexts(provider);
    expect(contexts).toHaveLength(3);

    expect(contexts[1]).toMatchObject({
      runtimeState: {
        budget: {
          investigationRoundsUsed: 1, investigationRoundsMax: 2, investigationRoundsRemaining: 1,
          activeHypothesesUsed: 0, activeHypothesesMax: 3,
          reproductionAttemptsUsed: 0, reproductionAttemptsMax: 3, reproductionAttemptsRemaining: 3,
          toolCallsUsed: 1, toolCallsMax: 12, toolCallsRemaining: 11,
          llmCallsUsed: 2, llmCallsMax: 20,
          totalTokensUsed: 15, totalTokensMax: 100_000,
        },
        activeHypothesisIds: [],
        reproductionAllowed: false,
      },
    });
    expect(contexts[2]).toMatchObject({
      runtimeState: {
        budget: {
          investigationRoundsUsed: 1, investigationRoundsMax: 2, investigationRoundsRemaining: 1,
          activeHypothesesUsed: 1, activeHypothesesMax: 3,
          reproductionAttemptsUsed: 0, reproductionAttemptsMax: 3, reproductionAttemptsRemaining: 3,
          toolCallsUsed: 1, toolCallsMax: 12, toolCallsRemaining: 11,
          llmCallsUsed: 3, llmCallsMax: 20,
          totalTokensUsed: 30, totalTokensMax: 100_000,
        },
        activeHypothesisIds: ["hyp-1"],
        reproductionAllowed: true,
        allowedNextActions: expect.arrayContaining(["request_reproduction"]),
      },
    });
  });

  it("corrects one false budget-exhaustion claim and permits reproduction", async () => {
    const falseFinish = finish(
      "The investigation and tool budgets are exhausted and no reproduction attempts are available.",
      "Verification cannot continue within the remaining budgets.",
    );
    const { result, provider } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), falseFinish,
      reproduce("hyp-1"), experiment("hyp-1"),
      verdict("verified", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"]),
    ]);

    expect(result.terminationReason).toBe("verified");
    expect(result.metrics.reproductionAttempts).toBe(1);
    const contexts = investigatorContexts(provider);
    expect(contexts[3]).toMatchObject({
      runtimePolicyFeedback: expect.stringContaining("incorrectly claimed"),
      runtimeState: {
        reproductionAllowed: true,
        allowedNextActions: expect.arrayContaining(["request_reproduction"]),
      },
    });
  });

  it("passes updated round and budget state after verifier feedback", async () => {
    const { provider } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("insufficient_evidence", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"], "Collect one more runtime observation."),
      finish("The requested evidence cannot establish causality."),
    ]);
    const contexts = investigatorContexts(provider);
    const reproducerContext = JSON.parse(provider.requests.find((request) => request.responseSchemaName === "traceroot_reproducer_decision")?.messages[1]?.content ?? "{}") as Record<string, unknown>;
    const verifierContext = JSON.parse(provider.requests.find((request) => request.responseSchemaName === "traceroot_verifier_decision")?.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(reproducerContext).toMatchObject({
      runtimeState: { budget: { reproductionAttemptsUsed: 0, toolCallsUsed: 1, llmCallsUsed: 4 } },
    });
    expect(verifierContext).toMatchObject({
      runtimeState: { budget: { reproductionAttemptsUsed: 1, toolCallsUsed: 2, llmCallsUsed: 5 } },
    });
    expect(contexts.at(-1)).toMatchObject({
      verifierFeedback: "Collect one more runtime observation.",
      runtimeState: {
        budget: {
          investigationRoundsUsed: 2, investigationRoundsMax: 2, investigationRoundsRemaining: 0,
          reproductionAttemptsUsed: 1, reproductionAttemptsMax: 3, reproductionAttemptsRemaining: 2,
          toolCallsUsed: 2, toolCallsMax: 12, toolCallsRemaining: 10,
          llmCallsUsed: 6,
        },
        activeHypothesisIds: ["hyp-1"],
        reproductionAllowed: true,
      },
    });
  });

  it("bounds repeated false budget-exhaustion claims", async () => {
    const falseFinish = finish(
      "The investigation and tool budgets are exhausted and no reproduction attempts are available.",
      "No runtime action remains.",
    );
    const { result, provider } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), falseFinish, falseFinish,
    ]);
    expect(result.terminationReason).toBe("false_budget_exhaustion_claim");
    expect(provider.callCount).toBe(4);
    expect(result.metrics.reproductionAttempts).toBe(0);
  });

  it("enforces two rounds, three active hypotheses, and three reproduction attempts", async () => {
    const rounds = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"),
      verdict("insufficient_evidence", "hyp-1", ["ev-source-1", "ev-http-1", "ev-runtime-log-1"], "More runtime evidence."),
      reproduce("hyp-1"), experiment("hyp-1"), verdict("insufficient_evidence", "hyp-1", ["ev-source-1", "ev-http-2", "ev-runtime-log-2"], "Still insufficient."),
    ]);
    expect(rounds.result.metrics.investigationRounds).toBe(2);
    expect(rounds.result.terminationReason).toBe("evidence_insufficient_after_max_rounds");

    const hypotheses = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"]), hypothesis("hyp-2", ["ev-source-1"]), hypothesis("hyp-3", ["ev-source-1"])),
      propose(hypothesis("hyp-4", ["ev-source-1"])),
    ]);
    expect(hypotheses.result.terminationReason).toBe("hypothesis_budget_exhausted");
    expect(hypotheses.result.trajectory.hypotheses.filter((item) => item.status === "proposed")).toHaveLength(3);

    const attempts = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])),
      reproduce("hyp-1"), experiment("hyp-1"), verdict("contradiction", "hyp-1", ["ev-http-1", "ev-runtime-log-1"]),
      propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"), verdict("contradiction", "hyp-1", ["ev-http-2", "ev-runtime-log-2"]),
      propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1"), verdict("contradiction", "hyp-1", ["ev-http-3", "ev-runtime-log-3"]),
      propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"),
    ], new ScriptedTools(["not-reproduced", "not-reproduced", "not-reproduced"]));
    expect(attempts.result.metrics.reproductionAttempts).toBe(3);
    expect(attempts.result.terminationReason).toBe("reproduction_budget_exhausted");
    const reproductionExhausted = investigatorContexts(attempts.provider).at(-1);
    expect(reproductionExhausted).toMatchObject({
      runtimeState: {
        budget: { reproductionAttemptsUsed: 3, reproductionAttemptsMax: 3, reproductionAttemptsRemaining: 0 },
        activeHypothesisIds: ["hyp-1"],
        reproductionAllowed: false,
      },
    });
    expect((reproductionExhausted?.runtimeState as { allowedNextActions: string[] }).allowedNextActions).not.toContain("request_reproduction");
  });

  it("enforces the default maximum of twelve tool calls", async () => {
    const actions = Array.from({ length: 13 }, (_, index) => search(`query-${index}`));
    const tools = new ScriptedTools();
    const { result, provider } = await run(actions, tools);
    expect(result.metrics.totalToolCalls).toBe(12);
    expect(result.terminationReason).toBe("tool_budget_exhausted");
    expect(tools.calls).toHaveLength(12);
    const exhaustedContext = investigatorContexts(provider).at(-1);
    expect(exhaustedContext).toMatchObject({
      runtimeState: { budget: { toolCallsUsed: 12, toolCallsMax: 12, toolCallsRemaining: 0 } },
    });
    const allowed = (exhaustedContext?.runtimeState as { allowedNextActions: string[] }).allowedNextActions;
    expect(allowed).not.toContain("search_source");
    expect(allowed).not.toContain("read_source");
    expect(allowed).not.toContain("search_logs");
    expect(allowed).not.toContain("request_reproduction");
  });

  it("accepts finish_inconclusive when the specifically claimed budget is actually exhausted", async () => {
    const actions = [
      ...Array.from({ length: 12 }, (_, index) => search(`query-${index}`)),
      finish("The tool call budget is exhausted, so no further source or log observation can be collected."),
    ];
    const { result } = await run(actions);
    expect(result.metrics.totalToolCalls).toBe(12);
    expect(result.terminationReason).toBe("investigator_finished_inconclusive");
  });

  it("blocks direct control endpoints before execute_reproduction", async () => {
    const tools = new ScriptedTools();
    const { result } = await run([
      search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), experiment("hyp-1", "/__control/reset"),
    ], tools);
    expect(result.terminationReason).toBe("forbidden_reproduction_request");
    expect(tools.calls).toEqual(["search_source"]);
  });

  it("rejects authorization headers and redacts their values from the trajectory", async () => {
    const tools = new ScriptedTools();
    const unsafe = { ...experiment("hyp-1"), request: { ...experiment("hyp-1").request, headers: { Authorization: "Bearer do-not-store" } } };
    const { result } = await run([search(), propose(hypothesis("hyp-1", ["ev-source-1"])), reproduce("hyp-1"), unsafe], tools);
    expect(result.terminationReason).toBe("forbidden_reproduction_request");
    expect(JSON.stringify(result.trajectory)).not.toContain("Bearer do-not-store");
    expect(JSON.stringify(result.trajectory)).toContain("[REDACTED]");
  });

  it("tracks unsupported evidence references instead of silently accepting them", async () => {
    const { result } = await run([search(), propose(hypothesis("hyp-1", ["ev-made-up"]))]);
    expect(result.unsupportedClaimCount).toBe(1);
    expect(result.unsupportedReferences).toContain("ev-made-up");
    expect(result.terminationReason).toBe("unsupported_hypothesis_evidence");
  });
});
