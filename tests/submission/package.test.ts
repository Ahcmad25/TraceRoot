import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgenticResultArtifact, AgenticTrajectoryArtifact } from "../../src/agentic/result.js";
import { sanitizeRepresentativeTrajectory } from "../../src/submission/package.js";

describe("submission trajectory packaging", () => {
  it("preserves the investigation chain while removing runtime and provider identifiers", async () => {
    const root = resolve(process.cwd());
    const result = JSON.parse(await readFile(resolve(root, "results/agentic/eval-case-001-agentic-r001-a001.json"), "utf8")) as AgenticResultArtifact;
    const trajectory = JSON.parse(await readFile(resolve(root, "results/agentic/eval-case-001-agentic-r001-a001.trajectory.json"), "utf8")) as AgenticTrajectoryArtifact;
    const packaged = sanitizeRepresentativeTrajectory({ caseId: "case-001", repetition: 1, label: "test", result, trajectory }, {
      OPENAI_API_KEY: "fixture-secret-value",
    });
    const text = JSON.stringify(packaged);

    expect(text).toContain("read_source");
    expect(text).toContain("execute_reproduction");
    expect(text).toContain("verifier-feedback");
    expect(text).toContain("evidence-1");
    expect(text).not.toMatch(/evidence-[0-9a-f]{8}-/u);
    expect(text).not.toMatch(/repro-[0-9a-f]{8}-/u);
    expect(text).not.toContain("eval-case-001-agentic-r001-a001");
    expect(text).not.toContain("providerRequestId");
    expect(text).not.toContain("correlationId");
    expect(text).not.toContain("artifact-loader");
    expect(text).not.toContain("fixture-secret-value");
  });
});
