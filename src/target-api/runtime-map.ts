import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { scenarioIdSchema, type ScenarioId } from "./types.js";

const runtimeMapSchema = z.record(z.string().regex(/^case-\d{3}$/u), scenarioIdSchema);

export async function loadRuntimeScenario(workspaceRoot: string, caseId: string): Promise<ScenarioId> {
  if (!/^case-\d{3}$/u.test(caseId)) {
    throw new Error("Invalid case id for runtime scenario lookup");
  }
  const content = await readFile(resolve(workspaceRoot, "cases", "internal", "runtime-map.json"), "utf8");
  const mapping = runtimeMapSchema.parse(JSON.parse(content));
  const scenarioId = mapping[caseId];
  if (scenarioId === undefined) {
    throw new Error(`No runtime scenario is configured for ${caseId}`);
  }
  return scenarioId;
}
