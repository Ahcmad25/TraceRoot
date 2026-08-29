import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { ArtifactLoader } from "../artifacts/loader.js";
import type { LlmConfiguration, LlmProvider } from "../llm/types.js";
import { effectiveLlmConfiguration } from "../llm/model-capabilities.js";
import type { ToolRuntimeOptions } from "../tools/contracts.js";
import { runAgenticInvestigation, type AgenticLimits } from "./orchestrator.js";
import { writeAgenticArtifacts, type AgenticResultArtifact, type AgenticTrajectoryArtifact } from "./result.js";
import { createAgenticTools } from "./toolset.js";

export interface AgenticRunnerOptions {
  readonly workspaceRoot: string;
  readonly caseId: string;
  readonly baseUrl: string;
  readonly provider: LlmProvider;
  readonly configuration: LlmConfiguration;
  readonly limits?: Partial<AgenticLimits>;
  readonly toolRuntime?: ToolRuntimeOptions;
  readonly resultsRoot?: string;
  readonly writeResult?: boolean;
  readonly runId?: string;
  readonly clock?: () => Date;
}

export type AgenticRunnerResult =
  | { readonly ok: true; readonly result: AgenticResultArtifact; readonly trajectory: AgenticTrajectoryArtifact; readonly resultPath?: string; readonly trajectoryPath?: string }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export async function runInvestigation(options: AgenticRunnerOptions): Promise<AgenticRunnerResult> {
  const clock = options.clock ?? (() => new Date());
  const configuration = effectiveLlmConfiguration(options.configuration);
  const loaded = await new ArtifactLoader(options.workspaceRoot).load(options.caseId);
  if (!loaded.ok) return { ok: false, error: { code: loaded.error.code, message: loaded.error.message } };
  const artifacts = loaded.artifacts;
  const startedAt = clock().toISOString();
  const runId = options.runId ?? `agentic-${options.caseId}-${startedAt.replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const tools = await createAgenticTools({
    artifacts,
    workspaceRoot: options.workspaceRoot,
    baseUrl: options.baseUrl,
    ...(options.toolRuntime === undefined ? {} : { runtime: options.toolRuntime }),
  });
  const run = await runAgenticInvestigation({
    investigationId: runId,
    artifacts,
    provider: options.provider,
    configuration,
    tools,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    clock,
  });
  const completedAt = clock().toISOString();
  const trajectoryFile = `${runId.replace(/[^a-zA-Z0-9._-]/gu, "_")}.trajectory.json`;
  const result: AgenticResultArtifact = Object.freeze({
    schemaVersion: "agentic-result-v1",
    runId,
    caseId: artifacts.caseId,
    model: configuration.modelId,
    temperature: configuration.temperature,
    promptVersions: run.promptVersions,
    artifactHashes: artifacts.hashes,
    aggregateArtifactHash: artifacts.hashes.aggregate,
    startedAt,
    completedAt,
    durationMs: run.metrics.durationMs,
    diagnosis: run.diagnosis,
    terminationReason: run.terminationReason,
    unsupportedClaimCount: run.unsupportedClaimCount,
    unsupportedReferences: run.unsupportedReferences,
    unsupportedClaims: run.unsupportedClaims,
    tokenUsage: run.metrics.tokenUsage,
    llmCallCount: run.metrics.llmCalls,
    toolCallCount: run.metrics.totalToolCalls,
    toolCalls: run.metrics.toolCalls,
    investigationRounds: run.metrics.investigationRounds,
    reproductionAttempts: run.metrics.reproductionAttempts,
    trajectoryFile,
  });
  const trajectory: AgenticTrajectoryArtifact = Object.freeze({
    schemaVersion: "agentic-trajectory-v3",
    runId,
    caseId: artifacts.caseId,
    promptVersions: run.promptVersions,
    aggregateArtifactHash: artifacts.hashes.aggregate,
    investigation: run.trajectory,
  });
  if (options.writeResult === false) return { ok: true, result, trajectory };
  try {
    const paths = await writeAgenticArtifacts({
      result,
      trajectory,
      resultsRoot: options.resultsRoot ?? resolve(options.workspaceRoot, "results", "agentic"),
    });
    if (basename(paths.trajectoryPath) !== trajectoryFile) throw new Error("Trajectory filename mismatch");
    return { ok: true, result, trajectory, ...paths };
  } catch (error: unknown) {
    return { ok: false, error: { code: "RESULT_WRITE_FAILED", message: error instanceof Error ? error.message : "Failed to write agentic result" } };
  }
}
