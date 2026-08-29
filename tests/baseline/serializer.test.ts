import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ArtifactLoader } from "../../src/artifacts/loader.js";
import type { CaseArtifacts } from "../../src/artifacts/types.js";
import { hashSerializedContext, serializeBaselineArtifacts } from "../../src/baseline/serializer.js";

let artifacts: CaseArtifacts;

beforeAll(async () => {
  const loaded = await new ArtifactLoader(resolve(".")).load("case-002");
  if (!loaded.ok) throw new Error(loaded.error.message);
  artifacts = loaded.artifacts;
});

describe("canonical baseline artifact serializer", () => {
  it("produces byte-identical context for identical bundles", () => {
    const first = serializeBaselineArtifacts(artifacts);
    const second = serializeBaselineArtifacts(structuredClone(artifacts));

    expect(first).toBe(second);
    expect(hashSerializedContext(first)).toBe(hashSerializedContext(second));
    expect(first.startsWith("===== BEGIN FAILURE REPORT =====\n")).toBe(true);
    expect(first).toContain("===== BEGIN CASE MANIFEST =====");
    expect(first).toContain("   1 | ");
  });

  it("sorts source and log files independently of input array order", () => {
    const reversed: CaseArtifacts = {
      ...artifacts,
      sources: [...artifacts.sources].reverse(),
      logs: [...artifacts.logs].reverse(),
    };
    const serialized = serializeBaselineArtifacts(reversed);
    const sourcePaths = [...artifacts.sources].map((item) => item.path).sort();

    expect(serialized).toBe(serializeBaselineArtifacts(artifacts));
    expect(serialized.indexOf(`BEGIN SOURCE FILE: ${sourcePaths[0]}`))
      .toBeLessThan(serialized.indexOf(`BEGIN SOURCE FILE: ${sourcePaths[1]}`));
    expect(serialized.indexOf("BEGIN FAILURE REPORT"))
      .toBeLessThan(serialized.indexOf("BEGIN PERMITTED SOURCE FILES"));
    expect(serialized.indexOf("BEGIN PERMITTED SOURCE FILES"))
      .toBeLessThan(serialized.indexOf("BEGIN INITIAL LOGS"));
  });
});
