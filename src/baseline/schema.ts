import { z } from "zod";
import { diagnosisSchema } from "../domain/diagnosis.js";

export const BASELINE_REPRODUCTION_SUMMARY = "Not attempted by baseline.";

export const baselineDiagnosisSchema = diagnosisSchema.superRefine((diagnosis, context) => {
  if (diagnosis.status === "verified") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "A one-shot baseline diagnosis cannot be verified",
    });
  }
  if (diagnosis.reproductionSummary !== BASELINE_REPRODUCTION_SUMMARY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reproductionSummary"],
      message: `reproductionSummary must be exactly: ${BASELINE_REPRODUCTION_SUMMARY}`,
    });
  }
});

export type BaselineDiagnosis = z.infer<typeof baselineDiagnosisSchema>;

export const BASELINE_DIAGNOSIS_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "category",
    "sourceFile",
    "symbol",
    "causalMechanism",
    "explanation",
    "confidence",
    "evidenceIds",
    "reproductionSummary",
    "limitations",
  ],
  properties: {
    status: { type: "string", enum: ["unverified", "inconclusive"] },
    category: {
      type: "string",
      enum: [
        "input-validation",
        "configuration",
        "type-coercion",
        "data-access",
        "authentication",
        "downstream-service",
        "concurrency",
        "unknown",
      ],
    },
    sourceFile: { type: "string", minLength: 1 },
    symbol: { type: "string", minLength: 1 },
    causalMechanism: { type: "string", minLength: 1 },
    explanation: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidenceIds: { type: "array", items: { type: "string", minLength: 1 } },
    reproductionSummary: { type: "string", const: BASELINE_REPRODUCTION_SUMMARY },
    limitations: { type: "array", items: { type: "string" } },
  },
});
