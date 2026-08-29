import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { ArtifactLoader } from "../artifacts/loader.js";
import { RunMetadataRecorder } from "../domain/run-metadata.js";
import { generateStructured } from "../llm/client.js";
import type { LlmConfiguration, LlmProvider, StructuredLlmResult, TokenUsage } from "../llm/types.js";
import { effectiveLlmConfiguration } from "../llm/model-capabilities.js";
import { validateEvidenceReferences } from "./evidence-validator.js";
import { buildBaselineMessages, buildFormatRetryMessages, BASELINE_PROMPT_VERSION } from "./prompt.js";
import { serializeBaselineArtifacts, hashSerializedContext } from "./serializer.js";
import { writeBaselineResult, type BaselineCallRecord, type BaselineResultArtifact } from "./result.js";
import { BASELINE_DIAGNOSIS_JSON_SCHEMA, baselineDiagnosisSchema, type BaselineDiagnosis } from "./schema.js";

const ZERO_USAGE: TokenUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

export interface BaselineRunnerOptions {
  readonly workspaceRoot: string;
  readonly caseId: string;
  readonly provider: LlmProvider;
  readonly configuration: LlmConfiguration;
  readonly resultsRoot?: string;
  readonly writeResult?: boolean;
  readonly clock?: () => Date;
  readonly runId?: string;
}

export type BaselineRunnerResult =
  | {
      readonly ok: true;
      readonly result: BaselineResultArtifact;
      readonly resultPath?: string;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean };
      readonly result?: BaselineResultArtifact;
      readonly resultPath?: string;
    };

function addUsage(total: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  if (usage === undefined) return total;
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

function callRecord(
  kind: BaselineCallRecord["kind"],
  result: StructuredLlmResult<BaselineDiagnosis>,
): BaselineCallRecord {
  return Object.freeze({
    kind,
    ok: result.ok,
    durationMs: result.durationMs,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
    ...(result.ok ? {} : {
      error: {
        code: result.error.code,
        message: result.error.message,
        retryable: result.error.retryable,
      },
    }),
  });
}

export async function runBaseline(options: BaselineRunnerOptions): Promise<BaselineRunnerResult> {
  const started = performance.now();
  const clock = options.clock ?? (() => new Date());
  const configuration = effectiveLlmConfiguration(options.configuration);
  const loaded = await new ArtifactLoader(options.workspaceRoot).load(options.caseId);
  if (!loaded.ok) {
    return { ok: false, error: { ...loaded.error, retryable: false } };
  }
  const artifacts = loaded.artifacts;
  const serializedContext = serializeBaselineArtifacts(artifacts);
  const runId = options.runId ?? `baseline-${options.caseId}-${clock().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const metadata = new RunMetadataRecorder({
    runId,
    caseId: options.caseId,
    mode: "baseline",
    llm: configuration,
    promptVersion: BASELINE_PROMPT_VERSION,
    artifactHashes: artifacts.hashes,
    toolVersion: "none",
    clock,
  });
  const calls: BaselineCallRecord[] = [];
  let totalUsage = ZERO_USAGE;
  let formatRetryCount: 0 | 1 = 0;

  const primary = await generateStructured(options.provider, {
    configuration,
    messages: buildBaselineMessages(serializedContext),
    responseSchemaName: "traceroot_baseline_diagnosis",
    responseSchema: baselineDiagnosisSchema,
    responseJsonSchema: BASELINE_DIAGNOSIS_JSON_SCHEMA,
  });
  calls.push(callRecord("reasoning", primary));
  totalUsage = addUsage(totalUsage, primary.usage);
  if (primary.usage !== undefined) metadata.recordTokenUsage(primary.usage);

  let finalCall = primary;
  if (!primary.ok && (primary.error.code === "INVALID_JSON" || primary.error.code === "INVALID_STRUCTURED_OUTPUT")) {
    formatRetryCount = 1;
    const retry = await generateStructured(options.provider, {
      configuration,
      messages: buildFormatRetryMessages(serializedContext, primary.error.invalidOutput),
      responseSchemaName: "traceroot_baseline_diagnosis_format_retry",
      responseSchema: baselineDiagnosisSchema,
      responseJsonSchema: BASELINE_DIAGNOSIS_JSON_SCHEMA,
    });
    calls.push(callRecord("format-retry", retry));
    totalUsage = addUsage(totalUsage, retry.usage);
    if (retry.usage !== undefined) metadata.recordTokenUsage(retry.usage);
    finalCall = retry;
  }

  const providerRequestId = finalCall.providerRequestId ?? primary.providerRequestId;
  const diagnosis = finalCall.ok ? finalCall.value : null;
  const evidenceValidation = diagnosis === null
    ? Object.freeze({ supported: Object.freeze([] as string[]), unsupported: Object.freeze([] as string[]) })
    : validateEvidenceReferences(diagnosis.evidenceIds, artifacts);
  const completedMetadata = metadata.complete();
  const error = finalCall.ok ? undefined : {
    code: finalCall.error.code,
    message: finalCall.error.message,
    retryable: finalCall.error.retryable,
  };
  const result: BaselineResultArtifact = Object.freeze({
    schemaVersion: "baseline-result-v1",
    runId,
    status: finalCall.ok ? "completed" : "failed",
    caseId: options.caseId,
    promptVersion: BASELINE_PROMPT_VERSION,
    model: configuration.modelId,
    temperature: configuration.temperature,
    artifactHashes: artifacts.hashes,
    aggregateArtifactHash: artifacts.hashes.aggregate,
    serializedContextHash: hashSerializedContext(serializedContext),
    diagnosis,
    evidenceValidation,
    tokenUsage: totalUsage,
    durationMs: Math.round((performance.now() - started) * 1_000) / 1_000,
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    formatRetryCount,
    calls: Object.freeze(calls),
    runMetadata: completedMetadata,
    ...(error === undefined ? {} : { error }),
  });

  let resultPath: string | undefined;
  if (options.writeResult !== false) {
    try {
      resultPath = await writeBaselineResult(result, options.resultsRoot ?? resolve(options.workspaceRoot, "results", "baseline"));
    } catch (writeError: unknown) {
      return {
        ok: false,
        error: {
          code: "RESULT_WRITE_FAILED",
          message: writeError instanceof Error ? writeError.message : "Failed to write baseline result",
          retryable: false,
        },
        result,
      };
    }
  }
  return finalCall.ok
    ? { ok: true, result, ...(resultPath === undefined ? {} : { resultPath }) }
    : { ok: false, error: error as NonNullable<typeof error>, result, ...(resultPath === undefined ? {} : { resultPath }) };
}
