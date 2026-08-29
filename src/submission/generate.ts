import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgenticResultArtifact, AgenticTrajectoryArtifact } from "../agentic/result.js";
import { canonicalJson } from "../baseline/serializer.js";
import type { EvaluationSummary } from "../evaluation/types.js";
import { buildSubmissionEvaluationSummary, sanitizeRepresentativeTrajectory } from "./package.js";

const workspaceRoot = resolve(process.cwd());

const selections = [
  { caseId: "case-001", repetition: 1, label: "clean verified investigation" },
  { caseId: "case-004", repetition: 1, label: "misleading secondary symptom" },
  { caseId: "case-005", repetition: 2, label: "cross-file investigation" },
  { caseId: "case-008", repetition: 3, label: "multi-step source exploration" },
  { caseId: "case-002", repetition: 2, label: "bounded evidence-insufficient abstention" },
] as const;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function main(): Promise<void> {
  const summary = await readJson<EvaluationSummary>(resolve(workspaceRoot, "results", "evaluation", "summary.json"));
  await mkdir(resolve(workspaceRoot, "docs"), { recursive: true });
  await writeFile(
    resolve(workspaceRoot, "docs", "evaluation-summary.json"),
    `${canonicalJson(buildSubmissionEvaluationSummary(summary))}\n`,
    "utf8",
  );

  const trajectoryRoot = resolve(workspaceRoot, "submission", "trajectories");
  await mkdir(trajectoryRoot, { recursive: true });
  for (const selection of selections) {
    const stem = `eval-${selection.caseId}-agentic-r${String(selection.repetition).padStart(3, "0")}-a001`;
    const result = await readJson<AgenticResultArtifact>(resolve(workspaceRoot, "results", "agentic", `${stem}.json`));
    const trajectory = await readJson<AgenticTrajectoryArtifact>(resolve(workspaceRoot, "results", "agentic", `${stem}.trajectory.json`));
    const sanitized = sanitizeRepresentativeTrajectory({ ...selection, result, trajectory });
    await writeFile(resolve(trajectoryRoot, `${selection.caseId}-r${selection.repetition}.json`), `${canonicalJson(sanitized)}\n`, "utf8");
  }
  console.log(`Generated submission-safe evaluation summary and ${selections.length} representative trajectories.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Submission packaging failed");
  process.exitCode = 1;
});
