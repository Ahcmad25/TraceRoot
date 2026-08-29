import { z } from "zod";
import { faultCategorySchema } from "../domain/diagnosis.js";
import { reproductionRequestSchema } from "../domain/investigation.js";

export const agentHypothesisSchema = z.object({
  id: z.string().regex(/^hyp-[a-zA-Z0-9_-]+$/u),
  statement: z.string().min(1),
  faultCategory: faultCategorySchema,
  suspectedFile: z.string().min(1),
  suspectedSymbol: z.string().min(1),
  mechanism: z.string().min(1),
  supportingEvidenceIds: z.array(z.string().min(1)),
  contradictingEvidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  verificationPlan: z.string().min(1),
}).strict();

const reason = z.string().min(1);
export const investigatorDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search_source"), arguments: z.object({ query: z.string().min(1), maxMatches: z.number().int().min(1).max(50).optional() }).strict(), reason }).strict(),
  z.object({ action: z.literal("read_source"), arguments: z.object({ path: z.string().min(1), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional() }).strict(), reason }).strict(),
  z.object({ action: z.literal("search_logs"), arguments: z.object({ query: z.string().min(1), maxMatches: z.number().int().min(1).max(50).optional(), contextLines: z.number().int().min(0).max(3).optional() }).strict(), reason }).strict(),
  z.object({ action: z.literal("propose_hypotheses"), arguments: z.object({ hypotheses: z.array(agentHypothesisSchema).min(1).max(3) }).strict(), reason }).strict(),
  z.object({ action: z.literal("request_reproduction"), arguments: z.object({ hypothesisId: z.string().min(1) }).strict(), reason }).strict(),
  z.object({ action: z.literal("finish_inconclusive"), arguments: z.object({ explanation: z.string().min(1) }).strict(), reason }).strict(),
]);

export const reproducerDecisionSchema = z.object({
  hypothesisId: z.string().min(1),
  request: reproductionRequestSchema,
  expected: z.object({
    supporting: z.object({
      logContains: z.array(z.string().min(1)).max(20).default([]),
    }).strict(),
  }).strict(),
  reason: z.string().min(1),
}).strict();

export const verifierDecisionSchema = z.object({
  outcome: z.enum(["verified", "insufficient_evidence", "contradiction"]),
  hypothesisId: z.string().min(1),
  explanation: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  missingEvidenceRequest: z.string().nullable(),
  unsupportedClaims: z.array(z.string().min(1)),
  limitations: z.array(z.string().min(1)),
}).strict();

export type AgentHypothesis = z.infer<typeof agentHypothesisSchema>;
export type InvestigatorDecision = z.infer<typeof investigatorDecisionSchema>;
export type ReproducerDecision = z.infer<typeof reproducerDecisionSchema>;
export type VerifierDecision = z.infer<typeof verifierDecisionSchema>;

const strictObject = (properties: Readonly<Record<string, unknown>>, required = Object.keys(properties)) => ({
  type: "object", additionalProperties: false, properties, required,
});
const nonEmptyStringJsonSchema = { type: "string", minLength: 1 } as const;
const hypothesisJsonSchema = strictObject({
  id: { type: "string", pattern: "^hyp-[a-zA-Z0-9_-]+$" }, statement: nonEmptyStringJsonSchema,
  faultCategory: { type: "string", enum: ["input-validation", "configuration", "type-coercion", "data-access", "authentication", "downstream-service", "concurrency", "unknown"] },
  suspectedFile: nonEmptyStringJsonSchema, suspectedSymbol: nonEmptyStringJsonSchema, mechanism: nonEmptyStringJsonSchema,
  supportingEvidenceIds: { type: "array", items: nonEmptyStringJsonSchema }, contradictingEvidenceIds: { type: "array", items: nonEmptyStringJsonSchema },
  confidence: { type: "number", minimum: 0, maximum: 1 }, verificationPlan: nonEmptyStringJsonSchema,
});

const investigatorActionJsonSchema = (action: InvestigatorDecision["action"], argumentsSchema: Readonly<Record<string, unknown>>) => strictObject({
  action: { type: "string", enum: [action] },
  arguments: argumentsSchema,
  reason: nonEmptyStringJsonSchema,
});

const investigatorDecisionJsonSchema = {
  anyOf: [
    investigatorActionJsonSchema("search_source", strictObject({ query: nonEmptyStringJsonSchema })),
    investigatorActionJsonSchema("read_source", strictObject({ path: nonEmptyStringJsonSchema })),
    investigatorActionJsonSchema("search_logs", strictObject({ query: nonEmptyStringJsonSchema })),
    investigatorActionJsonSchema("propose_hypotheses", strictObject({
      hypotheses: { type: "array", minItems: 1, maxItems: 3, items: hypothesisJsonSchema },
    })),
    investigatorActionJsonSchema("request_reproduction", strictObject({ hypothesisId: nonEmptyStringJsonSchema })),
    investigatorActionJsonSchema("finish_inconclusive", strictObject({ explanation: nonEmptyStringJsonSchema })),
  ],
} as const;

/**
 * OpenAI Structured Outputs does not permit a root-level `anyOf`. The provider
 * envelope keeps the root an object while allowing the nested decision to be a
 * fully correlated discriminated union. The envelope is removed before the
 * unchanged runtime Investigator schema reaches the orchestrator.
 */
export const INVESTIGATOR_JSON_SCHEMA = strictObject({ decision: investigatorDecisionJsonSchema });
export const investigatorProviderResponseSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null || !("decision" in input)) {
    return input;
  }
  return (input as { readonly decision?: unknown }).decision;
}, investigatorDecisionSchema);

const requestBodyEntryJsonSchema = strictObject({
  key: nonEmptyStringJsonSchema,
  value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
});
const requestBodyJsonSchema = {
  anyOf: [
    { type: "null" },
    strictObject({ objectEntries: { type: "array", maxItems: 50, items: requestBodyEntryJsonSchema } }),
  ],
} as const;

export const REPRODUCER_JSON_SCHEMA = strictObject({
  hypothesisId: nonEmptyStringJsonSchema,
  request: strictObject({
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    path: { type: "string", pattern: "^/" },
    body: requestBodyJsonSchema,
  }),
  expected: strictObject({
    supporting: strictObject({
      logContains: { type: "array", maxItems: 20, items: nonEmptyStringJsonSchema },
    }),
  }),
  reason: nonEmptyStringJsonSchema,
});

const encodedRequestBodySchema = z.union([
  z.null(),
  z.object({
    objectEntries: z.array(z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }).strict()).max(50),
  }).strict(),
]);
const reproducerProviderRawSchema = z.object({
  hypothesisId: z.string().min(1),
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().startsWith("/"),
    body: encodedRequestBodySchema,
  }).strict(),
  expected: z.object({
    supporting: z.object({
      logContains: z.array(z.string().min(1)).max(20),
    }).strict(),
  }).strict(),
  reason: z.string().min(1),
}).strict();

function hasEncodedRequestBody(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const request = (input as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) return false;
  const body = (request as { readonly body?: unknown }).body;
  return typeof body === "object" && body !== null && "objectEntries" in body;
}

export const reproducerProviderResponseSchema = z.preprocess((input) => {
  const encoded = reproducerProviderRawSchema.safeParse(input);
  if (!encoded.success) return hasEncodedRequestBody(input) ? {} : input;
  const body = encoded.data.request.body;
  return {
    ...encoded.data,
    request: {
      ...encoded.data.request,
      body: body === null ? null : Object.fromEntries(body.objectEntries.map(({ key, value }) => [key, value])),
    },
  };
}, reproducerDecisionSchema);

export const VERIFIER_JSON_SCHEMA = strictObject({
  outcome: { type: "string", enum: ["verified", "insufficient_evidence", "contradiction"] },
  hypothesisId: nonEmptyStringJsonSchema,
  explanation: nonEmptyStringJsonSchema,
  evidenceIds: { type: "array", items: nonEmptyStringJsonSchema },
  missingEvidenceRequest: { type: ["string", "null"] },
  unsupportedClaims: {
    type: "array",
    description: "Positive factual assertions made by the diagnosis that are not supported by cited evidence; do not include caveats or non-claims.",
    items: nonEmptyStringJsonSchema,
  },
  limitations: {
    type: "array",
    description: "Caveats, uncertainty, and facts the evidence explicitly does not establish; these are not unsupported positive claims.",
    items: nonEmptyStringJsonSchema,
  },
});
