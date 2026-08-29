import { describe, expect, it } from "vitest";
import {
  assertFairSamplingConfiguration,
  effectiveLlmConfiguration,
  modelCapabilities,
} from "../../src/llm/model-capabilities.js";

describe("model sampling capabilities", () => {
  it("marks the GPT-5.6 family as temperature-unsupported without changing the model", () => {
    expect(modelCapabilities("gpt-5.6-sol").temperature).toBe("unsupported");
    expect(modelCapabilities("gpt-5.6-sol-2026-08-01").temperature).toBe("unsupported");
    expect(effectiveLlmConfiguration({ modelId: "gpt-5.6-sol", temperature: 0, timeoutMs: 1_000 })).toEqual({
      modelId: "gpt-5.6-sol", temperature: null, timeoutMs: 1_000,
    });
  });

  it("preserves an explicit temperature for models where it is supported", () => {
    expect(effectiveLlmConfiguration({ modelId: "supported-model", temperature: 0.25, timeoutMs: 1_000 })).toEqual({
      modelId: "supported-model", temperature: 0.25, timeoutMs: 1_000,
    });
  });

  it("requires baseline and agentic runs to have the same effective sampling configuration", () => {
    expect(() => assertFairSamplingConfiguration(
      { modelId: "gpt-5.6-sol", temperature: 0, timeoutMs: 1_000 },
      { modelId: "gpt-5.6-sol", temperature: null, timeoutMs: 2_000 },
    )).not.toThrow();
    expect(() => assertFairSamplingConfiguration(
      { modelId: "supported-model", temperature: 0, timeoutMs: 1_000 },
      { modelId: "supported-model", temperature: 0.5, timeoutMs: 1_000 },
    )).toThrow("same effective model and temperature");
    expect(() => assertFairSamplingConfiguration(
      { modelId: "gpt-5.6-sol", temperature: null, timeoutMs: 1_000 },
      { modelId: "different-model", temperature: null, timeoutMs: 1_000 },
    )).toThrow("same effective model and temperature");
  });
});
