import { describe, expect, it } from "vitest";
import { InvestigationJournal } from "../../src/domain/investigation-journal.js";
import type { Evidence } from "../../src/domain/investigation.js";

const fixedTime = "2026-08-29T00:00:00.000Z";
const report = {
  summary: "Example failure",
  endpoint: "/api/example",
  method: "GET" as const,
  observedStatus: 500,
  observedError: "failed",
  requestContext: {},
};

function createJournal(): InvestigationJournal {
  return new InvestigationJournal({
    investigationId: "inv-001",
    caseId: "case-001",
    mode: "agentic",
    failureReport: report,
    clock: () => new Date(fixedTime),
  });
}

describe("InvestigationJournal", () => {
  it("records immutable, sequential investigation events", () => {
    const journal = createJournal();
    const evidence: Evidence = {
      id: "evidence-1",
      kind: "source",
      origin: "search_source",
      locator: "src/example.ts:10",
      content: "throw new Error()",
      collectedAt: fixedTime,
    };

    journal.recordEvidence(evidence);
    evidence.content = "mutated by caller";
    journal.recordHypothesis({
      id: "hypothesis-1",
      statement: "The handler throws",
      faultCategory: "unknown",
      suspectedSourceFile: "src/example.ts",
      suspectedSymbol: "handler",
      mechanism: "An exception escapes",
      verificationPlan: "Inspect the handler",
      supportingEvidenceIds: ["evidence-1"],
      contradictingEvidenceIds: [],
      confidence: 0.7,
      status: "proposed",
    });

    const snapshot = journal.snapshot();
    expect(snapshot.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(snapshot.evidence[0]?.content).toBe("throw new Error()");
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    expect(snapshot.status).toBe("running");
  });

  it("requires references to existing evidence and hypotheses", () => {
    const journal = createJournal();
    expect(() => journal.recordHypothesis({
      id: "hypothesis-1",
      statement: "Unsupported hypothesis",
      faultCategory: "unknown",
      suspectedSourceFile: "src/example.ts",
      suspectedSymbol: "handler",
      mechanism: "Unknown",
      verificationPlan: "Inspect evidence",
      supportingEvidenceIds: ["missing-evidence"],
      contradictingEvidenceIds: [],
      confidence: 0.2,
      status: "proposed",
    })).toThrow("Unknown evidence id");
  });

  it("becomes closed after recording a diagnosis", () => {
    const journal = createJournal();
    journal.recordEvidence({
      id: "evidence-1",
      kind: "report",
      origin: "case",
      locator: "case-001/report",
      content: "Example failure",
      collectedAt: fixedTime,
    });
    journal.recordDiagnosis({
      status: "unverified",
      category: "unknown",
      sourceFile: "src/example.ts",
      symbol: "handler",
      causalMechanism: "A candidate mechanism",
      explanation: "Available evidence supports a candidate but it was not reproduced.",
      confidence: 0.4,
      evidenceIds: ["evidence-1"],
      reproductionSummary: "No reproduction was attempted.",
      limitations: ["Runtime evidence unavailable"],
    });

    expect(journal.snapshot().status).toBe("completed");
    expect(journal.snapshot().diagnosis?.status).toBe("unverified");
    expect(() => journal.recordEvidence({
      id: "evidence-2",
      kind: "log",
      origin: "search_logs",
      locator: "app.log:1",
      content: "late evidence",
      collectedAt: fixedTime,
    })).toThrow("already completed");
  });

  it("keeps revision history while projecting only the latest active hypothesis", () => {
    const journal = createJournal();
    journal.recordEvidence({
      id: "evidence-1", kind: "source", origin: "read_source", locator: "src/example.ts:1",
      content: "source", collectedAt: fixedTime,
    });
    const proposed = {
      id: "hypothesis-1", statement: "The handler throws", faultCategory: "unknown" as const,
      suspectedSourceFile: "src/example.ts", suspectedSymbol: "handler", mechanism: "An exception escapes",
      verificationPlan: "Reproduce the request", supportingEvidenceIds: ["evidence-1"], contradictingEvidenceIds: [],
      confidence: 0.7, status: "proposed" as const,
    };
    journal.recordHypothesis(proposed);
    journal.recordHypothesis({ ...proposed, status: "tested" });

    const snapshot = journal.snapshot();
    expect(snapshot.hypotheses).toEqual([proposed, { ...proposed, status: "tested" }]);
    expect(snapshot.activeHypotheses).toEqual([{ ...proposed, status: "tested" }]);
  });
});
