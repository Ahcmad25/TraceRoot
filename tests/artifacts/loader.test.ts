import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLoader } from "../../src/artifacts/loader.js";

describe("ArtifactLoader", () => {
  it("loads only permitted artifacts and produces stable hashes", async () => {
    const loader = new ArtifactLoader(resolve("."));
    const first = await loader.load("case-001");
    const second = await loader.load("case-001");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.artifacts.hashes).toEqual(second.artifacts.hashes);
    expect(first.artifacts.hashes.aggregate).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.artifacts.sources.map((item) => item.path)).toEqual(
      first.artifacts.manifest.permittedSourceFiles.slice().sort(),
    );
    expect(first.artifacts.logs.map((item) => item.path)).toEqual(
      first.artifacts.manifest.initialLogFiles.slice().sort(),
    );
    expect(JSON.stringify(first.artifacts)).not.toContain("cases/ground-truth");
    expect(JSON.stringify(first.artifacts)).not.toContain("cases/internal");
    expect(JSON.stringify(first.artifacts)).not.toContain("results/");
  });

  it("returns typed failures for invalid and missing cases", async () => {
    const loader = new ArtifactLoader(resolve("."));
    await expect(loader.load("../ground-truth")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CASE_ID" },
    });
    await expect(loader.load("case-999")).resolves.toMatchObject({
      ok: false,
      error: { code: "CASE_NOT_FOUND" },
    });
  });
});
