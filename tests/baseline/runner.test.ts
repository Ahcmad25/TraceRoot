import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASELINE_PROMPT_VERSION } from "../../src/baseline/prompt.js";
import { runBaseline } from "../../src/baseline/runner.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { LlmProviderError } from "../../src/llm/types.js";

const workspaceRoot = resolve(".");
const configuration = { modelId: "fake-model-v1", temperature: 0, timeoutMs: 1_000 };
const temporaryPaths: string[] = [];

const diagnosis = {
  status: "unverified" as const,
  category: "input-validation" as const,
  sourceFile: "src/target-api/scenarios/user-registration.ts",
  symbol: "registerUser",
  causalMechanism: "profile.name is dereferenced before profile is validated",
  explanation: "The request omits profile, but registerUser accesses profile.name.",
  confidence: 0.95,
  evidenceIds: [
    "source:src/target-api/scenarios/user-registration.ts:L7-L8",
    "log:cases/public/case-001/app.log:L2",
  ],
  reproductionSummary: "Not attempted by baseline.",
  limitations: ["No runtime reproduction was performed"],
};

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of temporaryPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("one-shot baseline runner", () => {
  it("makes exactly one reasoning call, records prompt version, and has no tool channel", async () => {
    const provider = new FakeLlmProvider([{
      output: diagnosis,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      providerRequestId: "fake-primary-1",
    }]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      writeResult: false,
      runId: "baseline-test-primary",
    });

    expect(execution.ok).toBe(true);
    expect(provider.callCount).toBe(1);
    expect(provider.requests).toHaveLength(1);
    expect(Object.keys(provider.requests[0] ?? {}).sort()).toEqual([
      "configuration",
      "messages",
      "responseJsonSchema",
      "responseSchemaName",
    ]);
    expect(provider.requests[0]?.messages[0]?.content).toContain("You have no tools");
    expect(execution.result?.promptVersion).toBe(BASELINE_PROMPT_VERSION);
    expect(execution.result?.calls).toEqual([
      expect.objectContaining({ kind: "reasoning", ok: true }),
    ]);
    expect(execution.result?.formatRetryCount).toBe(0);
    expect(execution.result?.evidenceValidation.unsupported).toEqual([]);
    expect(execution.result?.runMetadata).toMatchObject({ toolVersion: "none", toolCallCount: 0 });
  });

  it("accepts an inconclusive diagnosis", async () => {
    const provider = new FakeLlmProvider([{
      output: {
        ...diagnosis,
        status: "inconclusive",
        category: "unknown",
        sourceFile: "unknown",
        symbol: "unknown",
        causalMechanism: "The supplied artifacts do not establish one mechanism",
        explanation: "Evidence is insufficient for a supported root cause.",
        confidence: 0.1,
        evidenceIds: ["report:case-001"],
      },
    }]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      writeResult: false,
      runId: "baseline-test-inconclusive",
    });

    expect(execution.ok).toBe(true);
    expect(execution.result?.diagnosis?.status).toBe("inconclusive");
  });

  it("records the effective unsupported-temperature configuration", async () => {
    const provider = new FakeLlmProvider([{ output: diagnosis }]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration: { modelId: "gpt-5.6-sol", temperature: 0, timeoutMs: 1_000 },
      writeResult: false,
      runId: "baseline-test-effective-sampling",
    });
    expect(execution.ok).toBe(true);
    expect(provider.requests[0]?.configuration).toMatchObject({ modelId: "gpt-5.6-sol", temperature: null });
    expect(execution.result).toMatchObject({ model: "gpt-5.6-sol", temperature: null, runMetadata: { temperature: null } });
  });

  it("records unsupported evidence without removing it", async () => {
    const unsupported = "source:src/not-permitted.ts:L1";
    const provider = new FakeLlmProvider([{
      output: { ...diagnosis, evidenceIds: [...diagnosis.evidenceIds, unsupported] },
    }]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      writeResult: false,
      runId: "baseline-test-unsupported",
    });

    expect(execution.result?.diagnosis?.evidenceIds).toContain(unsupported);
    expect(execution.result?.evidenceValidation.unsupported).toEqual([unsupported]);
  });

  it("permits one format-only retry with the same case context", async () => {
    const provider = new FakeLlmProvider([
      { output: { malformed: true }, usage: { inputTokens: 80, outputTokens: 10, totalTokens: 90 } },
      { output: diagnosis, usage: { inputTokens: 90, outputTokens: 50, totalTokens: 140 } },
    ]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      writeResult: false,
      runId: "baseline-test-format-retry",
    });

    expect(execution.ok).toBe(true);
    expect(provider.callCount).toBe(2);
    expect(execution.result?.formatRetryCount).toBe(1);
    expect(execution.result?.calls.map((call) => call.kind)).toEqual(["reasoning", "format-retry"]);
    const primaryContext = provider.requests[0]?.messages[1]?.content ?? "missing";
    expect(provider.requests[1]?.messages[0]?.content).toContain("format-only correction");
    expect(provider.requests[1]?.messages[1]?.content.startsWith(primaryContext)).toBe(true);
    expect(execution.result?.tokenUsage.totalTokens).toBe(230);
  });

  it("does not retry provider failures", async () => {
    const provider = new FakeLlmProvider([
      new LlmProviderError("rate_limit", "Rate limited", true),
    ]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      writeResult: false,
      runId: "baseline-test-provider-failure",
    });

    expect(execution.ok).toBe(false);
    expect(provider.callCount).toBe(1);
    expect(execution.result?.status).toBe("failed");
    expect(execution.result?.formatRetryCount).toBe(0);
    if (execution.ok) throw new Error("Expected provider failure");
    expect(execution.error).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("writes auditable JSON without environment secrets", async () => {
    const secret = "sk-test-never-write-this";
    vi.stubEnv("OPENAI_API_KEY", secret);
    const resultsRoot = await mkdtemp(resolve("tests", "baseline-output-"));
    temporaryPaths.push(resultsRoot);
    const provider = new FakeLlmProvider([{
      output: { ...diagnosis, explanation: `Provider accidentally echoed ${secret}` },
      providerRequestId: "fake-result-1",
    }]);
    const execution = await runBaseline({
      workspaceRoot,
      caseId: "case-001",
      provider,
      configuration,
      resultsRoot,
      runId: "baseline-test-result",
    });

    expect(execution.ok).toBe(true);
    expect(execution.resultPath).toBe(resolve(resultsRoot, "baseline-test-result.json"));
    const serialized = await readFile(execution.resultPath as string, "utf8");
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: "baseline-result-v1",
      caseId: "case-001",
      promptVersion: BASELINE_PROMPT_VERSION,
      formatRetryCount: 0,
      diagnosis: { status: "unverified" },
    });
  });
});
