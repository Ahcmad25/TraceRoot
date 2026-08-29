import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { collectAttempts } from "./attempt-store.js";
import { createHumanReviewSet, writeHumanReviewArtifact } from "./report.js";
import { evaluateAttempts } from "./runner.js";

const REVIEW_SET_SEED = "traceroot-review-set-2026-08-29-v1";

async function main(): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const caseIds = (await readdir(resolve(workspaceRoot, "cases", "public"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^case-\d{3}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const attempts = await collectAttempts(workspaceRoot, caseIds, 1);
  const evaluated = await evaluateAttempts({ workspaceRoot, attempts });
  const mechanisms = new Map([...evaluated.truths].map(([caseId, truth]) => [caseId, truth.causalMechanism]));
  const humanReview = await createHumanReviewSet({
    workspaceRoot,
    candidates: evaluated.candidates,
    mechanisms,
    reviewSetSeed: REVIEW_SET_SEED,
  });
  const path = await writeHumanReviewArtifact({ workspaceRoot, humanReview });
  console.log(JSON.stringify({ path, items: humanReview.items.length, reviewSetSeed: REVIEW_SET_SEED }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to regenerate human-review artifact");
  process.exitCode = 1;
});
