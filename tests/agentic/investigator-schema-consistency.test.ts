import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  INVESTIGATOR_JSON_SCHEMA,
  investigatorDecisionSchema,
  investigatorProviderResponseSchema,
} from "../../src/agentic/schemas.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const validateProviderEnvelope = ajv.compile(INVESTIGATOR_JSON_SCHEMA);

function providerAccepts(decision: unknown): boolean {
  return validateProviderEnvelope({ decision });
}

function runtimeAccepts(decision: unknown): boolean {
  return investigatorDecisionSchema.safeParse(decision).success;
}

function hypothesis(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "hyp-1",
    statement: "The registration path dereferences an absent profile.",
    faultCategory: "input-validation",
    suspectedFile: "src/target-api/scenarios/user-registration.ts",
    suspectedSymbol: "registerUser",
    mechanism: "An optional profile is read before its presence is validated.",
    supportingEvidenceIds: ["ev-source-1"],
    contradictingEvidenceIds: [],
    confidence: 0.99,
    verificationPlan: "Register a user without a profile and inspect correlated logs.",
    ...overrides,
  };
}

function propose(items: readonly unknown[]): Record<string, unknown> {
  return {
    action: "propose_hypotheses",
    arguments: { hypotheses: items },
    reason: "Rank the source-supported cause.",
  };
}

describe("Investigator provider/runtime schema consistency", () => {
  it("rejects H1 and accepts hyp-1 in both provider and runtime schemas", () => {
    const invalid = propose([hypothesis({ id: "H1" })]);
    const valid = propose([hypothesis()]);

    expect(providerAccepts(invalid)).toBe(false);
    expect(runtimeAccepts(invalid)).toBe(false);
    expect(providerAccepts(valid)).toBe(true);
    expect(runtimeAccepts(valid)).toBe(true);
    expect(investigatorProviderResponseSchema.parse({ decision: valid })).toEqual(valid);
  });

  it.each([-0.01, 1.01])("rejects confidence %s outside 0-1", (confidence) => {
    const decision = propose([hypothesis({ confidence })]);
    expect(providerAccepts(decision)).toBe(false);
    expect(runtimeAccepts(decision)).toBe(false);
  });

  it.each([0, 4])("rejects a hypothesis count of %s", (count) => {
    const decision = propose(Array.from({ length: count }, (_value, index) => hypothesis({ id: `hyp-${index + 1}` })));
    expect(providerAccepts(decision)).toBe(false);
    expect(runtimeAccepts(decision)).toBe(false);
  });

  it("rejects action/argument discriminator mismatches", () => {
    const mismatch = {
      action: "search_source",
      arguments: { path: "src/target-api/scenarios/user-registration.ts" },
      reason: "Read the likely implementation.",
    };
    expect(providerAccepts(mismatch)).toBe(false);
    expect(runtimeAccepts(mismatch)).toBe(false);
  });

  it("keeps every Investigator action variant accepted by both contracts", () => {
    const variants: readonly unknown[] = [
      { action: "search_source", arguments: { query: "registerUser" }, reason: "Locate the symbol." },
      { action: "read_source", arguments: { path: "src/target-api/scenarios/user-registration.ts" }, reason: "Read the implementation." },
      { action: "search_logs", arguments: { query: "ERROR" }, reason: "Inspect initial errors." },
      propose([hypothesis()]),
      { action: "request_reproduction", arguments: { hypothesisId: "hyp-1" }, reason: "Test the hypothesis." },
      { action: "finish_inconclusive", arguments: { explanation: "Evidence is insufficient." }, reason: "Stop safely." },
    ];

    for (const decision of variants) {
      expect(providerAccepts(decision)).toBe(true);
      expect(runtimeAccepts(decision)).toBe(true);
    }
  });

  it("keeps required non-empty strings aligned", () => {
    const invalidVariants: readonly unknown[] = [
      { action: "search_source", arguments: { query: "" }, reason: "Search." },
      { action: "read_source", arguments: { path: "" }, reason: "Read." },
      { action: "search_logs", arguments: { query: "" }, reason: "Search." },
      { action: "request_reproduction", arguments: { hypothesisId: "" }, reason: "Test." },
      { action: "finish_inconclusive", arguments: { explanation: "" }, reason: "Stop." },
      propose([hypothesis({ statement: "" })]),
      propose([hypothesis({ suspectedFile: "" })]),
      propose([hypothesis({ suspectedSymbol: "" })]),
      propose([hypothesis({ mechanism: "" })]),
      propose([hypothesis({ supportingEvidenceIds: [""] })]),
      propose([hypothesis({ contradictingEvidenceIds: [""] })]),
      propose([hypothesis({ verificationPlan: "" })]),
    ];

    for (const decision of invalidVariants) {
      expect(providerAccepts(decision)).toBe(false);
      expect(runtimeAccepts(decision)).toBe(false);
    }
  });
});
