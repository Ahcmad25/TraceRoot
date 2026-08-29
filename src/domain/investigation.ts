import { z } from "zod";
import { diagnosisSchema } from "./diagnosis.js";
import { failureReportSchema } from "./case.js";

export const investigationModeSchema = z.enum(["baseline", "agentic"]);

export const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["report", "source", "log", "http"]),
  origin: z.string().min(1),
  locator: z.string().min(1),
  content: z.string(),
  collectedAt: z.string().datetime(),
});

export const hypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  faultCategory: z.enum([
    "input-validation", "configuration", "type-coercion", "data-access",
    "authentication", "downstream-service", "concurrency", "unknown",
  ]),
  suspectedSourceFile: z.string().min(1),
  suspectedSymbol: z.string().min(1),
  mechanism: z.string().min(1),
  verificationPlan: z.string().min(1),
  supportingEvidenceIds: z.array(z.string().min(1)),
  contradictingEvidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  status: z.enum(["proposed", "tested", "supported", "rejected"]),
});

export const reproductionRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

export const experimentSchema = z.object({
  id: z.string().min(1),
  hypothesisId: z.string().min(1),
  request: reproductionRequestSchema,
  expectedObservation: z.string().min(1),
  actualObservation: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  outcome: z.enum(["reproduced", "not-reproduced", "inconclusive"]),
});

const eventBase = {
  sequence: z.number().int().positive(),
  recordedAt: z.string().datetime(),
};

export const investigationEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("investigation-started"),
    investigationId: z.string().min(1),
    caseId: z.string().min(1),
    mode: investigationModeSchema,
    failureReport: failureReportSchema,
  }),
  z.object({ ...eventBase, type: z.literal("evidence-recorded"), evidence: evidenceSchema }),
  z.object({ ...eventBase, type: z.literal("hypothesis-recorded"), hypothesis: hypothesisSchema }),
  z.object({ ...eventBase, type: z.literal("experiment-recorded"), experiment: experimentSchema }),
  z.object({ ...eventBase, type: z.literal("diagnosis-recorded"), diagnosis: diagnosisSchema }),
  z.object({
    ...eventBase,
    type: z.literal("agent-step-recorded"),
    role: z.enum(["orchestrator", "investigator", "reproducer", "verifier"]),
    promptVersion: z.string().nullable(),
    stepKind: z.enum([
      "role-decision", "tool-invocation", "tool-result", "hypothesis-change",
      "reproduction-result", "verifier-feedback", "termination",
    ]),
    structuredData: z.unknown(),
    evidenceIds: z.array(z.string()),
    budgetState: z.record(z.number().nonnegative()),
    humanCheckpoint: z.string().nullable(),
  }),
]);

export type InvestigationMode = z.infer<typeof investigationModeSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type ReproductionRequest = z.infer<typeof reproductionRequestSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export type InvestigationEvent = z.infer<typeof investigationEventSchema>;
export type AgentStep = Extract<InvestigationEvent, { type: "agent-step-recorded" }>;

export interface InvestigationSnapshot {
  readonly investigationId: string;
  readonly caseId: string;
  readonly mode: InvestigationMode;
  readonly status: "running" | "completed";
  readonly failureReport: z.infer<typeof failureReportSchema>;
  readonly evidence: readonly Evidence[];
  /** Append-only hypothesis revision history. */
  readonly hypotheses: readonly Hypothesis[];
  /** Latest non-rejected revision for each hypothesis id. */
  readonly activeHypotheses: readonly Hypothesis[];
  readonly experiments: readonly Experiment[];
  readonly diagnosis?: z.infer<typeof diagnosisSchema>;
  readonly events: readonly InvestigationEvent[];
}
