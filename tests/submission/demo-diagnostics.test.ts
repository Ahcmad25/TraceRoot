import { describe, expect, it } from "vitest";
import type { InvestigationEvent } from "../../src/domain/investigation.js";
import { safeDemoFailureReason } from "../../src/demo-diagnostics.js";

function providerFailure(providerCode: string): InvestigationEvent {
  return {
    sequence: 1,
    recordedAt: "2026-01-01T00:00:00.000Z",
    type: "agent-step-recorded",
    role: "investigator",
    promptVersion: "investigator-v1",
    stepKind: "role-decision",
    structuredData: {
      error: "PROVIDER_ERROR",
      providerCode,
      message: "sensitive provider detail that must not be returned",
    },
    evidenceIds: [],
    budgetState: {},
    humanCheckpoint: null,
  };
}

describe("safe demo provider diagnostics", () => {
  it.each([
    ["invalid_api_key", "authentication_error"],
    ["insufficient_quota", "insufficient_quota"],
    ["model_not_found", "model_not_found"],
    ["invalid_request_error", "invalid_request"],
    ["network_error", "network_error"],
    ["missing_output", "provider_response_error"],
  ] as const)("maps %s without exposing provider detail", (providerCode, expected) => {
    expect(safeDemoFailureReason("provider_error", [providerFailure(providerCode)])).toBe(expected);
  });

  it("maps structured parsing failures and ignores non-provider termination", () => {
    expect(safeDemoFailureReason("invalid_structured_output", [])).toBe("schema_parse_error");
    expect(safeDemoFailureReason("verified", [])).toBeNull();
  });
});
