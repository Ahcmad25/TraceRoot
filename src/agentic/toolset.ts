import type { CaseArtifacts } from "../artifacts/types.js";
import { loadRuntimeScenario } from "../target-api/runtime-map.js";
import type { ExecuteReproductionData, ReproductionExpectations } from "../tools/execute-reproduction.js";
import { createExecuteReproductionTool } from "../tools/execute-reproduction.js";
import type { ReadSourceData } from "../tools/read-source.js";
import { createReadSourceTool } from "../tools/read-source.js";
import type { SearchLogsData } from "../tools/search-logs.js";
import { createSearchLogsTool } from "../tools/search-logs.js";
import type { SearchSourceData } from "../tools/search-source.js";
import { createSearchSourceTool } from "../tools/search-source.js";
import type { ToolResult, ToolRuntimeOptions } from "../tools/contracts.js";
import type { ReproductionRequest } from "../domain/investigation.js";

export interface AgenticTools {
  searchSource(input: unknown): Promise<ToolResult<SearchSourceData>>;
  readSource(input: unknown): Promise<ToolResult<ReadSourceData>>;
  searchLogs(input: unknown): Promise<ToolResult<SearchLogsData>>;
  executeReproduction(input: {
    request: ReproductionRequest;
    expectations: ReproductionExpectations;
  }): Promise<ToolResult<ExecuteReproductionData>>;
}

export async function createAgenticTools(input: {
  artifacts: CaseArtifacts;
  workspaceRoot: string;
  baseUrl: string;
  runtime?: ToolRuntimeOptions;
}): Promise<AgenticTools> {
  const scenarioId = await loadRuntimeScenario(input.workspaceRoot, input.artifacts.caseId);
  const reproduction = createExecuteReproductionTool({ baseUrl: input.baseUrl, ...input.runtime });
  return {
    searchSource: createSearchSourceTool(input.artifacts, input.runtime),
    readSource: createReadSourceTool(input.artifacts, input.workspaceRoot, input.runtime),
    searchLogs: createSearchLogsTool(input.artifacts, input.runtime),
    executeReproduction: async (request) => reproduction({ scenarioId, ...request }),
  };
}
