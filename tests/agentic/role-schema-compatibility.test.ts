import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  REPRODUCER_JSON_SCHEMA,
  VERIFIER_JSON_SCHEMA,
  reproducerDecisionSchema,
  reproducerProviderResponseSchema,
  verifierDecisionSchema,
} from "../../src/agentic/schemas.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const validateReproducer = ajv.compile(REPRODUCER_JSON_SCHEMA);
const validateVerifier = ajv.compile(VERIFIER_JSON_SCHEMA);

function assertStrictObjectGraph(node: unknown, path = "$"): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertStrictObjectGraph(child, `${path}[${index}]`));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const schema = node as Record<string, unknown>;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(schema.properties, `${path}.properties`).toBeTypeOf("object");
    expect(Array.isArray(schema.required), `${path}.required`).toBe(true);
    const propertyKeys = Object.keys(schema.properties as Record<string, unknown>).sort();
    expect([...(schema.required as string[])].sort(), `${path}.required`).toEqual(propertyKeys);
  }
  for (const [key, child] of Object.entries(schema)) {
    assertStrictObjectGraph(child, `${path}.${key}`);
  }
}

function naturalCase001Reproduction(): Record<string, unknown> {
  return {
    hypothesisId: "hyp-1",
    request: {
      method: "POST",
      path: "/api/users/register",
      body: { email: "ada@example.test" },
    },
    expected: {
      supporting: { logContains: ["USER_REGISTRATION_UNHANDLED"] },
    },
    reason: "Exercise the reported email-only registration request and compare its correlated failure log.",
  };
}

describe("Reproducer Structured Outputs compatibility", () => {
  it("uses a strict-compatible object graph for every nested object", () => {
    expect(() => ajv.compile(REPRODUCER_JSON_SCHEMA)).not.toThrow();
    assertStrictObjectGraph(REPRODUCER_JSON_SCHEMA);
    const requestProperties = (REPRODUCER_JSON_SCHEMA.properties.request as { properties: Record<string, unknown> }).properties;
    expect(requestProperties).not.toHaveProperty("headers");
    expect(requestProperties).not.toHaveProperty("query");
  });

  it("accepts and deterministically decodes the case-001 provider fixture", async () => {
    const fixture = JSON.parse(await readFile(resolve("tests/fixtures/agentic/reproducer-case-001.json"), "utf8")) as unknown;
    expect(validateReproducer(fixture)).toBe(true);
    const parsed = reproducerProviderResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).toEqual(naturalCase001Reproduction());
    expect(reproducerDecisionSchema.safeParse(parsed.data).success).toBe(true);
  });

  it("keeps malformed requests rejected by provider and runtime validation", async () => {
    const fixture = JSON.parse(await readFile(resolve("tests/fixtures/agentic/reproducer-case-001.json"), "utf8")) as Record<string, unknown>;
    const request = fixture.request as Record<string, unknown>;
    const expected = fixture.expected as Record<string, unknown>;
    const supporting = expected.supporting as Record<string, unknown>;
    const malformedProvider = [
      { ...fixture, request: { ...request, method: "TRACE" } },
      { ...fixture, request: { ...request, path: "api/users/register" } },
      { ...fixture, expected: { ...expected, supporting: { ...supporting, logContains: [""] } } },
      { ...fixture, expected: { ...expected, unexpected: true } },
    ];
    const natural = naturalCase001Reproduction();
    const naturalRequest = natural.request as Record<string, unknown>;
    const naturalExpected = natural.expected as Record<string, unknown>;
    const naturalSupporting = naturalExpected.supporting as Record<string, unknown>;
    const malformedRuntime = [
      { ...natural, request: { ...naturalRequest, method: "TRACE" } },
      { ...natural, request: { ...naturalRequest, path: "api/users/register" } },
      { ...natural, expected: { ...naturalExpected, supporting: { ...naturalSupporting, logContains: [""] } } },
      { ...natural, expected: { ...naturalExpected, unexpected: true } },
    ];

    for (let index = 0; index < malformedProvider.length; index += 1) {
      expect(validateReproducer(malformedProvider[index])).toBe(false);
      expect(reproducerProviderResponseSchema.safeParse(malformedProvider[index]).success).toBe(false);
      expect(reproducerDecisionSchema.safeParse(malformedRuntime[index]).success).toBe(false);
    }
  });

  it("rejects malformed encoded body entries before runtime decoding", async () => {
    const fixture = JSON.parse(await readFile(resolve("tests/fixtures/agentic/reproducer-case-001.json"), "utf8")) as Record<string, unknown>;
    const request = fixture.request as Record<string, unknown>;
    const malformed = {
      ...fixture,
      request: { ...request, body: { objectEntries: [{ key: "", value: "ada@example.test" }] } },
    };
    expect(validateReproducer(malformed)).toBe(false);
    expect(reproducerProviderResponseSchema.safeParse(malformed).success).toBe(false);
  });
});

describe("Verifier Structured Outputs compatibility", () => {
  const valid = {
    outcome: "verified",
    hypothesisId: "hyp-1",
    explanation: "Source and correlated runtime evidence establish the same causal mechanism.",
    evidenceIds: ["ev-source-1", "ev-http-1"],
    missingEvidenceRequest: null,
    unsupportedClaims: [],
    limitations: [],
  };

  it("uses a strict-compatible object graph and accepts the runtime contract", () => {
    expect(() => ajv.compile(VERIFIER_JSON_SCHEMA)).not.toThrow();
    assertStrictObjectGraph(VERIFIER_JSON_SCHEMA);
    expect(validateVerifier(valid)).toBe(true);
    expect(verifierDecisionSchema.safeParse(valid).success).toBe(true);
  });

  it("keeps enums, required fields, nullable values, and non-empty evidence aligned", () => {
    const malformed = [
      { ...valid, outcome: "maybe" },
      { ...valid, hypothesisId: "" },
      { ...valid, explanation: "" },
      { ...valid, evidenceIds: [""] },
      { ...valid, missingEvidenceRequest: 42 },
      { ...valid, unsupportedClaims: undefined },
      { ...valid, limitations: undefined },
      { ...valid, unsupportedClaims: [""] },
      { ...valid, limitations: [""] },
    ];
    for (const value of malformed) {
      expect(validateVerifier(value)).toBe(false);
      expect(verifierDecisionSchema.safeParse(value).success).toBe(false);
    }
    const withRequest = { ...valid, outcome: "insufficient_evidence", missingEvidenceRequest: "Collect correlated logs." };
    expect(validateVerifier(withRequest)).toBe(true);
    expect(verifierDecisionSchema.safeParse(withRequest).success).toBe(true);
  });
});
