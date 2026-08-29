import { z } from "zod";
import { diagnosisSchema, type Diagnosis } from "../domain/diagnosis.js";
import { tokenUsageSchema, type TokenUsage } from "../llm/types.js";

export const evaluationModeSchema = z.enum(["baseline", "agentic"]);
export type EvaluationMode = z.infer<typeof evaluationModeSchema>;

export const evaluationAttemptSchema = z.object({
  schemaVersion: z.literal("evaluation-attempt-v1"),
  attemptId: z.string().min(1),
  caseId: z.string().regex(/^case-\d{3}$/u),
  mode: evaluationModeSchema,
  repetition: z.number().int().positive(),
  attempt: z.number().int().positive(),
  status: z.enum(["completed", "failed"]),
  model: z.string().min(1),
  temperature: z.number().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  resultPath: z.string().min(1).optional(),
  trajectoryPath: z.string().min(1).optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().optional(),
}).strict();

export type EvaluationAttempt = z.infer<typeof evaluationAttemptSchema>;

export interface CandidateRun {
  readonly caseId: string;
  readonly mode: EvaluationMode;
  readonly repetition: number;
  readonly resultPath: string;
  readonly model: string;
  readonly temperature: number | null;
  readonly aggregateArtifactHash: string;
  readonly diagnosis: Diagnosis;
  readonly unsupportedClaimCount: number;
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly investigationRounds: number;
  readonly reproductionAttempts: number;
  readonly tokenUsage: TokenUsage;
  readonly durationMs: number;
  readonly terminationReason: string;
}

export const candidateResultSchema = z.object({
  caseId: z.string().regex(/^case-\d{3}$/u),
  mode: evaluationModeSchema,
  repetition: z.number().int().positive(),
  resultPath: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().nullable(),
  aggregateArtifactHash: z.string().length(64),
  diagnosis: diagnosisSchema,
  unsupportedClaimCount: z.number().int().nonnegative(),
  llmCalls: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  investigationRounds: z.number().int().nonnegative(),
  reproductionAttempts: z.number().int().nonnegative(),
  tokenUsage: tokenUsageSchema,
  durationMs: z.number().nonnegative(),
  terminationReason: z.string().min(1),
}).strict();

export interface DeterministicScore {
  readonly caseId: string;
  readonly mode: EvaluationMode;
  readonly repetition: number;
  readonly categoryCorrect: boolean;
  readonly sourceFileCorrect: boolean;
  readonly symbolCorrect: boolean;
  readonly rootCauseFieldsCorrect: boolean;
  readonly verificationStatusCorrect: boolean;
  readonly diagnosisStatus: Diagnosis["status"];
  readonly unsupportedClaimCount: number;
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly investigationRounds: number;
  readonly reproductionAttempts: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly terminationReason: string;
}

export interface AggregateMetrics {
  readonly totalRuns: number;
  readonly categoryAccuracy: number;
  readonly sourceFileAccuracy: number;
  readonly symbolAccuracy: number;
  readonly rootCauseFieldsAccuracy: number;
  readonly verifiedDiagnosisRate: number;
  readonly inconclusiveRate: number;
  readonly unsupportedClaimRate: number;
  readonly meanLlmCalls: number;
  readonly meanToolCalls: number;
  readonly meanInvestigationRounds: number;
  readonly meanReproductionAttempts: number;
  readonly meanTotalTokens: number;
  readonly meanDurationMs: number;
}

export interface EvaluationSummary {
  readonly schemaVersion: "evaluation-summary-v1";
  readonly generatedAt: string;
  readonly scores: readonly DeterministicScore[];
  readonly failedAttempts: readonly EvaluationAttempt[];
  readonly fairnessIssues: readonly string[];
  readonly aggregates: Readonly<Record<EvaluationMode, AggregateMetrics>>;
  readonly differences: Readonly<Record<keyof Omit<AggregateMetrics, "totalRuns">, number>>;
}

export interface HumanReviewItem {
  readonly blindId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly groundTruthMechanism: string;
  readonly candidateMechanism: string;
  readonly supportingEvidenceReferences: readonly string[];
  readonly mechanismCorrect: null;
  readonly reviewerNotes: "";
}
