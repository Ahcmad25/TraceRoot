import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "../baseline/serializer.js";
import type { CandidateRun, EvaluationSummary, HumanReviewItem } from "./types.js";

function secrets(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(([name, value]) => value !== undefined && value.length >= 4
      && /(api.?key|token|secret|password|credential)/iu.test(name))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

function redact(value: unknown, values: readonly string[]): unknown {
  if (typeof value === "string") return values.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  if (Array.isArray(value)) return value.map((item) => redact(item, values));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redact(child, values)]));
  }
  return value;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8" });
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderSummaryMarkdown(summary: EvaluationSummary): string {
  const baseline = summary.aggregates.baseline;
  const agentic = summary.aggregates.agentic;
  const rows: Array<[string, number, number, number, boolean]> = [
    ["Category accuracy", baseline.categoryAccuracy, agentic.categoryAccuracy, summary.differences.categoryAccuracy, true],
    ["Source-file accuracy", baseline.sourceFileAccuracy, agentic.sourceFileAccuracy, summary.differences.sourceFileAccuracy, true],
    ["Symbol accuracy", baseline.symbolAccuracy, agentic.symbolAccuracy, summary.differences.symbolAccuracy, true],
    ["All root-cause fields", baseline.rootCauseFieldsAccuracy, agentic.rootCauseFieldsAccuracy, summary.differences.rootCauseFieldsAccuracy, true],
    ["Verified-diagnosis rate", baseline.verifiedDiagnosisRate, agentic.verifiedDiagnosisRate, summary.differences.verifiedDiagnosisRate, true],
    ["Inconclusive rate", baseline.inconclusiveRate, agentic.inconclusiveRate, summary.differences.inconclusiveRate, true],
    ["Unsupported-claim rate", baseline.unsupportedClaimRate, agentic.unsupportedClaimRate, summary.differences.unsupportedClaimRate, true],
    ["Mean LLM calls", baseline.meanLlmCalls, agentic.meanLlmCalls, summary.differences.meanLlmCalls, false],
    ["Mean tool calls", baseline.meanToolCalls, agentic.meanToolCalls, summary.differences.meanToolCalls, false],
    ["Mean investigation rounds", baseline.meanInvestigationRounds, agentic.meanInvestigationRounds, summary.differences.meanInvestigationRounds, false],
    ["Mean reproduction attempts", baseline.meanReproductionAttempts, agentic.meanReproductionAttempts, summary.differences.meanReproductionAttempts, false],
    ["Mean tokens", baseline.meanTotalTokens, agentic.meanTotalTokens, summary.differences.meanTotalTokens, false],
    ["Mean duration (ms)", baseline.meanDurationMs, agentic.meanDurationMs, summary.differences.meanDurationMs, false],
  ];
  const display = (value: number, rate: boolean) => rate ? percentage(value) : value.toFixed(2);
  const lines = [
    "# TraceRoot evaluation summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "Deterministic fields are scored exactly after documented normalization. Causal-mechanism quality is intentionally excluded and emitted for blinded human review.",
    "",
    "| Metric | Baseline mean | Agentic mean | Absolute difference |",
    "|---|---:|---:|---:|",
    ...rows.map(([label, base, agent, difference, isRate]) => `| ${label} | ${display(base, isRate)} | ${display(agent, isRate)} | ${display(difference, isRate)} |`),
    "",
    `Completed scored runs: baseline ${baseline.totalRuns}, agentic ${agentic.totalRuns}.`,
    `Failed attempts retained: ${summary.failedAttempts.length}.`,
    `Fairness issues: ${summary.fairnessIssues.length}.`,
    "",
    "## Per-run results",
    "",
    "| Case | Repetition | Mode | Category | Source | Symbol | Verified | Unsupported claims | LLM calls | Tool calls | Rounds | Reproductions | Tokens | Termination |",
    "|---|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ...summary.scores.map((score) => `| ${score.caseId} | ${score.repetition} | ${score.mode} | ${score.categoryCorrect} | ${score.sourceFileCorrect} | ${score.symbolCorrect} | ${score.diagnosisStatus === "verified"} | ${score.unsupportedClaimCount} | ${score.llmCalls} | ${score.toolCalls} | ${score.investigationRounds} | ${score.reproductionAttempts} | ${score.totalTokens} | ${score.terminationReason} |`),
    "",
  ];
  if (summary.failedAttempts.length > 0) {
    lines.push("## Failed attempts", "", ...summary.failedAttempts.map((attempt) => `- ${attempt.caseId} repetition ${attempt.repetition} ${attempt.mode} attempt ${attempt.attempt}: ${attempt.error?.code ?? "unknown"}`), "");
  }
  if (summary.fairnessIssues.length > 0) lines.push("## Fairness issues", "", ...summary.fairnessIssues.map((issue) => `- ${issue}`), "");
  return `${lines.join("\n")}\n`;
}

export function createHumanReviewItems(candidates: readonly CandidateRun[], mechanisms: ReadonlyMap<string, string>): readonly HumanReviewItem[] {
  return candidates.map((candidate) => Object.freeze({
    blindId: createHash("sha256").update(`traceroot-review:${candidate.caseId}:${candidate.repetition}:${candidate.mode}`).digest("hex").slice(0, 16),
    caseId: candidate.caseId,
    repetition: candidate.repetition,
    groundTruthMechanism: mechanisms.get(candidate.caseId) ?? "",
    candidateMechanism: candidate.diagnosis.causalMechanism,
    supportingEvidenceReferences: Object.freeze([...candidate.diagnosis.evidenceIds]),
    mechanismCorrect: null,
    reviewerNotes: "",
  })).sort((left, right) => left.blindId.localeCompare(right.blindId));
}

export async function writeEvaluationReports(input: {
  workspaceRoot: string;
  summary: EvaluationSummary;
  humanReview: readonly HumanReviewItem[];
  environment?: NodeJS.ProcessEnv;
}): Promise<{ summaryJson: string; summaryMarkdown: string; humanReview: string }> {
  const root = resolve(input.workspaceRoot, "results", "evaluation");
  const reviewRoot = resolve(root, "human-review");
  await mkdir(reviewRoot, { recursive: true });
  const secretValues = secrets(input.environment ?? process.env);
  const summaryJson = resolve(root, "summary.json");
  const summaryMarkdown = resolve(root, "summary.md");
  const humanReview = resolve(reviewRoot, "items.json");
  await Promise.all([
    atomicWrite(summaryJson, `${canonicalJson(redact(input.summary, secretValues))}\n`),
    atomicWrite(summaryMarkdown, redact(renderSummaryMarkdown(input.summary), secretValues) as string),
    atomicWrite(humanReview, `${canonicalJson(redact(input.humanReview, secretValues))}\n`),
  ]);
  return { summaryJson, summaryMarkdown, humanReview };
}
