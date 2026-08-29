import { z } from "zod";
import { faultCategorySchema } from "./diagnosis.js";

export const failureReportSchema = z.object({
  summary: z.string().min(1),
  endpoint: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  observedStatus: z.number().int().min(100).max(599),
  observedError: z.string().min(1),
  requestContext: z.record(z.unknown()),
}).strict();

export const failureCaseSchema = z.object({
  id: z.string().regex(/^case-\d{3}$/),
  title: z.string().min(1),
  failureReport: failureReportSchema,
  permittedSourceFiles: z.array(z.string().min(1)).min(1),
  initialLogFiles: z.array(z.string().min(1)).min(1),
}).strict();

export const groundTruthSchema = z.object({
  caseId: z.string().regex(/^case-\d{3}$/),
  category: faultCategorySchema,
  sourceFile: z.string().min(1),
  symbol: z.string().min(1),
  causalMechanism: z.string().min(1),
  expectedFailure: z.object({
    status: z.number().int().min(100).max(599),
    bodyContains: z.string().min(1),
    logContains: z.array(z.string().min(1)).min(1),
  }),
  notes: z.string().min(1),
});

export type FailureReport = z.infer<typeof failureReportSchema>;
export type FailureCase = z.infer<typeof failureCaseSchema>;
export type GroundTruth = z.infer<typeof groundTruthSchema>;
