import { resolve } from "node:path";
import { ArtifactLoader } from "./artifacts/loader.js";
import { runInvestigation, type AgenticRunnerResult } from "./agentic/runner.js";
import { OpenAiResponsesProvider } from "./llm/openai-responses-provider.js";
import { effectiveLlmConfiguration } from "./llm/model-capabilities.js";
import { closeTarget, startEphemeralTarget } from "./target-api/server.js";

const CASE_ID = "case-004";
const workspaceRoot = resolve(process.cwd());

function configuration() {
  const modelId = process.env.OPENAI_MODEL?.trim() ?? "";
  if (modelId === "") throw new Error("OPENAI_MODEL must be configured for the demo");
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "60000", 10);
  if (!Number.isInteger(timeoutMs)) throw new Error("LLM_TIMEOUT_MS must be a valid integer");
  return effectiveLlmConfiguration({ modelId, temperature: 0, timeoutMs });
}

function describeCompletedInvestigation(execution: Extract<AgenticRunnerResult, { ok: true }>): void {
  for (const event of execution.trajectory.investigation.events) {
    if (event.type === "hypothesis-recorded" && event.hypothesis.status === "proposed") {
      console.log(`[hypothesis] ${event.hypothesis.statement}`);
      continue;
    }
    if (event.type === "experiment-recorded") {
      console.log(`[reproduction] ${event.experiment.request.method} ${event.experiment.request.path} → ${event.experiment.outcome}`);
      continue;
    }
    if (event.type !== "agent-step-recorded") continue;
    const data = event.structuredData as Record<string, unknown> | null;
    if (event.stepKind === "tool-invocation" && typeof data?.tool === "string") {
      const argumentObject = data.arguments as Record<string, unknown> | undefined;
      const target = argumentObject?.path ?? argumentObject?.query ?? "bounded request";
      console.log(`[evidence] ${data.tool}: ${String(target)}`);
    }
    if (event.stepKind === "verifier-feedback") console.log(`[verifier] outcome: ${String(data?.outcome ?? "unknown")}`);
  }
}

async function main(): Promise<void> {
  console.log(`TraceRoot demo — ${CASE_ID}`);
  const loaded = await new ArtifactLoader(workspaceRoot).load(CASE_ID);
  if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.message}`);
  console.log(`[case] loaded: ${loaded.artifacts.manifest.failureReport.summary}`);
  console.log("[investigation] started with frozen roles and four bounded tools");

  const target = await startEphemeralTarget();
  try {
    const execution = await runInvestigation({
      workspaceRoot,
      caseId: CASE_ID,
      baseUrl: target.baseUrl,
      provider: new OpenAiResponsesProvider(),
      configuration: configuration(),
    });
    if (!execution.ok) throw new Error(`${execution.error.code}: ${execution.error.message}`);
    describeCompletedInvestigation(execution);
    console.log(`[final] ${execution.result.diagnosis.status} — ${execution.result.terminationReason}`);
    console.log(`[usage] LLM calls: ${execution.result.llmCallCount}; tools: ${execution.result.toolCallCount}; tokens: ${execution.result.tokenUsage.totalTokens}`);
  } finally {
    await closeTarget(target.server);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo failed");
  process.exitCode = 1;
});
