import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runInvestigation } from "../../src/agentic/runner.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";

describe("agentic runner effective sampling metadata", () => {
  it("records and sends an omitted temperature for a temperature-unsupported model", async () => {
    const provider = new FakeLlmProvider([{
      output: {
        action: "finish_inconclusive",
        arguments: { explanation: "Evidence is insufficient." },
        reason: "No supported next action remains.",
      },
    }]);
    const execution = await runInvestigation({
      workspaceRoot: resolve("."),
      caseId: "case-001",
      baseUrl: "http://127.0.0.1:1",
      provider,
      configuration: { modelId: "gpt-5.6-sol", temperature: 0, timeoutMs: 1_000 },
      writeResult: false,
      runId: "agentic-test-effective-sampling",
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
    });
    expect(execution.ok).toBe(true);
    if (!execution.ok) throw new Error(execution.error.message);
    expect(provider.requests[0]?.configuration).toMatchObject({ modelId: "gpt-5.6-sol", temperature: null });
    expect(execution.result).toMatchObject({ model: "gpt-5.6-sol", temperature: null });
  });
});
