import { z } from "zod";

export const llmConfigurationSchema = z.object({
  modelId: z.string().min(1),
  temperature: z.number().min(0).max(2).nullable(),
  timeoutMs: z.number().int().min(1).max(120_000),
});

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const llmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type LlmConfiguration = z.infer<typeof llmConfigurationSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type LlmMessage = z.infer<typeof llmMessageSchema>;

export interface RawLlmResponse {
  readonly output: unknown;
  readonly usage?: TokenUsage;
  readonly providerRequestId?: string;
}

export interface LlmProvider {
  readonly providerId: string;
  invoke(input: {
    readonly configuration: LlmConfiguration;
    readonly messages: readonly LlmMessage[];
    readonly responseSchemaName: string;
    readonly responseJsonSchema: Readonly<Record<string, unknown>>;
  }): Promise<RawLlmResponse>;
}

export type LlmErrorCode =
  | "INVALID_CONFIGURATION"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_JSON"
  | "INVALID_STRUCTURED_OUTPUT";

export interface StructuredOutputValidationIssue {
  readonly path: readonly (string | number)[];
  readonly expected: string;
  readonly receivedType: string;
  readonly receivedValueSummary: string;
  readonly message: string;
}

export interface StructuredOutputValidationDiagnostic {
  readonly parsedJson: unknown;
  readonly actionDiscriminator: unknown | null;
  readonly topLevelKeys: readonly string[];
  readonly validationIssues: readonly StructuredOutputValidationIssue[];
}

export interface LlmError {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerCode?: string;
  readonly invalidOutput?: unknown;
  readonly validationDiagnostic?: StructuredOutputValidationDiagnostic;
}

export type StructuredLlmResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly usage?: TokenUsage;
      readonly providerId: string;
      readonly modelId: string;
      readonly providerRequestId?: string;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly error: LlmError;
      readonly providerId: string;
      readonly modelId: string;
      readonly usage?: TokenUsage;
      readonly providerRequestId?: string;
      readonly durationMs: number;
    };

export class LlmProviderError extends Error {
  public constructor(
    public readonly providerCode: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
