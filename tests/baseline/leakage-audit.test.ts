import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLoader } from "../../src/artifacts/loader.js";
import { serializeBaselineArtifacts } from "../../src/baseline/serializer.js";
import { failureCaseSchema } from "../../src/domain/case.js";
import { loadRuntimeScenario } from "../../src/target-api/runtime-map.js";

const workspaceRoot = resolve(".");
const caseIds = ["case-001", "case-002", "case-003", "case-004"] as const;
const forbiddenModelVisibleLabels = [
  "missing-profile-validation",
  "misnamed-payment-config",
  "order-quantity-coercion",
  "misleading-audit-error",
  "ground-truth",
  "cases/internal",
  "runtime-map",
  "resetscenarioid",
  "intentional fixture bug",
  "expectedfailure",
  "scenario-001",
  "scenario-002",
  "scenario-003",
  "scenario-004",
  "/__control/",
];

describe("Phase 3.5 benchmark leakage boundary", () => {
  it.each(caseIds)("keeps internal answer labels out of %s artifacts and canonical context", async (caseId) => {
    const loaded = await new ArtifactLoader(workspaceRoot).load(caseId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const bundleText = JSON.stringify(loaded.artifacts).toLocaleLowerCase("en-US");
    const context = serializeBaselineArtifacts(loaded.artifacts).toLocaleLowerCase("en-US");

    for (const label of forbiddenModelVisibleLabels) {
      expect(bundleText, `bundle leaked ${label}`).not.toContain(label);
      expect(context, `context leaked ${label}`).not.toContain(label);
    }
    expect(Object.keys(loaded.artifacts.manifest).sort()).toEqual([
      "failureReport",
      "id",
      "initialLogFiles",
      "permittedSourceFiles",
      "title",
    ]);
  });

  it("uses the same neutral source corpus for every case", async () => {
    const sourceSets: string[][] = [];
    for (const caseId of caseIds) {
      const loaded = await new ArtifactLoader(workspaceRoot).load(caseId);
      if (!loaded.ok) throw new Error(loaded.error.message);
      sourceSets.push([...loaded.artifacts.manifest.permittedSourceFiles].sort());
    }
    for (const sourceSet of sourceSets.slice(1)) {
      expect(sourceSet).toEqual(sourceSets[0]);
    }
    expect(sourceSets[0]).toEqual([
      "src/target-api/application-data.ts",
      "src/target-api/scenarios/account-lookup.ts",
      "src/target-api/scenarios/order-total.ts",
      "src/target-api/scenarios/payment-provider.ts",
      "src/target-api/scenarios/user-registration.ts",
    ]);
  });

  it("rejects internal setup fields in the strict public projection", () => {
    const publicProjection = {
      id: "case-001",
      title: "User registration failure",
      failureReport: {
        summary: "Registration returns HTTP 500.",
        endpoint: "/api/users/register",
        method: "POST",
        observedStatus: 500,
        observedError: "user registration failed",
        requestContext: {},
      },
      permittedSourceFiles: ["src/target-api/scenarios/user-registration.ts"],
      initialLogFiles: ["cases/public/case-001/app.log"],
      resetScenarioId: "scenario-001",
    };

    expect(failureCaseSchema.safeParse(publicProjection).success).toBe(false);
  });

  it("loads runtime mappings only through the internal control layer", async () => {
    await expect(loadRuntimeScenario(workspaceRoot, "case-001")).resolves.toBe("scenario-001");
    const loaded = await new ArtifactLoader(workspaceRoot).load("case-001");
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(JSON.stringify(loaded.artifacts)).not.toContain("scenario-001");
  });
});
