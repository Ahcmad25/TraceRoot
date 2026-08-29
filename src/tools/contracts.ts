import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Evidence } from "../domain/investigation.js";
import { SandboxError } from "../security/path-sandbox.js";

export const TOOL_VERSION = "1.1.0";

export type ToolName =
  | "search_source"
  | "read_source"
  | "search_logs"
  | "execute_reproduction";

export type ToolErrorCode =
  | "INVALID_INPUT"
  | "PATH_TRAVERSAL"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "OUTPUT_LIMIT"
  | "TIMEOUT"
  | "TARGET_UNAVAILABLE"
  | "CONTROL_FAILURE"
  | "INTERNAL_ERROR";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ToolSuccess<T> {
  readonly ok: true;
  readonly tool: ToolName;
  readonly toolVersion: string;
  readonly data: T;
  readonly evidence: readonly Evidence[];
  readonly durationMs: number;
  readonly truncated: boolean;
}

export interface ToolFailure {
  readonly ok: false;
  readonly tool: ToolName;
  readonly toolVersion: string;
  readonly error: ToolError;
  readonly durationMs: number;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface ToolRuntimeOptions {
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
  readonly evidenceId?: () => string;
}

export interface ToolRuntime {
  readonly timeoutMs: number;
  readonly clock: () => Date;
  readonly evidenceId: () => string;
}

export class ToolExecutionError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export function createToolRuntime(options: ToolRuntimeOptions = {}): ToolRuntime {
  return {
    timeoutMs: Math.min(Math.max(options.timeoutMs ?? 5_000, 1), 30_000),
    clock: options.clock ?? (() => new Date()),
    evidenceId: options.evidenceId ?? (() => `evidence-${randomUUID()}`),
  };
}

export function createEvidence(input: {
  runtime: ToolRuntime;
  kind: Evidence["kind"];
  origin: ToolName;
  locator: string;
  content: string;
}): Evidence {
  return Object.freeze({
    id: input.runtime.evidenceId(),
    kind: input.kind,
    origin: input.origin,
    locator: input.locator,
    content: input.content,
    collectedAt: input.runtime.clock().toISOString(),
  });
}

export function stableObservationId(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 16);
}

function mapError(error: unknown): ToolError {
  if (error instanceof z.ZodError) {
    return { code: "INVALID_INPUT", message: error.issues[0]?.message ?? "Invalid tool input", retryable: false };
  }
  if (error instanceof SandboxError) {
    const code: ToolErrorCode = error.code === "PATH_TRAVERSAL"
      ? "PATH_TRAVERSAL"
      : error.code === "FILE_NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "READ_LIMIT_EXCEEDED"
          ? "OUTPUT_LIMIT"
          : "ACCESS_DENIED";
    return { code, message: error.message, retryable: false };
  }
  if (error instanceof ToolExecutionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error && error.name === "ToolTimeoutError") {
    return { code: "TIMEOUT", message: error.message, retryable: true };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown tool error",
    retryable: false,
  };
}

export async function runTool<T>(
  tool: ToolName,
  runtime: ToolRuntime,
  operation: () => Promise<Omit<ToolSuccess<T>, "ok" | "tool" | "toolVersion" | "durationMs">>,
): Promise<ToolResult<T>> {
  const started = performance.now();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(`${tool} exceeded its ${runtime.timeoutMs}ms timeout`);
        error.name = "ToolTimeoutError";
        reject(error);
      }, runtime.timeoutMs);
    });
    const value = await Promise.race([operation(), timeoutPromise]);
    return Object.freeze({
      ok: true,
      tool,
      toolVersion: TOOL_VERSION,
      ...value,
      durationMs: Math.round((performance.now() - started) * 1_000) / 1_000,
    });
  } catch (error: unknown) {
    return Object.freeze({
      ok: false,
      tool,
      toolVersion: TOOL_VERSION,
      error: mapError(error),
      durationMs: Math.round((performance.now() - started) * 1_000) / 1_000,
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function explicitFailure<T>(input: {
  tool: ToolName;
  startedAt: number;
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
}): ToolResult<T> {
  return Object.freeze({
    ok: false,
    tool: input.tool,
    toolVersion: TOOL_VERSION,
    error: { code: input.code, message: input.message, retryable: input.retryable },
    durationMs: Math.round((performance.now() - input.startedAt) * 1_000) / 1_000,
  });
}
