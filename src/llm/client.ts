import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  llmConfigurationSchema,
  llmMessageSchema,
  LlmProviderError,
  tokenUsageSchema,
  type LlmConfiguration,
  type LlmMessage,
  type LlmProvider,
  type StructuredLlmResult,
} from "./types.js";
import { effectiveLlmConfiguration } from "./model-capabilities.js";
import { buildStructuredOutputValidationDiagnostic } from "./structured-output-diagnostic.js";

export interface StructuredLlmRequest<T> {
  readonly configuration: LlmConfiguration;
  readonly messages: readonly LlmMessage[];
  readonly responseSchemaName: string;
  readonly responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  readonly responseJsonSchema: Readonly<Record<string, unknown>>;
}

function duration(started: number): number {
  return Math.round((performance.now() - started) * 1_000) / 1_000;
}

function parseOutput(output: unknown): unknown {
  if (typeof output !== "string") {
    return output;
  }
  return JSON.parse(output);
}

export async function generateStructured<T>(
  provider: LlmProvider,
  request: StructuredLlmRequest<T>,
): Promise<StructuredLlmResult<T>> {
  const started = performance.now();
  const configuration = llmConfigurationSchema.safeParse(effectiveLlmConfiguration(request.configuration));
  const messages = z.array(llmMessageSchema).safeParse(request.messages);
  if (!configuration.success || !messages.success || request.responseSchemaName.trim() === "") {
    return {
      ok: false,
      error: { code: "INVALID_CONFIGURATION", message: "Invalid LLM configuration or request", retryable: false },
      providerId: provider.providerId,
      modelId: request.configuration.modelId,
      durationMs: duration(started),
    };
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new LlmProviderError("timeout", "LLM request timed out", true)), configuration.data.timeoutMs);
    });
    const response = await Promise.race([
      provider.invoke({
        configuration: configuration.data,
        messages: messages.data,
        responseSchemaName: request.responseSchemaName,
        responseJsonSchema: request.responseJsonSchema,
      }),
      timeoutPromise,
    ]);
    const parsedUsage = response.usage === undefined ? undefined : tokenUsageSchema.safeParse(response.usage);
    if (parsedUsage !== undefined && !parsedUsage.success) {
      return {
        ok: false,
        error: { code: "PROVIDER_ERROR", message: "Provider returned invalid usage metadata", retryable: false },
        providerId: provider.providerId,
        modelId: configuration.data.modelId,
        ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
        durationMs: duration(started),
      };
    }
    let output: unknown;
    try {
      output = parseOutput(response.output);
    } catch {
      return {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "Provider output is not valid JSON",
          retryable: false,
          invalidOutput: response.output,
        },
        providerId: provider.providerId,
        modelId: configuration.data.modelId,
        ...(parsedUsage?.success === true ? { usage: parsedUsage.data } : {}),
        ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
        durationMs: duration(started),
      };
    }
    const structured = request.responseSchema.safeParse(output);
    if (!structured.success) {
      const validationDiagnostic = buildStructuredOutputValidationDiagnostic(output, structured.error.issues);
      const firstIssue = validationDiagnostic.validationIssues[0];
      return {
        ok: false,
        error: {
          code: "INVALID_STRUCTURED_OUTPUT",
          message: firstIssue === undefined
            ? "Provider output failed schema validation"
            : `Structured output failed validation at ${firstIssue.path.join(".") || "<root>"}: ${firstIssue.message}`,
          retryable: false,
          invalidOutput: output,
          validationDiagnostic,
        },
        providerId: provider.providerId,
        modelId: configuration.data.modelId,
        ...(parsedUsage?.success === true ? { usage: parsedUsage.data } : {}),
        ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
        durationMs: duration(started),
      };
    }
    return {
      ok: true,
      value: structured.data,
      ...(parsedUsage?.success === true ? { usage: parsedUsage.data } : {}),
      providerId: provider.providerId,
      modelId: configuration.data.modelId,
      ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
      durationMs: duration(started),
    };
  } catch (error: unknown) {
    if (error instanceof LlmProviderError) {
      return {
        ok: false,
        error: {
          code: error.providerCode === "timeout" ? "TIMEOUT" : "PROVIDER_ERROR",
          message: error.message,
          retryable: error.retryable,
          providerCode: error.providerCode,
        },
        providerId: provider.providerId,
        modelId: configuration.data.modelId,
        durationMs: duration(started),
      };
    }
    return {
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: error instanceof Error ? error.message : "Unknown provider error",
        retryable: false,
      },
      providerId: provider.providerId,
      modelId: configuration.data.modelId,
      durationMs: duration(started),
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
