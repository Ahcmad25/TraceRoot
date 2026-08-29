import type { LlmConfiguration } from "./types.js";

export interface ModelCapabilities {
  readonly temperature: "supported" | "unsupported";
}

const TEMPERATURE_UNSUPPORTED_MODEL_FAMILIES = [
  /^gpt-5\.6(?:$|-)/iu,
] as const;

export function modelCapabilities(modelId: string): ModelCapabilities {
  const normalized = modelId.trim();
  return {
    temperature: TEMPERATURE_UNSUPPORTED_MODEL_FAMILIES.some((pattern) => pattern.test(normalized))
      ? "unsupported"
      : "supported",
  };
}

export function effectiveLlmConfiguration(configuration: LlmConfiguration): LlmConfiguration {
  return modelCapabilities(configuration.modelId).temperature === "unsupported"
    ? { ...configuration, temperature: null }
    : configuration;
}

export function assertFairSamplingConfiguration(
  baseline: LlmConfiguration,
  agentic: LlmConfiguration,
): void {
  const baselineEffective = effectiveLlmConfiguration(baseline);
  const agenticEffective = effectiveLlmConfiguration(agentic);
  if (baselineEffective.modelId !== agenticEffective.modelId
    || baselineEffective.temperature !== agenticEffective.temperature) {
    throw new Error("Baseline and agentic runs must use the same effective model and temperature configuration");
  }
}
