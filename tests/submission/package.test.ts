import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgenticResultArtifact, AgenticTrajectoryArtifact } from "../../src/agentic/result.js";
import { sanitizeRepresentativeTrajectory } from "../../src/submission/package.js";

describe("submission trajectory packaging", () => {
  it("preserves the investigation chain while removing runtime and provider identifiers", async () => {
    const root = resolve(process.cwd());
    const fixtureRoot = resolve(root, "tests", "fixtures", "submission");
    const result = JSON.parse(await readFile(resolve(fixtureRoot, "agentic-result.json"), "utf8")) as AgenticResultArtifact;
    const trajectory = JSON.parse(await readFile(resolve(fixtureRoot, "agentic-trajectory.json"), "utf8")) as AgenticTrajectoryArtifact;
    const diagnosticTrajectory = structuredClone(trajectory) as AgenticTrajectoryArtifact & {
      investigation: { events: Array<Record<string, unknown>> };
    };
    diagnosticTrajectory.investigation.events.push({
      sequence: 6,
      recordedAt: "2026-01-01T00:00:01.000Z",
      type: "agent-step-recorded",
      role: "orchestrator",
      promptVersion: null,
      stepKind: "tool-result",
      structuredData: {
        providerRequestId: "provider-fixture-identifier",
        correlationId: "runtime-fixture-identifier",
        note: "fixture-secret-value",
      },
      evidenceIds: [],
      budgetState: {},
      humanCheckpoint: null,
    });
    const packaged = sanitizeRepresentativeTrajectory({ caseId: "case-001", repetition: 1, label: "test", result, trajectory: diagnosticTrajectory }, {
      OPENAI_API_KEY: "fixture-secret-value",
    });
    const text = JSON.stringify(packaged);

    expect(text).toContain("read_source");
    expect(text).toContain("execute_reproduction");
    expect(text).toContain("verifier-feedback");
    expect(text).toContain("evidence-1");
    expect(text).not.toContain("report-observation");
    expect(text).not.toContain("source-observation");
    expect(text).not.toContain("fixture-run");
    expect(text).not.toContain("providerRequestId");
    expect(text).not.toContain("correlationId");
    expect(text).not.toContain("artifact-loader");
    expect(text).not.toContain("fixture-secret-value");
  });
});
