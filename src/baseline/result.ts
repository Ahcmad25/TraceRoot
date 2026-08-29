import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArtifactHashes } from "../artifacts/types.js";
import type { RunMetadata } from "../domain/run-metadata.js";
import type { TokenUsage } from "../llm/types.js";
import { canonicalJson } from "./serializer.js";
import type { BaselineDiagnosis } from "./schema.js";

export interface BaselineCallRecord {
  readonly kind: "reasoning" | "format-retry";
  readonly ok: boolean;
  readonly durationMs: number;
  readonly usage?: TokenUsage;
  readonly providerRequestId?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface BaselineResultArtifact {
  readonly schemaVersion: "baseline-result-v1";
  readonly runId: string;
  readonly status: "completed" | "failed";
  readonly caseId: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly temperature: number | null;
  readonly artifactHashes: ArtifactHashes;
  readonly aggregateArtifactHash: string;
  readonly serializedContextHash: string;
  readonly diagnosis: BaselineDiagnosis | null;
  readonly evidenceValidation: {
    readonly supported: readonly string[];
    readonly unsupported: readonly string[];
  };
  readonly tokenUsage: TokenUsage;
  readonly durationMs: number;
  readonly providerRequestId?: string;
  readonly formatRetryCount: 0 | 1;
  readonly calls: readonly BaselineCallRecord[];
  readonly runMetadata: RunMetadata;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

function secretValues(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(([name, value]) => value !== undefined
      && value.length >= 4
      && /(api.?key|token|secret|password|credential)/iu.test(name))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, secrets));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, redact(child, secrets)]),
    );
  }
  return value;
}

export function serializeBaselineResult(
  result: BaselineResultArtifact,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return `${canonicalJson(redact(result, secretValues(environment)))}\n`;
}

export async function writeBaselineResult(
  result: BaselineResultArtifact,
  resultsRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  await mkdir(resultsRoot, { recursive: true });
  const safeRunId = result.runId.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const destination = resolve(resultsRoot, `${safeRunId}.json`);
  const temporary = resolve(resultsRoot, `.${safeRunId}.tmp`);
  await writeFile(temporary, serializeBaselineResult(result, environment), { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
  return destination;
}
