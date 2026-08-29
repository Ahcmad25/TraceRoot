import { z } from "zod";
import type { CaseArtifacts } from "../artifacts/types.js";
import { createEvidence, createToolRuntime, runTool, stableObservationId, type ToolResult, type ToolRuntimeOptions } from "./contracts.js";

export const searchSourceInputSchema = z.object({
  query: z.string().min(1).max(200),
  caseSensitive: z.boolean().default(false),
  maxMatches: z.number().int().min(1).max(50).default(20),
});

export interface SourceSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface SearchSourceData {
  readonly query: string;
  readonly matches: readonly SourceSearchMatch[];
  readonly totalMatches: number;
}

export function createSearchSourceTool(artifacts: CaseArtifacts, options: ToolRuntimeOptions = {}) {
  const runtime = createToolRuntime(options);
  return async (input: unknown): Promise<ToolResult<SearchSourceData>> => runTool("search_source", runtime, async () => {
    const parsed = searchSourceInputSchema.parse(input);
    const needle = parsed.caseSensitive ? parsed.query : parsed.query.toLocaleLowerCase("en-US");
    const matches: SourceSearchMatch[] = [];
    let totalMatches = 0;

    for (const source of artifacts.sources) {
      const lines = source.content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const haystack = parsed.caseSensitive ? line : line.toLocaleLowerCase("en-US");
        let offset = haystack.indexOf(needle);
        while (offset >= 0) {
          totalMatches += 1;
          if (matches.length < parsed.maxMatches) {
            matches.push({ path: source.path, line: index + 1, column: offset + 1, preview: line.slice(0, 500) });
          }
          offset = haystack.indexOf(needle, offset + Math.max(needle.length, 1));
        }
      }
    }

    const data = Object.freeze({ query: parsed.query, matches: Object.freeze(matches), totalMatches });
    return {
      data,
      evidence: [createEvidence({
        runtime,
        kind: "source",
        origin: "search_source",
        locator: `${artifacts.caseId}/source-search/${stableObservationId(data)}`,
        content: JSON.stringify(data),
      })],
      truncated: totalMatches > matches.length,
    };
  });
}
