import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ArtifactLoader } from "../artifacts/loader.js";
import { canonicalJson } from "../baseline/serializer.js";
import type { CandidateRun, EvaluationSummary, HumanReviewItem, HumanReviewSet } from "./types.js";

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

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function neutralizeExcerpt(value: string): string {
  return value
    .replace(/\b(?:trace|repro)-[a-zA-Z0-9._-]+\b/gu, "[request]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[id]")
    .trim();
}

function sourceExcerpt(content: string, symbol: string): string | null {
  const lines = content.split(/\r?\n/u);
  const found = lines.findIndex((line) => line.includes(symbol));
  if (found < 0) return null;
  return lines.slice(Math.max(0, found - 2), Math.min(lines.length, found + 10)).join("\n").trim();
}

export async function createHumanReviewSet(input: {
  workspaceRoot: string;
  candidates: readonly CandidateRun[];
  mechanisms: ReadonlyMap<string, string>;
  reviewSetSeed: string;
}): Promise<HumanReviewSet> {
  if (input.reviewSetSeed.trim() === "") throw new Error("Human-review seed must not be empty");
  const artifactsByCase = new Map<string, Awaited<ReturnType<ArtifactLoader["load"]>>>();
  const drafts: Array<Omit<HumanReviewItem, "blindId"> & { readonly shuffleKey: string }> = [];
  for (const candidate of input.candidates) {
    let loaded = artifactsByCase.get(candidate.caseId);
    if (loaded === undefined) {
      loaded = await new ArtifactLoader(input.workspaceRoot).load(candidate.caseId);
      artifactsByCase.set(candidate.caseId, loaded);
    }
    if (!loaded.ok) throw new Error(`Unable to load public review evidence for ${candidate.caseId}`);
    const normalizedSourcePath = candidate.diagnosis.sourceFile.trim().replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase("en-US");
    const source = loaded.artifacts.sources.find((artifact) => artifact.path.toLocaleLowerCase("en-US") === normalizedSourcePath);
    const excerpt = source === undefined ? null : sourceExcerpt(source.content, candidate.diagnosis.symbol.trim());
    const evidence: HumanReviewItem["supportingEvidence"] = Object.freeze([
      Object.freeze({ label: "evidence-1", kind: "report" as const, excerpt: neutralizeExcerpt(canonicalJson(loaded.artifacts.manifest.failureReport)) }),
      ...(excerpt === null ? [] : [Object.freeze({ label: "evidence-2", kind: "source" as const, excerpt: neutralizeExcerpt(excerpt) })]),
      Object.freeze({ label: excerpt === null ? "evidence-2" : "evidence-3", kind: "log" as const, excerpt: neutralizeExcerpt(loaded.artifacts.logs.map((artifact) => artifact.content).join("\n")) }),
    ]);
    const reviewCaseId = `review-case-${digest(`${input.reviewSetSeed}:case:${candidate.caseId}`).slice(0, 10)}`;
    const contentKey = canonicalJson({
      reviewCaseId,
      repetition: candidate.repetition,
      groundTruthMechanism: input.mechanisms.get(candidate.caseId) ?? "",
      candidateMechanism: candidate.diagnosis.causalMechanism,
      evidence,
    });
    drafts.push({
      reviewCaseId,
      repetition: candidate.repetition,
      groundTruthMechanism: input.mechanisms.get(candidate.caseId) ?? "",
      candidateMechanism: candidate.diagnosis.causalMechanism,
      supportingEvidence: evidence,
      mechanismCorrect: null,
      reviewerNotes: "",
      shuffleKey: digest(`${input.reviewSetSeed}:item:${contentKey}`),
    });
  }
  const items = drafts
    .sort((left, right) => left.shuffleKey.localeCompare(right.shuffleKey))
    .map(({ shuffleKey: _shuffleKey, ...item }, index) => Object.freeze({ blindId: `review-item-${String(index + 1).padStart(3, "0")}`, ...item }));
  return Object.freeze({
    schemaVersion: "human-review-set-v2",
    reviewSetSeed: input.reviewSetSeed,
    items: Object.freeze(items),
  });
}

export async function writeHumanReviewArtifact(input: {
  workspaceRoot: string;
  humanReview: HumanReviewSet;
  environment?: NodeJS.ProcessEnv;
}): Promise<string> {
  const reviewRoot = resolve(input.workspaceRoot, "results", "evaluation", "human-review");
  await mkdir(reviewRoot, { recursive: true });
  const destination = resolve(reviewRoot, "items.json");
  await atomicWrite(destination, `${canonicalJson(redact(input.humanReview, secrets(input.environment ?? process.env)))}\n`);
  return destination;
}

export async function writeEvaluationReports(input: {
  workspaceRoot: string;
  summary: EvaluationSummary;
  humanReview: HumanReviewSet;
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
