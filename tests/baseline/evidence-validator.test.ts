import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLoader } from "../../src/artifacts/loader.js";
import { validateEvidenceReferences } from "../../src/baseline/evidence-validator.js";

describe("baseline evidence validation", () => {
  it("preserves and separates supported and unsupported claims", async () => {
    const loaded = await new ArtifactLoader(resolve(".")).load("case-001");
    if (!loaded.ok) throw new Error(loaded.error.message);
    const references = [
      "report:case-001",
      "source:src/target-api/scenarios/user-registration.ts:L7-L8",
      "log:cases/public/case-001/app.log:L2",
      "source:src/secret.ts:L1",
      "log:cases/public/case-001/app.log:L999",
    ];

    expect(validateEvidenceReferences(references, loaded.artifacts)).toEqual({
      supported: references.slice(0, 3),
      unsupported: references.slice(3),
    });
  });
});
