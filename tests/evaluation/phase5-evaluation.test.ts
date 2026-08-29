import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GroundTruth } from "../../src/domain/case.js";
import type { Diagnosis } from "../../src/domain/diagnosis.js";
import { loadSlotAttempts, writeAttempt } from "../../src/evaluation/attempt-store.js";
import { runEvaluationAttempts, withFreshTarget } from "../../src/evaluation/execution-runner.js";
import { createHumanReviewSet, renderSummaryMarkdown, writeEvaluationReports } from "../../src/evaluation/report.js";
import { evaluateAttempts, fairnessIssues } from "../../src/evaluation/runner.js";
import { aggregateScores, scoreCandidate } from "../../src/evaluation/scorer.js";
import type { CandidateRun, DeterministicScore, EvaluationAttempt, EvaluationSummary } from "../../src/evaluation/types.js";

const diagnosis: Diagnosis = {
  status: "verified",
  category: "input-validation",
  sourceFile: "src/target-api/scenarios/user-registration.ts",
  symbol: "registerUser",
  causalMechanism: "A missing nested value is dereferenced.",
  explanation: "Source and runtime evidence agree.",
  confidence: 0.9,
  evidenceIds: ["evidence-source", "evidence-http"],
  reproductionSummary: "Reproduced.",
  limitations: [],
};

const truth: GroundTruth = {
  caseId: "case-001",
  category: "input-validation",
  sourceFile: "src/target-api/scenarios/user-registration.ts",
  symbol: "registerUser",
  causalMechanism: "The nested profile is dereferenced before validation.",
  expectedFailure: { status: 500, bodyContains: "failed", logContains: ["ERROR"] },
  notes: "Hidden evaluator fixture.",
};

function candidate(mode: "baseline" | "agentic", repetition = 1, overrides: Partial<CandidateRun> = {}): CandidateRun {
  return {
    caseId: "case-001", mode, repetition, resultPath: `results/${mode}/result.json`, model: "same-model",
    temperature: null, aggregateArtifactHash: "a".repeat(64), diagnosis, unsupportedClaimCount: 0,
    llmCalls: mode === "baseline" ? 1 : 5, toolCalls: mode === "baseline" ? 0 : 2,
    investigationRounds: mode === "baseline" ? 0 : 1, reproductionAttempts: mode === "baseline" ? 0 : 1,
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, durationMs: 100,
    terminationReason: mode === "baseline" ? "baseline_completed" : "verified", ...overrides,
  };
}

function attempt(mode: "baseline" | "agentic", resultPath: string, status: "completed" | "failed" = "completed"): EvaluationAttempt {
  return {
    schemaVersion: "evaluation-attempt-v1", attemptId: `attempt-${mode}`, caseId: "case-001", mode,
    repetition: 1, attempt: 1, status, model: "same-model", temperature: null,
    startedAt: "2026-08-29T00:00:00.000Z", completedAt: "2026-08-29T00:00:01.000Z",
    ...(status === "completed" ? { resultPath } : { error: { code: "TIMEOUT", message: "timeout" } }),
  };
}

describe("Phase 5 deterministic evaluation", () => {
  it("scores normalized deterministic fields exactly without fuzzy mechanism scoring", () => {
    const scored = scoreCandidate(candidate("agentic", 1, {
      diagnosis: { ...diagnosis, sourceFile: ".\\SRC\\TARGET-API\\SCENARIOS\\USER-REGISTRATION.TS", symbol: " RegisterUser " },
    }), truth);
    expect(scored).toMatchObject({ categoryCorrect: true, sourceFileCorrect: true, symbolCorrect: true, rootCauseFieldsCorrect: true });

    const wrong = scoreCandidate(candidate("baseline", 1, {
      diagnosis: { ...diagnosis, symbol: "registerUsers", causalMechanism: truth.causalMechanism },
    }), truth);
    expect(wrong.symbolCorrect).toBe(false);
    expect(wrong.rootCauseFieldsCorrect).toBe(false);
    expect(wrong).not.toHaveProperty("mechanismCorrect");
  });

  it("aggregates three repetitions deterministically", () => {
    const scores: DeterministicScore[] = [1, 2, 3].map((repetition) => ({
      ...scoreCandidate(candidate("baseline", repetition), truth),
      categoryCorrect: repetition < 3,
      rootCauseFieldsCorrect: repetition < 3,
    }));
    expect(aggregateScores(scores, "baseline")).toMatchObject({
      totalRuns: 3,
      categoryAccuracy: 0.666667,
      rootCauseFieldsAccuracy: 0.666667,
      meanLlmCalls: 1,
    });
  });

  it("detects model, effective sampling, and artifact fairness mismatches", () => {
    expect(fairnessIssues([candidate("baseline"), candidate("agentic")])).toEqual([]);
    const issues = fairnessIssues([
      candidate("baseline"),
      candidate("agentic", 1, { model: "other", temperature: 0, aggregateArtifactHash: "b".repeat(64) }),
    ]);
    expect(issues).toHaveLength(3);
  });

  it("parses completed artifacts before loading hidden ground truth", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "traceroot-evaluator-"));
    await mkdir(resolve(root, "results", "baseline"), { recursive: true });
    const resultPath = "results/baseline/result.json";
    await writeFile(resolve(root, resultPath), JSON.stringify({
      schemaVersion: "baseline-result-v1", status: "completed", caseId: "case-001", model: "same-model",
      temperature: null, aggregateArtifactHash: "a".repeat(64), diagnosis,
      evidenceValidation: { supported: [], unsupported: [] }, tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      durationMs: 1, calls: [{}],
    }), "utf8");
    let truthLoads = 0;
    const evaluated = await evaluateAttempts({
      workspaceRoot: root,
      attempts: [attempt("baseline", resultPath)],
      generatedAt: "2026-08-29T00:00:00.000Z",
      truthLoader: async () => { truthLoads += 1; return truth; },
    });
    expect(truthLoads).toBe(1);
    expect(evaluated.summary.scores).toHaveLength(1);

    await writeFile(resolve(root, resultPath), "{}", "utf8");
    truthLoads = 0;
    await expect(evaluateAttempts({ workspaceRoot: root, attempts: [attempt("baseline", resultPath)], truthLoader: async () => { truthLoads += 1; return truth; } })).rejects.toThrow();
    expect(truthLoads).toBe(0);
    const executionSource = await readFile(resolve("src/evaluation/execution-runner.ts"), "utf8");
    expect(executionSource).not.toContain("ground-truth");
    expect(executionSource).not.toContain("groundTruth");
    for (const runnerPath of ["src/baseline/runner.ts", "src/agentic/runner.ts"]) {
      const runnerSource = await readFile(resolve(runnerPath), "utf8");
      expect(runnerSource).not.toContain("ground-truth");
      expect(runnerSource).not.toContain("evaluation/ground-truth-loader");
    }
  });

  it("resumes interrupted three-repetition execution without discarding completed slots", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "traceroot-resume-"));
    const configuration = { modelId: "same-model", temperature: null, timeoutMs: 1_000 } as const;
    const firstCalls: string[] = [];
    await runEvaluationAttempts({
      workspaceRoot: root, caseIds: ["case-001"], modes: ["baseline", "agentic"], repetitions: 3, configuration,
      execute: async (slot) => {
        firstCalls.push(`${slot.mode}:${slot.repetition}`);
        return slot.mode === "agentic" && slot.repetition === 2
          ? { status: "failed", error: { code: "TIMEOUT", message: "transient" } }
          : { status: "completed", resultPath: `results/${slot.mode}/${slot.attemptId}.json` };
      },
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
    });
    expect(firstCalls).toHaveLength(6);

    const resumedCalls: string[] = [];
    await runEvaluationAttempts({
      workspaceRoot: root, caseIds: ["case-001"], modes: ["baseline", "agentic"], repetitions: 3, configuration,
      execute: async (slot) => {
        resumedCalls.push(`${slot.mode}:${slot.repetition}:${slot.attempt}`);
        return { status: "completed", resultPath: `results/${slot.mode}/${slot.attemptId}.json` };
      },
      clock: () => new Date("2026-08-29T00:00:01.000Z"),
    });
    expect(resumedCalls).toEqual(["agentic:2:2"]);
    expect(await loadSlotAttempts(root, "case-001", "agentic", 2)).toMatchObject([
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "completed" },
    ]);
  });

  it("starts every controlled target lifecycle from fresh deterministic state", async () => {
    const requestIds: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      await withFreshTarget(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/users/register`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ada@example.test" }),
        });
        requestIds.push((await response.json() as { requestId: string }).requestId);
      });
    }
    expect(requestIds).toEqual(["trace-0001", "trace-0001"]);
  });

  it("generates summary and blinded review artifacts while redacting secrets", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "traceroot-report-"));
    const secret = "evaluation-secret-value";
    const baselineScore = scoreCandidate(candidate("baseline"), truth);
    const agenticScore = scoreCandidate(candidate("agentic"), truth);
    const baseline = aggregateScores([baselineScore, agenticScore], "baseline");
    const agentic = aggregateScores([baselineScore, agenticScore], "agentic");
    const summary: EvaluationSummary = {
      schemaVersion: "evaluation-summary-v1", generatedAt: "2026-08-29T00:00:00.000Z",
      scores: [baselineScore, agenticScore],
      failedAttempts: [{ ...attempt("baseline", "unused", "failed"), error: { code: "PROVIDER_ERROR", message: secret } }],
      fairnessIssues: [], aggregates: { baseline, agentic },
      differences: {
        categoryAccuracy: 0, sourceFileAccuracy: 0, symbolAccuracy: 0, rootCauseFieldsAccuracy: 0,
        verifiedDiagnosisRate: 0, inconclusiveRate: 0, unsupportedClaimRate: 0, meanLlmCalls: 4,
        meanToolCalls: 2, meanInvestigationRounds: 1, meanReproductionAttempts: 1, meanTotalTokens: 0, meanDurationMs: 0,
      },
    };
    const review = await createHumanReviewSet({
      workspaceRoot: resolve("."),
      candidates: [candidate("baseline"), candidate("agentic")],
      mechanisms: new Map([["case-001", truth.causalMechanism]]),
      reviewSetSeed: "test-review-seed-v1",
    });
    const reviewText = JSON.stringify(review);
    expect(reviewText.toLocaleLowerCase("en-US")).not.toMatch(/"mode"|baseline|agentic|runid|same-model|result\.json|search_source|read_source|search_logs|execute_reproduction|repro-|trace-prod/iu);
    expect(reviewText).not.toMatch(/evidence-[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
    expect(reviewText).not.toMatch(/report:case-|source:src\/|log:cases\//iu);
    expect(review.items[0]).toMatchObject({
      groundTruthMechanism: truth.causalMechanism,
      candidateMechanism: diagnosis.causalMechanism,
      mechanismCorrect: null,
      reviewerNotes: "",
    });
    expect(review.items[0]?.reviewCaseId).not.toContain("case-001");
    expect(review.items[0]?.supportingEvidence.map((item) => item.label)).toEqual(["evidence-1", "evidence-2", "evidence-3"]);
    expect(review.items[0]?.supportingEvidence).toEqual(review.items[1]?.supportingEvidence);
    const reordered = await createHumanReviewSet({
      workspaceRoot: resolve("."),
      candidates: [candidate("agentic"), candidate("baseline")],
      mechanisms: new Map([["case-001", truth.causalMechanism]]),
      reviewSetSeed: "test-review-seed-v1",
    });
    expect(reordered).toEqual(review);
    expect(renderSummaryMarkdown(summary)).toContain("Baseline mean");

    const paths = await writeEvaluationReports({ workspaceRoot: root, summary, humanReview: review, environment: { OPENAI_API_KEY: secret } });
    const serialized = `${await readFile(paths.summaryJson, "utf8")}\n${await readFile(paths.summaryMarkdown, "utf8")}\n${await readFile(paths.humanReview, "utf8")}`;
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    const attemptPath = await writeAttempt(root, {
      ...attempt("agentic", "unused", "failed"),
      error: { code: "PROVIDER_ERROR", message: secret },
    }, { OPENAI_API_KEY: secret });
    const attemptText = await readFile(resolve(root, attemptPath), "utf8");
    expect(attemptText).not.toContain(secret);
    expect(attemptText).toContain("[REDACTED]");
    await expect(writeEvaluationReports({ workspaceRoot: root, summary, humanReview: review, environment: { OPENAI_API_KEY: secret } })).resolves.toBeDefined();
  });
});
