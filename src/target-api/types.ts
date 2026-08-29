import { z } from "zod";

export const scenarioIdSchema = z.enum([
  "scenario-001",
  "scenario-002",
  "scenario-003",
  "scenario-004",
]);

export type ScenarioId = z.infer<typeof scenarioIdSchema>;
export type LogLevel = "info" | "warn" | "error";

export interface TargetLogRecord {
  readonly sequence: number;
  readonly requestId: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
