import type { LlmProvider, RawLlmResponse } from "./types.js";
import { LlmProviderError } from "./types.js";

export type FakeLlmOutcome = RawLlmResponse | Error | LlmProviderError;

export class FakeLlmProvider implements LlmProvider {
  public readonly providerId = "fake";
  readonly #outcomes: FakeLlmOutcome[];
  #callCount = 0;
  readonly #requests: Array<Parameters<LlmProvider["invoke"]>[0]> = [];

  public constructor(outcomes: readonly FakeLlmOutcome[]) {
    this.#outcomes = [...outcomes];
  }

  public get callCount(): number {
    return this.#callCount;
  }

  public get requests(): readonly Parameters<LlmProvider["invoke"]>[0][] {
    return Object.freeze(structuredClone(this.#requests));
  }

  public async invoke(input: Parameters<LlmProvider["invoke"]>[0]): Promise<RawLlmResponse> {
    this.#callCount += 1;
    this.#requests.push(structuredClone(input));
    const outcome = this.#outcomes.shift();
    if (outcome === undefined) {
      throw new Error("Fake LLM provider has no queued outcome");
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return structuredClone(outcome);
  }
}
