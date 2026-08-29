import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { groundTruthSchema, type GroundTruth } from "../domain/case.js";

export async function loadGroundTruth(workspaceRoot: string, caseId: string): Promise<GroundTruth> {
  if (!/^case-\d{3}$/u.test(caseId)) throw new Error("Ground-truth case id must match case-NNN");
  const path = resolve(workspaceRoot, "cases", "ground-truth", `${caseId}.json`);
  const parsed = groundTruthSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (parsed.caseId !== caseId) throw new Error(`Ground truth case mismatch for ${caseId}`);
  return Object.freeze(parsed);
}
