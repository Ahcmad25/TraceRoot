import type { Server } from "node:http";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ArtifactLoader } from "./artifacts/loader.js";
import type { CaseArtifacts } from "./artifacts/types.js";
import { runInvestigation } from "./agentic/runner.js";
import { runBaseline } from "./baseline/runner.js";
import { OpenAiResponsesProvider } from "./llm/openai-responses-provider.js";
import type { LlmConfiguration } from "./llm/types.js";
import { effectiveLlmConfiguration } from "./llm/model-capabilities.js";
import { createTargetApi } from "./target-api/app.js";
import { loadRuntimeScenario } from "./target-api/runtime-map.js";
import { createExecuteReproductionTool } from "./tools/execute-reproduction.js";
import { createReadSourceTool } from "./tools/read-source.js";
import { createSearchLogsTool } from "./tools/search-logs.js";
import { createSearchSourceTool } from "./tools/search-source.js";

const workspaceRoot = resolve(process.cwd());

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function loadCase(caseId: string | undefined): Promise<CaseArtifacts> {
  if (caseId === undefined) {
    throw new Error("A case id is required");
  }
  const result = await new ArtifactLoader(workspaceRoot).load(caseId);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.artifacts;
}

function startEphemeralTarget(): Promise<{ server: Server; baseUrl: string }> {
  const runtime = createTargetApi();
  return new Promise((resolvePromise, reject) => {
    const server = runtime.app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Target API did not expose a TCP address"));
        return;
      }
      resolvePromise({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
  });
}

function baselineConfiguration(): LlmConfiguration {
  const modelId = process.env.OPENAI_MODEL?.trim() ?? "";
  if (modelId === "") {
    throw new Error("OPENAI_MODEL must be configured for baseline runs");
  }
  const temperature = Number.parseFloat(process.env.BASELINE_TEMPERATURE ?? "0");
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "60000", 10);
  if (!Number.isFinite(temperature) || !Number.isInteger(timeoutMs)) {
    throw new Error("BASELINE_TEMPERATURE and LLM_TIMEOUT_MS must be valid numbers");
  }
  return effectiveLlmConfiguration({ modelId, temperature, timeoutMs });
}

async function executeInvestigation(caseId: string): Promise<boolean> {
  const target = await startEphemeralTarget();
  try {
    const execution = await runInvestigation({
      workspaceRoot,
      caseId,
      baseUrl: target.baseUrl,
      provider: new OpenAiResponsesProvider(),
      configuration: baselineConfiguration(),
    });
    print({
      ok: execution.ok,
      caseId,
      ...(execution.ok ? {
        diagnosisStatus: execution.result.diagnosis.status,
        terminationReason: execution.result.terminationReason,
        unsupportedClaimCount: execution.result.unsupportedClaimCount,
        llmCallCount: execution.result.llmCallCount,
        toolCallCount: execution.result.toolCallCount,
        resultPath: execution.resultPath,
        trajectoryPath: execution.trajectoryPath,
      } : { error: execution.error }),
    });
    return execution.ok;
  } finally {
    await closeServer(target.server);
  }
}

async function executeBaseline(caseId: string): Promise<boolean> {
  const execution = await runBaseline({
    workspaceRoot,
    caseId,
    provider: new OpenAiResponsesProvider(),
    configuration: baselineConfiguration(),
  });
  print({
    ok: execution.ok,
    caseId,
    ...(execution.result === undefined ? {} : {
      status: execution.result.status,
      diagnosisStatus: execution.result.diagnosis?.status ?? null,
      unsupportedEvidenceCount: execution.result.evidenceValidation.unsupported.length,
      formatRetryCount: execution.result.formatRetryCount,
    }),
    ...(execution.resultPath === undefined ? {} : { resultPath: execution.resultPath }),
    ...(!execution.ok ? { error: execution.error } : {}),
  });
  return execution.ok;
}

async function main(): Promise<void> {
  const [command, caseId, argument, secondArgument] = process.argv.slice(2);

  if (command === "target") {
    const host = process.env.TARGET_API_HOST ?? "127.0.0.1";
    const port = Number.parseInt(process.env.TARGET_API_PORT ?? "4310", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("TARGET_API_PORT must be a valid TCP port");
    }
    createTargetApi().app.listen(port, host, () => {
      console.log(`TraceRoot controlled target API listening on http://${host}:${port}`);
    });
    return;
  }

  if (command === "baseline") {
    if (caseId === undefined) throw new Error("A case id is required");
    if (!await executeBaseline(caseId)) process.exitCode = 1;
    return;
  }

  if (command === "baseline:all") {
    const caseIds = (await readdir(resolve(workspaceRoot, "cases", "public"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^case-\d{3}$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    let allSucceeded = true;
    for (const availableCaseId of caseIds) {
      if (!await executeBaseline(availableCaseId)) allSucceeded = false;
    }
    if (!allSucceeded) process.exitCode = 1;
    return;
  }

  if (command === "investigate") {
    if (caseId === undefined) throw new Error("A case id is required");
    if (!await executeInvestigation(caseId)) process.exitCode = 1;
    return;
  }

  const artifacts = await loadCase(caseId);
  if (command === "case") {
    print({
      manifest: artifacts.manifest,
      sources: artifacts.sources.map(({ path, sha256, bytes, lines }) => ({ path, sha256, bytes, lines })),
      logs: artifacts.logs.map(({ path, sha256, bytes, lines }) => ({ path, sha256, bytes, lines })),
      hashes: artifacts.hashes,
    });
    return;
  }
  if (command === "tool:search-source") {
    print(await createSearchSourceTool(artifacts)({ query: argument }));
    return;
  }
  if (command === "tool:read-source") {
    print(await createReadSourceTool(artifacts, workspaceRoot)({
      path: argument,
      startLine: secondArgument === undefined ? 1 : Number.parseInt(secondArgument, 10),
    }));
    return;
  }
  if (command === "tool:search-logs") {
    print(await createSearchLogsTool(artifacts)({ query: argument }));
    return;
  }
  if (command === "tool:reproduce") {
    const target = await startEphemeralTarget();
    try {
      const context = artifacts.manifest.failureReport.requestContext;
      const scenarioId = await loadRuntimeScenario(workspaceRoot, artifacts.caseId);
      print(await createExecuteReproductionTool({ baseUrl: target.baseUrl })({
        scenarioId,
        request: {
          method: artifacts.manifest.failureReport.method,
          path: artifacts.manifest.failureReport.endpoint,
          ...(Object.hasOwn(context, "body") ? { body: context.body } : {}),
        },
        expectations: {
          required: {
            method: artifacts.manifest.failureReport.method,
            path: artifacts.manifest.failureReport.endpoint,
            status: artifacts.manifest.failureReport.observedStatus,
            bodyContains: artifacts.manifest.failureReport.observedError,
          },
          supporting: { logContains: [] },
        },
      }));
    } finally {
      await closeServer(target.server);
    }
    return;
  }

  throw new Error(
    "Usage: target | baseline <case-id> | baseline:all | investigate <case-id> | case <case-id> | tool:search-source <case-id> <query> | "
      + "tool:read-source <case-id> <path> [start-line] | tool:search-logs <case-id> <query> | "
      + "tool:reproduce <case-id>",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown CLI error");
  process.exitCode = 1;
});
