import type { Diagnosis } from "./diagnosis.js";
import type { FailureReport } from "./case.js";
import {
  diagnosisSchema,
} from "./diagnosis.js";
import {
  evidenceSchema,
  experimentSchema,
  hypothesisSchema,
  investigationEventSchema,
  type Evidence,
  type Experiment,
  type Hypothesis,
  type InvestigationEvent,
  type AgentStep,
  type InvestigationMode,
  type InvestigationSnapshot,
} from "./investigation.js";

type Clock = () => Date;
type UnrecordedEvent<Event extends InvestigationEvent = InvestigationEvent> =
  Event extends InvestigationEvent ? Omit<Event, "sequence" | "recordedAt"> : never;

export class InvestigationJournal {
  readonly #events: InvestigationEvent[] = [];
  readonly #clock: Clock;

  public constructor(input: {
    investigationId: string;
    caseId: string;
    mode: InvestigationMode;
    failureReport: FailureReport;
    clock?: Clock;
  }) {
    this.#clock = input.clock ?? (() => new Date());
    this.#append({
      type: "investigation-started",
      investigationId: input.investigationId,
      caseId: input.caseId,
      mode: input.mode,
      failureReport: input.failureReport,
    });
  }

  public recordEvidence(evidence: Evidence): void {
    evidenceSchema.parse(evidence);
    this.#assertRunning();
    if (this.#snapshotEvidence().some((item) => item.id === evidence.id)) {
      throw new Error(`Evidence id already exists: ${evidence.id}`);
    }
    this.#append({ type: "evidence-recorded", evidence: structuredClone(evidence) });
  }

  public recordHypothesis(hypothesis: Hypothesis): void {
    hypothesisSchema.parse(hypothesis);
    this.#assertRunning();
    const snapshot = this.snapshot();
    this.#assertEvidenceExists([
      ...hypothesis.supportingEvidenceIds,
      ...hypothesis.contradictingEvidenceIds,
    ]);
    this.#append({ type: "hypothesis-recorded", hypothesis: structuredClone(hypothesis) });
  }

  public recordExperiment(experiment: Experiment): void {
    experimentSchema.parse(experiment);
    this.#assertRunning();
    const snapshot = this.snapshot();
    if (!snapshot.activeHypotheses.some((item) => item.id === experiment.hypothesisId)) {
      throw new Error(`Unknown hypothesis id: ${experiment.hypothesisId}`);
    }
    if (snapshot.experiments.some((item) => item.id === experiment.id)) {
      throw new Error(`Experiment id already exists: ${experiment.id}`);
    }
    this.#assertEvidenceExists(experiment.evidenceIds);
    this.#append({ type: "experiment-recorded", experiment: structuredClone(experiment) });
  }

  public recordDiagnosis(diagnosis: Diagnosis): void {
    diagnosisSchema.parse(diagnosis);
    this.#assertRunning();
    this.#assertEvidenceExists(diagnosis.evidenceIds);
    this.#append({ type: "diagnosis-recorded", diagnosis: structuredClone(diagnosis) });
  }

  public recordAgentStep(step: Omit<AgentStep, "type" | "sequence" | "recordedAt">): void {
    this.#assertRunning();
    this.#assertEvidenceExists(step.evidenceIds);
    this.#append({ type: "agent-step-recorded", ...structuredClone(step) });
  }

  public events(): readonly InvestigationEvent[] {
    return Object.freeze(structuredClone(this.#events));
  }

  public snapshot(): InvestigationSnapshot {
    const events = this.events();
    const started = events[0];
    if (started?.type !== "investigation-started") {
      throw new Error("Investigation journal is missing its start event");
    }
    const diagnosisEvent = events.find((event) => event.type === "diagnosis-recorded");
    const diagnosis = diagnosisEvent?.type === "diagnosis-recorded"
      ? diagnosisEvent.diagnosis
      : undefined;
    const hypotheses = events.flatMap((event) => event.type === "hypothesis-recorded" ? [event.hypothesis] : []);
    const latestHypotheses = new Map<string, Hypothesis>();
    for (const hypothesis of hypotheses) latestHypotheses.set(hypothesis.id, hypothesis);
    const activeHypotheses = [...latestHypotheses.values()].filter((hypothesis) => hypothesis.status !== "rejected");

    return Object.freeze({
      investigationId: started.investigationId,
      caseId: started.caseId,
      mode: started.mode,
      status: diagnosis === undefined ? "running" : "completed",
      failureReport: structuredClone(started.failureReport),
      evidence: Object.freeze(events.flatMap((event) => event.type === "evidence-recorded" ? [event.evidence] : [])),
      hypotheses: Object.freeze(hypotheses),
      activeHypotheses: Object.freeze(activeHypotheses),
      experiments: Object.freeze(events.flatMap((event) => event.type === "experiment-recorded" ? [event.experiment] : [])),
      ...(diagnosis === undefined ? {} : { diagnosis }),
      events,
    });
  }

  #snapshotEvidence(): readonly Evidence[] {
    return this.#events.flatMap((event) => event.type === "evidence-recorded" ? [event.evidence] : []);
  }

  #assertEvidenceExists(ids: readonly string[]): void {
    const known = new Set(this.#snapshotEvidence().map((item) => item.id));
    const missing = ids.find((id) => !known.has(id));
    if (missing !== undefined) {
      throw new Error(`Unknown evidence id: ${missing}`);
    }
  }

  #assertRunning(): void {
    if (this.#events.some((event) => event.type === "diagnosis-recorded")) {
      throw new Error("Investigation is already completed and cannot be modified");
    }
  }

  #append(event: UnrecordedEvent): void {
    const completeEvent = investigationEventSchema.parse({
      ...event,
      sequence: this.#events.length + 1,
      recordedAt: this.#clock().toISOString(),
    });
    this.#events.push(completeEvent);
  }
}
