import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { z } from "zod";
import { diagnosisSchema } from "../domain/diagnosis.js";
import { tokenUsageSchema } from "../llm/types.js";
import type { CandidateRun, EvaluationAttempt } from "./types.js";

const baselineResultSchema = z.object({
  schemaVersion: z.literal("baseline-result-v1"),
  status: z.literal("completed"),
  caseId: z.string(),
  model: z.string(),
  temperature: z.number().nullable(),
  aggregateArtifactHash: z.string().length(64),
  diagnosis: diagnosisSchema,
  evidenceValidation: z.object({ unsupported: z.array(z.string()) }).passthrough(),
  tokenUsage: tokenUsageSchema,
  durationMs: z.number().nonnegative(),
  calls: z.array(z.unknown()),
}).passthrough();

const agenticResultSchema = z.object({
  schemaVersion: z.literal("agentic-result-v1"),
  caseId: z.string(),
  model: z.string(),
  temperature: z.number().nullable(),
  aggregateArtifactHash: z.string().length(64),
  diagnosis: diagnosisSchema,
  terminationReason: z.string(),
  unsupportedClaimCount: z.number().int().nonnegative(),
  tokenUsage: tokenUsageSchema,
  durationMs: z.number().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  investigationRounds: z.number().int().nonnegative(),
  reproductionAttempts: z.number().int().nonnegative(),
}).passthrough();

function resultAbsolutePath(workspaceRoot: string, relativePath: string): string {
  const resultsRoot = resolve(workspaceRoot, "results");
  const absolute = resolve(workspaceRoot, relativePath);
  const relation = relative(resultsRoot, absolute);
  if (relation.startsWith("..") || resolve(resultsRoot, relation) !== absolute) {
    throw new Error("Evaluation result path is outside the results directory");
  }
  return absolute;
}

export async function readCandidateResult(workspaceRoot: string, attempt: EvaluationAttempt): Promise<CandidateRun> {
  if (attempt.status !== "completed" || attempt.resultPath === undefined) {
    throw new Error("Only completed attempts with result artifacts can be evaluated");
  }
  const content = JSON.parse(await readFile(resultAbsolutePath(workspaceRoot, attempt.resultPath), "utf8")) as unknown;
  if (attempt.mode === "baseline") {
    const result = baselineResultSchema.parse(content);
    if (result.caseId !== attempt.caseId) throw new Error("Baseline result case mismatch");
    return {
      caseId: result.caseId,
      mode: "baseline",
      repetition: attempt.repetition,
      resultPath: attempt.resultPath,
      model: result.model,
      temperature: result.temperature,
      aggregateArtifactHash: result.aggregateArtifactHash,
      diagnosis: result.diagnosis,
      unsupportedClaimCount: result.evidenceValidation.unsupported.length,
      llmCalls: result.calls.length,
      toolCalls: 0,
      investigationRounds: 0,
      reproductionAttempts: 0,
      tokenUsage: result.tokenUsage,
      durationMs: result.durationMs,
      terminationReason: "baseline_completed",
    };
  }
  const result = agenticResultSchema.parse(content);
  if (result.caseId !== attempt.caseId) throw new Error("Agentic result case mismatch");
  return {
    caseId: result.caseId,
    mode: "agentic",
    repetition: attempt.repetition,
    resultPath: attempt.resultPath,
    model: result.model,
    temperature: result.temperature,
    aggregateArtifactHash: result.aggregateArtifactHash,
    diagnosis: result.diagnosis,
    unsupportedClaimCount: result.unsupportedClaimCount,
    llmCalls: result.llmCallCount,
    toolCalls: result.toolCallCount,
    investigationRounds: result.investigationRounds,
    reproductionAttempts: result.reproductionAttempts,
    tokenUsage: result.tokenUsage,
    durationMs: result.durationMs,
    terminationReason: result.terminationReason,
  };
}
