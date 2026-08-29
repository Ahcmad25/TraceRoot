import { z } from "zod";
import type { CaseArtifacts } from "../artifacts/types.js";
import { createEvidence, createToolRuntime, runTool, stableObservationId, type ToolResult, type ToolRuntimeOptions } from "./contracts.js";

export const searchLogsInputSchema = z.object({
  query: z.string().min(1).max(200),
  caseSensitive: z.boolean().default(false),
  maxMatches: z.number().int().min(1).max(50).default(20),
  contextLines: z.number().int().min(0).max(3).default(0),
});

export interface LogSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly content: string;
}

export interface SearchLogsData {
  readonly query: string;
  readonly matches: readonly LogSearchMatch[];
  readonly totalMatches: number;
}

export function createSearchLogsTool(artifacts: CaseArtifacts, options: ToolRuntimeOptions = {}) {
  const runtime = createToolRuntime(options);
  return async (input: unknown): Promise<ToolResult<SearchLogsData>> => runTool("search_logs", runtime, async () => {
    const parsed = searchLogsInputSchema.parse(input);
    const needle = parsed.caseSensitive ? parsed.query : parsed.query.toLocaleLowerCase("en-US");
    const matches: LogSearchMatch[] = [];
    let totalMatches = 0;

    for (const log of artifacts.logs) {
      const lines = log.content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const haystack = parsed.caseSensitive ? line : line.toLocaleLowerCase("en-US");
        if (!haystack.includes(needle)) {
          continue;
        }
        totalMatches += 1;
        if (matches.length < parsed.maxMatches) {
          const from = Math.max(0, index - parsed.contextLines);
          const to = Math.min(lines.length, index + parsed.contextLines + 1);
          matches.push({ path: log.path, line: index + 1, content: lines.slice(from, to).join("\n").slice(0, 2_000) });
        }
      }
    }

    const data = Object.freeze({ query: parsed.query, matches: Object.freeze(matches), totalMatches });
    return {
      data,
      evidence: [createEvidence({
        runtime,
        kind: "log",
        origin: "search_logs",
        locator: `${artifacts.caseId}/log-search/${stableObservationId(data)}`,
        content: JSON.stringify(data),
      })],
      truncated: totalMatches > matches.length,
    };
  });
}
