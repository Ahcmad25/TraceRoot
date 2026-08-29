import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { canonicalJson } from "../baseline/serializer.js";
import { evaluationAttemptSchema, type EvaluationAttempt, type EvaluationMode } from "./types.js";

function slotRoot(workspaceRoot: string, caseId: string, mode: EvaluationMode, repetition: number): string {
  return resolve(workspaceRoot, "results", "evaluation", "runs", caseId, mode, `rep-${String(repetition).padStart(3, "0")}`);
}

export async function loadSlotAttempts(workspaceRoot: string, caseId: string, mode: EvaluationMode, repetition: number): Promise<readonly EvaluationAttempt[]> {
  const root = slotRoot(workspaceRoot, caseId, mode, repetition);
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => /^attempt-\d{3}\.json$/u.test(name)).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const attempts = await Promise.all(names.map(async (name) => evaluationAttemptSchema.parse(JSON.parse(await readFile(resolve(root, name), "utf8")))));
  return Object.freeze(attempts);
}

function redactSecrets(value: string, environment: NodeJS.ProcessEnv): string {
  return Object.entries(environment)
    .filter(([name, secret]) => secret !== undefined && secret.length >= 4
      && /(api.?key|token|secret|password|credential)/iu.test(name))
    .sort((left, right) => (right[1]?.length ?? 0) - (left[1]?.length ?? 0))
    .reduce((text, [, secret]) => secret === undefined ? text : text.replaceAll(secret, "[REDACTED]"), value);
}

export async function writeAttempt(workspaceRoot: string, attempt: EvaluationAttempt, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const parsed = evaluationAttemptSchema.parse(attempt);
  const root = slotRoot(workspaceRoot, parsed.caseId, parsed.mode, parsed.repetition);
  await mkdir(root, { recursive: true });
  const name = `attempt-${String(parsed.attempt).padStart(3, "0")}.json`;
  const destination = resolve(root, name);
  const temporary = resolve(root, `.${name}.tmp`);
  await writeFile(temporary, redactSecrets(`${canonicalJson(parsed)}\n`, environment), { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
  return relative(workspaceRoot, destination).replaceAll("\\", "/");
}

export async function collectAttempts(workspaceRoot: string, caseIds: readonly string[], repetitions: number): Promise<readonly EvaluationAttempt[]> {
  const attempts: EvaluationAttempt[] = [];
  for (const caseId of caseIds) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const mode of ["baseline", "agentic"] as const) {
        attempts.push(...await loadSlotAttempts(workspaceRoot, caseId, mode, repetition));
      }
    }
  }
  return Object.freeze(attempts);
}
