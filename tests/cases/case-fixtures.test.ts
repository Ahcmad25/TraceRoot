import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { failureCaseSchema, groundTruthSchema } from "../../src/domain/case.js";

const publicRoot = resolve("cases/public");
const groundTruthRoot = resolve("cases/ground-truth");

describe("benchmark case fixtures", () => {
  it("contains exactly eight valid cases with matching hidden ground truth", () => {
    const caseDirectories = readdirSync(publicRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(caseDirectories).toEqual([
      "case-001", "case-002", "case-003", "case-004",
      "case-005", "case-006", "case-007", "case-008",
    ]);

    for (const caseId of caseDirectories) {
      const fixture = failureCaseSchema.parse(JSON.parse(
        readFileSync(resolve(publicRoot, caseId, "case.json"), "utf8"),
      ));
      const truth = groundTruthSchema.parse(JSON.parse(
        readFileSync(resolve(groundTruthRoot, `${caseId}.json`), "utf8"),
      ));

      expect(fixture.id).toBe(caseId);
      expect(truth.caseId).toBe(caseId);
      for (const sourceFile of fixture.permittedSourceFiles) {
        expect(existsSync(resolve(sourceFile)), `${sourceFile} should exist`).toBe(true);
      }
      for (const logFile of fixture.initialLogFiles) {
        expect(existsSync(resolve(logFile)), `${logFile} should exist`).toBe(true);
      }
      const body = fixture.failureReport.requestContext.body;
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        expect(Object.values(body).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value)), `${caseId} body should fit the frozen bounded Reproducer encoding`).toBe(true);
      }
    }
  });
});
