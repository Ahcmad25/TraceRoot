import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgenticResultArtifact, AgenticTrajectoryArtifact } from "../../src/agentic/result.js";
import { writeAgenticArtifacts } from "../../src/agentic/result.js";

describe("agentic result artifacts", () => {
  it("writes separate auditable artifacts with environment secrets redacted", async () => {
    const secret = "phase-four-super-secret";
    const limitation = "The evidence does not establish the intended client-error status.";
    const investigation = {
      investigationId: "run-1", caseId: "case-001", mode: "agentic" as const, status: "completed" as const,
      failureReport: { summary: "Observed failure", method: "POST" as const, endpoint: "/api/users/register", observedStatus: 500, observedError: "failed", requestContext: {} },
      evidence: [], hypotheses: [], activeHypotheses: [], experiments: [],
      diagnosis: { status: "inconclusive" as const, category: "unknown" as const, sourceFile: "unknown", symbol: "unknown", causalMechanism: "unknown", explanation: secret, confidence: 0, evidenceIds: [], reproductionSummary: "none", limitations: [limitation] },
      events: [],
    };
    const common = {
      runId: "run-1", caseId: "case-001",
      promptVersions: { investigator: "investigator-v1", reproducer: "reproducer-v2", verifier: "verifier-v2" },
      aggregateArtifactHash: "aggregate",
    } as const;
    const trajectory: AgenticTrajectoryArtifact = { schemaVersion: "agentic-trajectory-v3", ...common, investigation };
    const result: AgenticResultArtifact = {
      schemaVersion: "agentic-result-v1", ...common, model: "fake", temperature: 0,
      artifactHashes: { manifest: "m", sources: {}, logs: {}, aggregate: "aggregate" },
      startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", durationMs: 1,
      diagnosis: investigation.diagnosis, terminationReason: "evidence_insufficient", unsupportedClaimCount: 0,
      unsupportedReferences: [], unsupportedClaims: [], tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, llmCallCount: 1,
      toolCallCount: 0, toolCalls: { search_source: 0, read_source: 0, search_logs: 0, execute_reproduction: 0 },
      investigationRounds: 1, reproductionAttempts: 0, trajectoryFile: "run-1.trajectory.json",
    };
    const root = await mkdtemp(join(tmpdir(), "traceroot-agentic-"));
    const paths = await writeAgenticArtifacts({ result, trajectory, resultsRoot: root, environment: { OPENAI_API_KEY: secret } });
    const saved = `${await readFile(paths.resultPath, "utf8")}\n${await readFile(paths.trajectoryPath, "utf8")}`;
    expect(saved).not.toContain(secret);
    expect(saved).toContain("[REDACTED]");
    expect(JSON.parse(await readFile(paths.resultPath, "utf8"))).toMatchObject({
      schemaVersion: "agentic-result-v1",
      trajectoryFile: "run-1.trajectory.json",
      diagnosis: { limitations: [limitation] },
    });
    expect(JSON.parse(await readFile(paths.trajectoryPath, "utf8"))).toMatchObject({
      schemaVersion: "agentic-trajectory-v3",
      investigation: { diagnosis: { limitations: [limitation] } },
    });
  });
});
