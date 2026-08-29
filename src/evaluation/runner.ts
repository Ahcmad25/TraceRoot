import type { GroundTruth } from "../domain/case.js";
import { loadGroundTruth } from "./ground-truth-loader.js";
import { readCandidateResult } from "./result-reader.js";
import { aggregateScores, scoreCandidate } from "./scorer.js";
import type { CandidateRun, EvaluationAttempt, EvaluationSummary } from "./types.js";

function selectedCompletedAttempts(attempts: readonly EvaluationAttempt[]): readonly EvaluationAttempt[] {
  const selected = new Map<string, EvaluationAttempt>();
  for (const attempt of attempts) {
    if (attempt.status !== "completed") continue;
    const key = `${attempt.caseId}:${attempt.mode}:${attempt.repetition}`;
    if (!selected.has(key)) selected.set(key, attempt);
  }
  return [...selected.values()].sort((left, right) => left.caseId.localeCompare(right.caseId)
    || left.repetition - right.repetition || left.mode.localeCompare(right.mode));
}

export function fairnessIssues(candidates: readonly CandidateRun[]): readonly string[] {
  const groups = new Map<string, CandidateRun[]>();
  for (const candidate of candidates) {
    const key = `${candidate.caseId}:${candidate.repetition}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const issues: string[] = [];
  for (const [key, group] of groups) {
    const baseline = group.find((candidate) => candidate.mode === "baseline");
    const agentic = group.find((candidate) => candidate.mode === "agentic");
    if (baseline === undefined || agentic === undefined) {
      issues.push(`${key} does not have both baseline and agentic completed results`);
      continue;
    }
    if (baseline.model !== agentic.model) issues.push(`${key} model mismatch: ${baseline.model} versus ${agentic.model}`);
    if (baseline.temperature !== agentic.temperature) issues.push(`${key} effective temperature mismatch`);
    if (baseline.aggregateArtifactHash !== agentic.aggregateArtifactHash) issues.push(`${key} artifact hash mismatch`);
  }
  return Object.freeze(issues.sort());
}

export async function evaluateAttempts(input: {
  workspaceRoot: string;
  attempts: readonly EvaluationAttempt[];
  generatedAt?: string;
  truthLoader?: (workspaceRoot: string, caseId: string) => Promise<GroundTruth>;
}): Promise<{ summary: EvaluationSummary; candidates: readonly CandidateRun[]; truths: ReadonlyMap<string, GroundTruth> }> {
  // Phase boundary: every completed result artifact is parsed before any hidden ground truth is loaded.
  const completed = selectedCompletedAttempts(input.attempts);
  const candidates = Object.freeze(await Promise.all(completed.map((attempt) => readCandidateResult(input.workspaceRoot, attempt))));
  const truthLoader = input.truthLoader ?? loadGroundTruth;
  const caseIds = [...new Set(candidates.map((candidate) => candidate.caseId))].sort();
  const truthEntries = await Promise.all(caseIds.map(async (caseId) => [caseId, await truthLoader(input.workspaceRoot, caseId)] as const));
  const truths = new Map(truthEntries);
  const scores = Object.freeze(candidates.map((candidate) => scoreCandidate(candidate, truths.get(candidate.caseId) as GroundTruth)));
  const baseline = aggregateScores(scores, "baseline");
  const agentic = aggregateScores(scores, "agentic");
  const differenceKeys = Object.keys(baseline).filter((key) => key !== "totalRuns") as Array<keyof Omit<typeof baseline, "totalRuns">>;
  const differences = Object.fromEntries(differenceKeys.map((key) => [key, Math.round((agentic[key] - baseline[key]) * 1_000_000) / 1_000_000])) as EvaluationSummary["differences"];
  const summary: EvaluationSummary = Object.freeze({
    schemaVersion: "evaluation-summary-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scores,
    failedAttempts: Object.freeze(input.attempts.filter((attempt) => attempt.status === "failed")),
    fairnessIssues: fairnessIssues(candidates),
    aggregates: Object.freeze({ baseline, agentic }),
    differences: Object.freeze(differences),
  });
  return { summary, candidates, truths };
}
