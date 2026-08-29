import { resolve, relative } from "node:path";
import { z } from "zod";
import type { CaseArtifacts } from "../artifacts/types.js";
import { PathSandbox, SandboxError } from "../security/path-sandbox.js";
import { createEvidence, createToolRuntime, runTool, type ToolResult, type ToolRuntimeOptions } from "./contracts.js";

const MAX_READ_LINES = 200;
const MAX_READ_BYTES = 32 * 1024;

export const readSourceInputSchema = z.object({
  path: z.string().min(1).max(500),
  startLine: z.number().int().positive().default(1),
  endLine: z.number().int().positive().optional(),
});

export interface ReadSourceData {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly bytes: number;
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { content, truncated: false };
  }
  return { content: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

export function createReadSourceTool(
  artifacts: CaseArtifacts,
  workspaceRoot: string,
  options: ToolRuntimeOptions = {},
) {
  const runtime = createToolRuntime(options);
  const allowedPaths = artifacts.sources.map((source) => resolve(workspaceRoot, source.path));

  return async (input: unknown): Promise<ToolResult<ReadSourceData>> => runTool("read_source", runtime, async () => {
    const parsed = readSourceInputSchema.parse(input);
    if (parsed.endLine !== undefined && parsed.endLine < parsed.startLine) {
      throw new z.ZodError([{
        code: "custom",
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine",
      }]);
    }
    const sandbox = await PathSandbox.create({
      roots: [resolve(workspaceRoot, "src", "target-api")],
      deniedRoots: [resolve(workspaceRoot, "cases", "ground-truth"), resolve(workspaceRoot, "results")],
      allowedFiles: allowedPaths,
      maxBytes: 256 * 1024,
      maxLines: 5_000,
    });
    if (parsed.path.split(/[\\/]+/u).includes("..")) {
      await sandbox.resolveReadable(parsed.path);
    }
    const candidatePath = parsed.path.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(parsed.path)
      ? parsed.path
      : resolve(workspaceRoot, parsed.path);
    const resolvedPath = await sandbox.resolveReadable(candidatePath);
    const relativePath = relative(workspaceRoot, resolvedPath).replaceAll("\\", "/");
    const source = artifacts.sources.find((item) => item.path.toLocaleLowerCase("en-US") === relativePath.toLocaleLowerCase("en-US"));
    if (source === undefined) {
      throw new SandboxError("PATH_NOT_PERMITTED", "Source was not loaded in the shared artifact bundle");
    }
    const lines = source.content.split(/\r?\n/u);
    if (parsed.startLine > lines.length) {
      throw new SandboxError("FILE_NOT_FOUND", `startLine ${parsed.startLine} is beyond the end of the file`);
    }
    const requestedEnd = Math.min(parsed.endLine ?? lines.length, lines.length);
    const boundedEnd = Math.min(requestedEnd, parsed.startLine + MAX_READ_LINES - 1);
    const selection = lines.slice(parsed.startLine - 1, boundedEnd).join("\n");
    const byteBound = truncateUtf8(selection, MAX_READ_BYTES);
    const data = Object.freeze({
      path: source.path,
      startLine: parsed.startLine,
      endLine: boundedEnd,
      content: byteBound.content,
      bytes: Buffer.byteLength(byteBound.content, "utf8"),
    });
    return {
      data,
      evidence: [createEvidence({
        runtime,
        kind: "source",
        origin: "read_source",
        locator: `${source.path}:${parsed.startLine}-${boundedEnd}`,
        content: data.content,
      })],
      truncated: boundedEnd < requestedEnd || byteBound.truncated,
    };
  });
}
