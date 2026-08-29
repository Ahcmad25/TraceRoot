import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArtifactHashes } from "../artifacts/types.js";
import { canonicalJson } from "../baseline/serializer.js";
import type { Diagnosis } from "../domain/diagnosis.js";
import type { InvestigationSnapshot } from "../domain/investigation.js";
import type { TokenUsage } from "../llm/types.js";
import type { ToolName } from "../tools/contracts.js";

export interface AgenticResultArtifact {
  readonly schemaVersion: "agentic-result-v1";
  readonly runId: string;
  readonly caseId: string;
  readonly model: string;
  readonly temperature: number | null;
  readonly promptVersions: Readonly<Record<"investigator" | "reproducer" | "verifier", string>>;
  readonly artifactHashes: ArtifactHashes;
  readonly aggregateArtifactHash: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly diagnosis: Diagnosis;
  readonly terminationReason: string;
  readonly unsupportedClaimCount: number;
  readonly unsupportedReferences: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly tokenUsage: TokenUsage;
  readonly llmCallCount: number;
  readonly toolCallCount: number;
  readonly toolCalls: Readonly<Record<ToolName, number>>;
  readonly investigationRounds: number;
  readonly reproductionAttempts: number;
  readonly trajectoryFile: string;
}

export interface AgenticTrajectoryArtifact {
  readonly schemaVersion: "agentic-trajectory-v3";
  readonly runId: string;
  readonly caseId: string;
  readonly promptVersions: AgenticResultArtifact["promptVersions"];
  readonly aggregateArtifactHash: string;
  readonly investigation: InvestigationSnapshot;
}

function environmentSecrets(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(([name, value]) => value !== undefined && value.length >= 4
      && /(api.?key|token|secret|password|credential)/iu.test(name))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redact(child, secrets)]));
  }
  return value;
}

export function serializeAgenticArtifact(value: AgenticResultArtifact | AgenticTrajectoryArtifact, environment: NodeJS.ProcessEnv = process.env): string {
  return `${canonicalJson(redact(value, environmentSecrets(environment)))}\n`;
}

async function atomicWrite(path: string, value: AgenticResultArtifact | AgenticTrajectoryArtifact, environment: NodeJS.ProcessEnv): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, serializeAgenticArtifact(value, environment), { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

export async function writeAgenticArtifacts(input: {
  readonly result: AgenticResultArtifact;
  readonly trajectory: AgenticTrajectoryArtifact;
  readonly resultsRoot: string;
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<{ resultPath: string; trajectoryPath: string }> {
  await mkdir(input.resultsRoot, { recursive: true });
  const safeRunId = input.result.runId.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const resultPath = resolve(input.resultsRoot, `${safeRunId}.json`);
  const trajectoryPath = resolve(input.resultsRoot, `${safeRunId}.trajectory.json`);
  const environment = input.environment ?? process.env;
  await atomicWrite(trajectoryPath, input.trajectory, environment);
  await atomicWrite(resultPath, input.result, environment);
  return { resultPath, trajectoryPath };
}
