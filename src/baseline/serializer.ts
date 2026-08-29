import { createHash } from "node:crypto";
import type { CaseArtifacts, LoadedArtifact } from "../artifacts/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

function numberLines(content: string): string {
  return content
    .split(/\r?\n/u)
    .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

function artifactSection(kind: "SOURCE FILE" | "LOG FILE", artifact: LoadedArtifact): string {
  return [
    `===== BEGIN ${kind}: ${artifact.path} =====`,
    numberLines(artifact.content),
    `===== END ${kind}: ${artifact.path} =====`,
  ].join("\n");
}

export function serializeBaselineArtifacts(artifacts: CaseArtifacts): string {
  const sources = [...artifacts.sources].sort((left, right) => left.path.localeCompare(right.path));
  const logs = [...artifacts.logs].sort((left, right) => left.path.localeCompare(right.path));
  return [
    "===== BEGIN FAILURE REPORT =====",
    canonicalJson(artifacts.manifest.failureReport),
    "===== END FAILURE REPORT =====",
    "",
    "===== BEGIN CASE MANIFEST =====",
    canonicalJson(artifacts.manifest),
    "===== END CASE MANIFEST =====",
    "",
    "===== BEGIN PERMITTED SOURCE FILES =====",
    ...sources.flatMap((source) => [artifactSection("SOURCE FILE", source), ""]),
    "===== END PERMITTED SOURCE FILES =====",
    "",
    "===== BEGIN INITIAL LOGS =====",
    ...logs.flatMap((log) => [artifactSection("LOG FILE", log), ""]),
    "===== END INITIAL LOGS =====",
  ].join("\n");
}

export function hashSerializedContext(context: string): string {
  return createHash("sha256").update(context, "utf8").digest("hex");
}
