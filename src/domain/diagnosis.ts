import { z } from "zod";

export const faultCategorySchema = z.enum([
  "input-validation",
  "configuration",
  "type-coercion",
  "data-access",
  "authentication",
  "downstream-service",
  "concurrency",
  "unknown",
]);

export const diagnosisStatusSchema = z.enum([
  "verified",
  "unverified",
  "inconclusive",
]);

export const diagnosisSchema = z.object({
  status: diagnosisStatusSchema,
  category: faultCategorySchema,
  sourceFile: z.string().min(1),
  symbol: z.string().min(1),
  causalMechanism: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)),
  reproductionSummary: z.string().min(1),
  limitations: z.array(z.string()),
});

export type FaultCategory = z.infer<typeof faultCategorySchema>;
export type DiagnosisStatus = z.infer<typeof diagnosisStatusSchema>;
export type Diagnosis = z.infer<typeof diagnosisSchema>;
