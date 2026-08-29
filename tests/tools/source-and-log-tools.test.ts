import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ArtifactLoader } from "../../src/artifacts/loader.js";
import type { CaseArtifacts } from "../../src/artifacts/types.js";
import { createReadSourceTool } from "../../src/tools/read-source.js";
import { createSearchLogsTool } from "../../src/tools/search-logs.js";
import { createSearchSourceTool } from "../../src/tools/search-source.js";

const workspaceRoot = resolve(".");
let artifacts: CaseArtifacts;

beforeAll(async () => {
  const loaded = await new ArtifactLoader(workspaceRoot).load("case-001");
  if (!loaded.ok) throw new Error(loaded.error.message);
  artifacts = loaded.artifacts;
});

describe("source and log tools", () => {
  it("search_source returns typed matches and evidence", async () => {
    const result = await createSearchSourceTool(artifacts, {
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
      evidenceId: () => "evidence-source-search",
    })({ query: "profile" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalMatches).toBeGreaterThan(0);
    expect(result.data.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "src/target-api/scenarios/user-registration.ts",
      }),
    ]));
    expect(result.evidence).toHaveLength(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("read_source bounds requested line ranges", async () => {
    const sourcePath = "src/target-api/scenarios/user-registration.ts";
    const result = await createReadSourceTool(artifacts, workspaceRoot)({
      path: sourcePath,
      startLine: 1,
      endLine: 10_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content.split("\n").length).toBeLessThanOrEqual(200);
    expect(result.data.bytes).toBeLessThanOrEqual(32 * 1024);
    expect(result.evidence[0]?.locator).toContain(sourcePath);
  });

  it("search_logs returns matching initial log lines", async () => {
    const result = await createSearchLogsTool(artifacts)({ query: "ERROR" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matches).toHaveLength(1);
    expect(result.data.matches[0]?.content).toContain("USER_REGISTRATION_UNHANDLED");
    expect(result.evidence[0]?.kind).toBe("log");
  });

  it("maps traversal, ground-truth, and invalid input into typed failures", async () => {
    const read = createReadSourceTool(artifacts, workspaceRoot);
    await expect(read({ path: "../domain/case.ts" })).resolves.toMatchObject({
      ok: false,
      error: { code: "PATH_TRAVERSAL" },
    });
    await expect(read({ path: resolve("cases/ground-truth/case-001.json") })).resolves.toMatchObject({
      ok: false,
      error: { code: "ACCESS_DENIED" },
    });
    await expect(createSearchSourceTool(artifacts)({ query: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
