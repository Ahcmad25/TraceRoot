import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { effectiveLlmConfiguration } from "../llm/model-capabilities.js";
import { OpenAiResponsesProvider } from "../llm/openai-responses-provider.js";
import type { LlmConfiguration } from "../llm/types.js";
import { collectAttempts } from "./attempt-store.js";
import { createCredentialedAttemptExecutor, runEvaluationAttempts } from "./execution-runner.js";
import { createHumanReviewItems, writeEvaluationReports } from "./report.js";
import { evaluateAttempts } from "./runner.js";
import type { EvaluationMode } from "./types.js";

const workspaceRoot = resolve(process.cwd());

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function configuration(): LlmConfiguration {
  const modelId = process.env.OPENAI_MODEL?.trim() ?? "";
  if (modelId === "") throw new Error("OPENAI_MODEL must be configured for evaluation runs");
  const temperature = Number.parseFloat(process.env.BASELINE_TEMPERATURE ?? "0");
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "60000", 10);
  if (!Number.isFinite(temperature) || !Number.isInteger(timeoutMs)) throw new Error("Invalid evaluation LLM configuration");
  return effectiveLlmConfiguration({ modelId, temperature, timeoutMs });
}

async function allCases(): Promise<string[]> {
  return (await readdir(resolve(workspaceRoot, "cases", "public"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^case-\d{3}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const requestedCase = option("--case");
  if (!all && requestedCase === undefined) throw new Error("Specify --case case-NNN or --all");
  const caseIds = all ? await allCases() : [requestedCase as string];
  const repetitions = Number.parseInt(option("--repetitions") ?? "3", 10);
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
  const requestedMode = option("--mode") ?? "both";
  if (!["baseline", "agentic", "both"].includes(requestedMode)) throw new Error("--mode must be baseline, agentic, or both");
  const modes: readonly EvaluationMode[] = requestedMode === "both"
    ? ["baseline", "agentic"]
    : [requestedMode as EvaluationMode];
  const plannedSlots = caseIds.length * modes.length * repetitions;
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ dryRun: true, caseIds, modes, repetitions, plannedSlots, message: "Add --execute to permit credentialed model calls." }, null, 2));
    return;
  }

  const llm = configuration();
  const executor = createCredentialedAttemptExecutor({
    workspaceRoot,
    provider: () => new OpenAiResponsesProvider(),
    configuration: llm,
  });
  await runEvaluationAttempts({ workspaceRoot, caseIds, modes, repetitions, configuration: llm, execute: executor });

  // Hidden truth is loaded only here, after every requested implementation attempt has finished.
  const attempts = await collectAttempts(workspaceRoot, caseIds, repetitions);
  const evaluated = await evaluateAttempts({ workspaceRoot, attempts });
  const mechanisms = new Map([...evaluated.truths].map(([caseId, truth]) => [caseId, truth.causalMechanism]));
  const humanReview = createHumanReviewItems(evaluated.candidates, mechanisms);
  const paths = await writeEvaluationReports({ workspaceRoot, summary: evaluated.summary, humanReview });
  console.log(JSON.stringify({ dryRun: false, plannedSlots, completedScores: evaluated.summary.scores.length, failedAttempts: evaluated.summary.failedAttempts.length, fairnessIssues: evaluated.summary.fairnessIssues, paths }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown evaluation failure");
  process.exitCode = 1;
});
