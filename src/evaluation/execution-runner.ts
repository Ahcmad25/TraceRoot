import { relative } from "node:path";
import { runInvestigation } from "../agentic/runner.js";
import { runBaseline } from "../baseline/runner.js";
import type { LlmConfiguration, LlmProvider } from "../llm/types.js";
import { closeTarget, startEphemeralTarget } from "../target-api/server.js";
import type { EphemeralTarget } from "../target-api/server.js";
import { loadSlotAttempts, writeAttempt } from "./attempt-store.js";
import type { EvaluationAttempt, EvaluationMode } from "./types.js";

export interface EvaluationSlot {
  readonly caseId: string;
  readonly mode: EvaluationMode;
  readonly repetition: number;
  readonly attempt: number;
  readonly attemptId: string;
}

export type AttemptExecution =
  | { readonly status: "completed"; readonly resultPath: string; readonly trajectoryPath?: string }
  | { readonly status: "failed"; readonly resultPath?: string; readonly trajectoryPath?: string; readonly error: { code: string; message: string } };

export interface EvaluationExecutionOptions {
  readonly workspaceRoot: string;
  readonly caseIds: readonly string[];
  readonly modes: readonly EvaluationMode[];
  readonly repetitions: number;
  readonly configuration: LlmConfiguration;
  readonly execute: (slot: EvaluationSlot) => Promise<AttemptExecution>;
  readonly clock?: () => Date;
}

export async function withFreshTarget<T>(
  execute: (baseUrl: string) => Promise<T>,
  factory: () => Promise<EphemeralTarget> = startEphemeralTarget,
): Promise<T> {
  const target = await factory();
  try {
    return await execute(target.baseUrl);
  } finally {
    await closeTarget(target.server);
  }
}

export async function runEvaluationAttempts(options: EvaluationExecutionOptions): Promise<readonly EvaluationAttempt[]> {
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) throw new Error("Repetitions must be a positive integer");
  const clock = options.clock ?? (() => new Date());
  const records: EvaluationAttempt[] = [];
  for (const caseId of [...options.caseIds].sort()) {
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      for (const mode of options.modes) {
        const existing = await loadSlotAttempts(options.workspaceRoot, caseId, mode, repetition);
        const completed = existing.find((attempt) => attempt.status === "completed");
        if (completed !== undefined) {
          records.push(completed);
          continue;
        }
        const attempt = existing.length + 1;
        const attemptId = `eval-${caseId}-${mode}-r${String(repetition).padStart(3, "0")}-a${String(attempt).padStart(3, "0")}`;
        const startedAt = clock().toISOString();
        let execution: AttemptExecution;
        try {
          execution = await options.execute({ caseId, mode, repetition, attempt, attemptId });
        } catch (error: unknown) {
          execution = { status: "failed", error: { code: "UNHANDLED_ATTEMPT_FAILURE", message: error instanceof Error ? error.message : "Unknown evaluation attempt failure" } };
        }
        const record = evaluationRecord({
          slot: { caseId, mode, repetition, attempt, attemptId },
          execution,
          configuration: options.configuration,
          startedAt,
          completedAt: clock().toISOString(),
        });
        await writeAttempt(options.workspaceRoot, record);
        records.push(record);
      }
    }
  }
  return Object.freeze(records);
}

function evaluationRecord(input: {
  slot: EvaluationSlot;
  execution: AttemptExecution;
  configuration: LlmConfiguration;
  startedAt: string;
  completedAt: string;
}): EvaluationAttempt {
  return {
    schemaVersion: "evaluation-attempt-v1",
    attemptId: input.slot.attemptId,
    caseId: input.slot.caseId,
    mode: input.slot.mode,
    repetition: input.slot.repetition,
    attempt: input.slot.attempt,
    status: input.execution.status,
    model: input.configuration.modelId,
    temperature: input.configuration.temperature,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.execution.resultPath === undefined ? {} : { resultPath: input.execution.resultPath }),
    ...(input.execution.trajectoryPath === undefined ? {} : { trajectoryPath: input.execution.trajectoryPath }),
    ...(input.execution.status === "failed" ? { error: input.execution.error } : {}),
  };
}

const portable = (workspaceRoot: string, path: string | undefined): string | undefined => path === undefined
  ? undefined
  : relative(workspaceRoot, path).replaceAll("\\", "/");

export function createCredentialedAttemptExecutor(input: {
  workspaceRoot: string;
  provider: () => LlmProvider;
  configuration: LlmConfiguration;
}): (slot: EvaluationSlot) => Promise<AttemptExecution> {
  return async (slot) => {
    if (slot.mode === "baseline") {
      const execution = await runBaseline({
        workspaceRoot: input.workspaceRoot,
        caseId: slot.caseId,
        provider: input.provider(),
        configuration: input.configuration,
        runId: slot.attemptId,
      });
      const resultPath = portable(input.workspaceRoot, execution.resultPath);
      if (execution.ok) {
        return resultPath === undefined
          ? { status: "failed", error: { code: "MISSING_RESULT_ARTIFACT", message: "Baseline completed without a saved result artifact" } }
          : { status: "completed", resultPath };
      }
      return {
            status: "failed",
            ...(resultPath === undefined ? {} : { resultPath }),
            error: { code: execution.error.code, message: execution.error.message },
          };
    }
    return withFreshTarget(async (baseUrl) => {
      const execution = await runInvestigation({
        workspaceRoot: input.workspaceRoot,
        caseId: slot.caseId,
        baseUrl,
        provider: input.provider(),
        configuration: input.configuration,
        runId: slot.attemptId,
      });
      if (!execution.ok) return { status: "failed", error: execution.error };
      const resultPath = portable(input.workspaceRoot, execution.resultPath);
      const trajectoryPath = portable(input.workspaceRoot, execution.trajectoryPath);
      if (resultPath === undefined) return { status: "failed", error: { code: "MISSING_RESULT_ARTIFACT", message: "Agentic run completed without a saved result artifact" } };
      const paths = {
        resultPath,
        ...(trajectoryPath === undefined ? {} : { trajectoryPath }),
      };
      if (["provider_error", "llm_budget_exhausted"].includes(execution.result.terminationReason)) {
        return { status: "failed", ...paths, error: { code: execution.result.terminationReason, message: "Agentic run ended because the provider did not complete the workflow" } };
      }
      return { status: "completed", ...paths };
    });
  };
}
