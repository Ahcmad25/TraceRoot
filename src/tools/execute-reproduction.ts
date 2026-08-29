import { randomUUID } from "node:crypto";
import { z } from "zod";
import { reproductionRequestSchema } from "../domain/investigation.js";
import { scenarioIdSchema, type TargetLogRecord } from "../target-api/types.js";
import {
  createEvidence,
  createToolRuntime,
  runTool,
  ToolExecutionError,
  type ToolResult,
  type ToolRuntimeOptions,
} from "./contracts.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 64 * 1024;

export const reproductionExpectationSchema = z.object({
  required: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().startsWith("/"),
    status: z.number().int().min(100).max(599),
    bodyContains: z.string().min(1).max(1_000),
  }).strict(),
  supporting: z.object({
    logContains: z.array(z.string().min(1).max(500)).max(20).default([]),
  }).strict(),
}).strict();

export const executeReproductionInputSchema = z.object({
  scenarioId: scenarioIdSchema,
  request: reproductionRequestSchema,
  expectations: reproductionExpectationSchema,
});

export type ReproductionExpectations = z.infer<typeof reproductionExpectationSchema>;

export interface ReproductionAssertion {
  readonly kind: "method" | "path" | "status" | "body" | "log";
  readonly requirement: "required" | "supporting";
  readonly expected: string | number;
  readonly actual: string | number;
  readonly passed: boolean;
}

export interface ExecuteReproductionData {
  readonly outcome: "reproduced" | "not-reproduced" | "inconclusive";
  readonly correlationId: string;
  readonly resetSucceeded: boolean;
  readonly response: {
    readonly status: number | null;
    readonly body: unknown;
    readonly bodyText: string;
  };
  readonly logs: readonly TargetLogRecord[];
  readonly assertions: readonly ReproductionAssertion[];
  readonly reason?: string;
}

export interface ReproductionToolOptions extends ToolRuntimeOptions {
  readonly baseUrl: string;
  readonly correlationId?: () => string;
}

async function fetchBounded(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ response: Response; text: string; truncated: boolean }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { response, text, truncated: false };
  }
  return { response, text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function safeHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLocaleLowerCase("en-US");
    if (["host", "content-length", "x-correlation-id"].includes(normalized)) {
      continue;
    }
    result[name] = value;
  }
  return result;
}

export function createExecuteReproductionTool(options: ReproductionToolOptions) {
  const runtime = createToolRuntime(options);
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const correlationId = options.correlationId ?? (() => `repro-${randomUUID()}`);

  return async (input: unknown): Promise<ToolResult<ExecuteReproductionData>> => runTool(
    "execute_reproduction",
    runtime,
    async () => {
      const parsed = executeReproductionInputSchema.parse(input);
      if (parsed.request.path.startsWith("/__control")) {
        throw new ToolExecutionError("INVALID_INPUT", "Reproduction requests cannot target control endpoints", false);
      }
      const requestId = correlationId();
      if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(requestId)) {
        throw new ToolExecutionError("INVALID_INPUT", "Generated correlation id is invalid", false);
      }

      const inconclusiveReset = (reason: string): {
        data: ExecuteReproductionData;
        evidence: readonly ReturnType<typeof createEvidence>[];
        truncated: boolean;
      } => {
        const data: ExecuteReproductionData = Object.freeze({
          outcome: "inconclusive",
          correlationId: requestId,
          resetSucceeded: false,
          response: Object.freeze({ status: null, body: "", bodyText: "" }),
          logs: Object.freeze([]),
          assertions: Object.freeze([]),
          reason,
        });
        return {
          data,
          evidence: Object.freeze([createEvidence({
            runtime,
            kind: "http",
            origin: "execute_reproduction",
            locator: `${parsed.request.method} ${parsed.request.path} correlation=${requestId}`,
            content: JSON.stringify({ status: null, outcome: "inconclusive", reason }),
          })]),
          truncated: false,
        };
      };

      let resetResponse;
      try {
        resetResponse = await fetchBounded(
          `${baseUrl}/__control/reset/${encodeURIComponent(parsed.scenarioId)}`,
          { method: "POST" },
          runtime.timeoutMs,
          MAX_RESPONSE_BYTES,
        );
      } catch (error: unknown) {
        return inconclusiveReset(error instanceof Error ? `Target reset failed: ${error.message}` : "Target reset failed");
      }
      if (!resetResponse.response.ok) {
        return inconclusiveReset(`Target reset returned HTTP ${resetResponse.response.status}`);
      }

      const query = new URLSearchParams(parsed.request.query ?? {}).toString();
      const requestUrl = `${baseUrl}${parsed.request.path}${query === "" ? "" : `?${query}`}`;
      const headers = safeHeaders(parsed.request.headers);
      headers["x-correlation-id"] = requestId;
      if (parsed.request.body !== undefined) {
        headers["content-type"] = "application/json";
      }

      let applicationResponse: { response: Response; text: string; truncated: boolean } | undefined;
      let requestFailure: string | undefined;
      try {
        applicationResponse = await fetchBounded(requestUrl, {
          method: parsed.request.method,
          headers,
          ...(parsed.request.body === undefined ? {} : { body: JSON.stringify(parsed.request.body) }),
        }, runtime.timeoutMs, MAX_RESPONSE_BYTES);
      } catch (error: unknown) {
        requestFailure = error instanceof Error ? error.message : "Unknown request failure";
      }

      let logResponse;
      try {
        logResponse = await fetchBounded(
          `${baseUrl}/__control/logs?requestId=${encodeURIComponent(requestId)}`,
          { method: "GET" },
          runtime.timeoutMs,
          MAX_LOG_BYTES,
        );
      } catch (error: unknown) {
        throw new ToolExecutionError(
          "CONTROL_FAILURE",
          error instanceof Error ? `Correlated log fetch failed: ${error.message}` : "Correlated log fetch failed",
          true,
        );
      }
      if (!logResponse.response.ok) {
        throw new ToolExecutionError("CONTROL_FAILURE", `Log fetch returned HTTP ${logResponse.response.status}`, true);
      }
      const parsedLogs = z.object({
        logs: z.array(z.object({
          sequence: z.number().int().positive(),
          requestId: z.string(),
          level: z.enum(["info", "warn", "error"]),
          message: z.string(),
          details: z.record(z.unknown()),
        })).max(100),
      }).safeParse(parseBody(logResponse.text));
      if (!parsedLogs.success) {
        throw new ToolExecutionError("CONTROL_FAILURE", "Target returned malformed correlated logs", false);
      }

      const responseStatus = applicationResponse?.response.status ?? null;
      const bodyText = applicationResponse?.text ?? "";
      const serializedLogs = JSON.stringify(parsedLogs.data.logs);
      const assertions: ReproductionAssertion[] = [];
      assertions.push({
        kind: "method",
        requirement: "required",
        expected: parsed.expectations.required.method,
        actual: parsed.request.method,
        passed: parsed.request.method === parsed.expectations.required.method,
      });
      assertions.push({
        kind: "path",
        requirement: "required",
        expected: parsed.expectations.required.path,
        actual: parsed.request.path,
        passed: parsed.request.path === parsed.expectations.required.path,
      });
      assertions.push({
        kind: "status",
        requirement: "required",
        expected: parsed.expectations.required.status,
        actual: responseStatus ?? "no response",
        passed: responseStatus === parsed.expectations.required.status,
      });
      assertions.push({
        kind: "body",
        requirement: "required",
        expected: parsed.expectations.required.bodyContains,
        actual: bodyText,
        passed: bodyText.includes(parsed.expectations.required.bodyContains),
      });
      for (const expectedLog of parsed.expectations.supporting.logContains) {
        assertions.push({
          kind: "log",
          requirement: "supporting",
          expected: expectedLog,
          actual: serializedLogs,
          passed: serializedLogs.includes(expectedLog),
        });
      }
      const inconclusive = requestFailure !== undefined || applicationResponse?.truncated === true;
      const requiredAssertionsPassed = assertions
        .filter((assertion) => assertion.requirement === "required")
        .every((assertion) => assertion.passed);
      const outcome = inconclusive
        ? "inconclusive" as const
        : requiredAssertionsPassed
          ? "reproduced" as const
          : "not-reproduced" as const;
      const data: ExecuteReproductionData = Object.freeze({
        outcome,
        correlationId: requestId,
        resetSucceeded: true,
        response: Object.freeze({
          status: responseStatus,
          body: parseBody(bodyText),
          bodyText,
        }),
        logs: Object.freeze(parsedLogs.data.logs),
        assertions: Object.freeze(assertions),
        ...(requestFailure === undefined ? {} : { reason: requestFailure }),
      });
      return {
        data,
        evidence: Object.freeze([
          createEvidence({
            runtime,
            kind: "http",
            origin: "execute_reproduction",
            locator: `${parsed.request.method} ${parsed.request.path} correlation=${requestId}`,
            content: JSON.stringify({ status: responseStatus, body: data.response.body, assertions, outcome }),
          }),
          createEvidence({
            runtime,
            kind: "log",
            origin: "execute_reproduction",
            locator: `target-logs correlation=${requestId}`,
            content: serializedLogs,
          }),
        ]),
        truncated: applicationResponse?.truncated === true || logResponse.truncated,
      };
    },
  );
}
