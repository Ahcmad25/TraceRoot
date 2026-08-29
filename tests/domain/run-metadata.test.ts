import { describe, expect, it } from "vitest";
import { RunMetadataRecorder } from "../../src/domain/run-metadata.js";

const hash = "a".repeat(64);

describe("RunMetadataRecorder", () => {
  it("records reproducibility inputs and accumulated usage", () => {
    const times = [
      new Date("2026-08-29T00:00:00.000Z"),
      new Date("2026-08-29T00:00:01.000Z"),
    ];
    const recorder = new RunMetadataRecorder({
      runId: "run-1",
      caseId: "case-001",
      mode: "agentic",
      llm: { modelId: "fake-model-v1", temperature: 0, timeoutMs: 1_000 },
      promptVersion: "not-implemented-v0",
      artifactHashes: { manifest: hash, sources: { source: hash }, logs: { log: hash }, aggregate: hash },
      toolVersion: "1.0.0",
      clock: () => times.shift() ?? new Date("2026-08-29T00:00:01.000Z"),
    });
    recorder.recordTokenUsage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    recorder.recordToolCall();
    const completed = recorder.complete();

    expect(completed).toMatchObject({
      modelId: "fake-model-v1",
      temperature: 0,
      promptVersion: "not-implemented-v0",
      startedAt: "2026-08-29T00:00:00.000Z",
      completedAt: "2026-08-29T00:00:01.000Z",
      tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      toolCallCount: 1,
    });
    expect(() => recorder.recordToolCall()).toThrow("already completed");
  });

  it("records unsupported temperature as null instead of forcing zero", () => {
    const recorder = new RunMetadataRecorder({
      runId: "run-no-temperature",
      caseId: "case-001",
      mode: "baseline",
      llm: { modelId: "gpt-5.6-sol", temperature: null, timeoutMs: 1_000 },
      promptVersion: "baseline-v2",
      artifactHashes: { manifest: hash, sources: {}, logs: {}, aggregate: hash },
      toolVersion: "none",
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
    });
    expect(recorder.complete()).toMatchObject({ modelId: "gpt-5.6-sol", temperature: null });
  });
});
