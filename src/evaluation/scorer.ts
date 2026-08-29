import type { GroundTruth } from "../domain/case.js";
import type { AggregateMetrics, CandidateRun, DeterministicScore, EvaluationMode } from "./types.js";

function normalizedPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase("en-US");
}

function normalizedIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function scoreCandidate(candidate: CandidateRun, truth: GroundTruth): DeterministicScore {
  if (candidate.caseId !== truth.caseId) throw new Error("Candidate and ground truth case IDs differ");
  const categoryCorrect = candidate.diagnosis.category === truth.category;
  const sourceFileCorrect = normalizedPath(candidate.diagnosis.sourceFile) === normalizedPath(truth.sourceFile);
  const symbolCorrect = normalizedIdentifier(candidate.diagnosis.symbol) === normalizedIdentifier(truth.symbol);
  return Object.freeze({
    caseId: candidate.caseId,
    mode: candidate.mode,
    repetition: candidate.repetition,
    categoryCorrect,
    sourceFileCorrect,
    symbolCorrect,
    rootCauseFieldsCorrect: categoryCorrect && sourceFileCorrect && symbolCorrect,
    verificationStatusCorrect: candidate.diagnosis.status === "verified",
    diagnosisStatus: candidate.diagnosis.status,
    unsupportedClaimCount: candidate.unsupportedClaimCount,
    llmCalls: candidate.llmCalls,
    toolCalls: candidate.toolCalls,
    investigationRounds: candidate.investigationRounds,
    reproductionAttempts: candidate.reproductionAttempts,
    totalTokens: candidate.tokenUsage.totalTokens,
    durationMs: candidate.durationMs,
    terminationReason: candidate.terminationReason,
  });
}

const mean = (values: readonly number[]): number => values.length === 0
  ? 0
  : values.reduce((total, value) => total + value, 0) / values.length;
const rate = (values: readonly boolean[]): number => mean(values.map((value) => value ? 1 : 0));
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function aggregateScores(scores: readonly DeterministicScore[], mode: EvaluationMode): AggregateMetrics {
  const selected = scores.filter((score) => score.mode === mode);
  return Object.freeze({
    totalRuns: selected.length,
    categoryAccuracy: rounded(rate(selected.map((score) => score.categoryCorrect))),
    sourceFileAccuracy: rounded(rate(selected.map((score) => score.sourceFileCorrect))),
    symbolAccuracy: rounded(rate(selected.map((score) => score.symbolCorrect))),
    rootCauseFieldsAccuracy: rounded(rate(selected.map((score) => score.rootCauseFieldsCorrect))),
    verifiedDiagnosisRate: rounded(rate(selected.map((score) => score.diagnosisStatus === "verified"))),
    inconclusiveRate: rounded(rate(selected.map((score) => score.diagnosisStatus === "inconclusive"))),
    unsupportedClaimRate: rounded(rate(selected.map((score) => score.unsupportedClaimCount > 0))),
    meanLlmCalls: rounded(mean(selected.map((score) => score.llmCalls))),
    meanToolCalls: rounded(mean(selected.map((score) => score.toolCalls))),
    meanInvestigationRounds: rounded(mean(selected.map((score) => score.investigationRounds))),
    meanReproductionAttempts: rounded(mean(selected.map((score) => score.reproductionAttempts))),
    meanTotalTokens: rounded(mean(selected.map((score) => score.totalTokens))),
    meanDurationMs: rounded(mean(selected.map((score) => score.durationMs))),
  });
}
