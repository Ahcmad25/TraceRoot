import { LlmProviderError, type LlmProvider, type RawLlmResponse, type TokenUsage } from "./types.js";
import { effectiveLlmConfiguration } from "./model-capabilities.js";

export const OPENAI_RESPONSES_PROVIDER_VERSION = "1.1.1";

export interface OpenAiResponseShapeDiagnostics {
  readonly responseId: string | null;
  readonly httpStatus: number;
  readonly responseStatus: string | null;
  readonly topLevelKeys: readonly string[];
  readonly outputItemTypes: readonly string[];
  readonly contentItemTypes: readonly string[];
  readonly hasTopLevelOutputText: boolean;
  readonly hasContentOutputText: boolean;
  readonly hasParsedStructuredOutput: boolean;
}

export interface OpenAiResponsesProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly debugLogger?: (diagnostics: OpenAiResponseShapeDiagnostics) => void;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: JsonRecord, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function sanitize(message: string, secret: string): string {
  const withoutExactSecret = secret === "" ? message : message.replaceAll(secret, "[REDACTED]");
  return withoutExactSecret
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_*.-]{6,}\b/gu, "[REDACTED]");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function shapeDiagnostics(value: unknown, httpStatus: number): OpenAiResponseShapeDiagnostics {
  const root = isRecord(value) ? value : {};
  const output = Array.isArray(root.output) ? root.output : [];
  const outputRecords = output.filter(isRecord);
  const contentRecords = outputRecords.flatMap((item) => Array.isArray(item.content) ? item.content.filter(isRecord) : []);
  return Object.freeze({
    responseId: stringField(root, "id") ?? null,
    httpStatus,
    responseStatus: stringField(root, "status") ?? null,
    topLevelKeys: Object.freeze(Object.keys(root).sort()),
    outputItemTypes: Object.freeze(outputRecords.map((item) => stringField(item, "type") ?? "<missing>")),
    contentItemTypes: Object.freeze(contentRecords.map((item) => stringField(item, "type") ?? "<missing>")),
    hasTopLevelOutputText: typeof root.output_text === "string",
    hasContentOutputText: contentRecords.some((item) => item.type === "output_text" && typeof item.text === "string"),
    hasParsedStructuredOutput: root.output_parsed !== undefined
      || contentRecords.some((item) => item.type === "output_text" && item.parsed !== undefined),
  });
}

function parseUsage(root: JsonRecord): TokenUsage | undefined {
  if (!isRecord(root.usage)) return undefined;
  const input = root.usage.input_tokens;
  const output = root.usage.output_tokens;
  const total = root.usage.total_tokens;
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0
    || typeof output !== "number" || !Number.isInteger(output) || output < 0) return undefined;
  const totalTokens = typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : input + output;
  return { inputTokens: input, outputTokens: output, totalTokens };
}

function providerError(root: JsonRecord): { code?: string; message: string } | undefined {
  if (!isRecord(root.error) || typeof root.error.message !== "string") return undefined;
  const code = typeof root.error.code === "string"
    ? root.error.code
    : typeof root.error.type === "string" ? root.error.type : undefined;
  return { ...(code === undefined ? {} : { code }), message: root.error.message };
}

function extractStructuredOutput(root: JsonRecord): unknown | undefined {
  const output = Array.isArray(root.output) ? root.output : [];
  const candidates: Array<{ value: unknown; phase: string | undefined }> = [];
  let refusal: string | undefined;
  for (const item of output) {
    if (!isRecord(item) || item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === "refusal" && typeof content.refusal === "string") refusal = content.refusal;
      if (content.type !== "output_text") continue;
      if (content.parsed !== undefined) candidates.push({ value: content.parsed, phase: stringField(item, "phase") });
      else if (typeof content.text === "string") candidates.push({ value: content.text, phase: stringField(item, "phase") });
    }
  }
  const preferred = candidates.filter((candidate) => candidate.phase === "final").at(-1)
    ?? candidates.filter((candidate) => candidate.phase !== "commentary").at(-1)
    ?? candidates.at(-1);
  if (preferred !== undefined) return preferred.value;
  if (root.output_parsed !== undefined) return root.output_parsed;
  if (typeof root.output_text === "string") return root.output_text;
  if (refusal !== undefined) throw new LlmProviderError("refusal", "OpenAI refused to produce structured output", false);
  return undefined;
}

export class OpenAiResponsesProvider implements LlmProvider {
  public readonly providerId = "openai-responses";
  public readonly providerVersion = OPENAI_RESPONSES_PROVIDER_VERSION;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #debugLogger: ((diagnostics: OpenAiResponseShapeDiagnostics) => void) | undefined;

  public constructor(options: OpenAiResponsesProviderOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/u, "");
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#debugLogger = options.debugLogger ?? (process.env.TRACEROOT_OPENAI_DEBUG === "1"
      ? (diagnostics) => console.error(JSON.stringify({ event: "openai_response_shape", ...diagnostics }))
      : undefined);
  }

  public async invoke(input: Parameters<LlmProvider["invoke"]>[0]): Promise<RawLlmResponse> {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (apiKey.trim() === "") throw new LlmProviderError("missing_api_key", "OPENAI_API_KEY is not configured", false);

    const configuration = effectiveLlmConfiguration(input.configuration);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: configuration.modelId,
          ...(configuration.temperature === null ? {} : { temperature: configuration.temperature }),
          input: input.messages.map((message) => ({ role: message.role, content: message.content })),
          text: { format: { type: "json_schema", name: input.responseSchemaName, strict: true, schema: input.responseJsonSchema } },
          tools: [], tool_choice: "none", store: false,
        }),
        signal: AbortSignal.timeout(input.configuration.timeoutMs),
      });
    } catch (error: unknown) {
      const message = sanitize(error instanceof Error ? error.message : "OpenAI request failed", apiKey);
      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      throw new LlmProviderError(timedOut ? "timeout" : "network_error", message, true);
    }

    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > 2 * 1024 * 1024) {
      throw new LlmProviderError("response_too_large", "OpenAI response exceeded the 2 MiB limit", false);
    }
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new LlmProviderError("invalid_response", `OpenAI returned non-JSON HTTP ${response.status}`, isRetryableStatus(response.status));
    }
    this.#debugLogger?.(shapeDiagnostics(responseJson, response.status));
    if (!isRecord(responseJson)) throw new LlmProviderError("invalid_response", "OpenAI returned a non-object response", false);

    const error = providerError(responseJson);
    if (!response.ok || error !== undefined) {
      throw new LlmProviderError(
        error?.code ?? `http_${response.status}`,
        sanitize(error?.message ?? `OpenAI returned HTTP ${response.status}`, apiKey),
        isRetryableStatus(response.status),
      );
    }
    const status = stringField(responseJson, "status");
    if (status !== undefined && status !== "completed") {
      const reason = isRecord(responseJson.incomplete_details) && typeof responseJson.incomplete_details.reason === "string"
        ? responseJson.incomplete_details.reason : `response_${status}`;
      throw new LlmProviderError(reason, `OpenAI response did not complete: ${status}`, status === "in_progress" || status === "queued");
    }

    const output = extractStructuredOutput(responseJson);
    if (output === undefined) throw new LlmProviderError("missing_output", "OpenAI response contained no structured output", false);
    const usage = parseUsage(responseJson);
    const providerRequestId = stringField(responseJson, "id");
    return {
      output,
      ...(usage === undefined ? {} : { usage }),
      ...(providerRequestId === undefined ? {} : { providerRequestId }),
    };
  }
}
