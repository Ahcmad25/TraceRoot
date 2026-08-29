import { createApplicationData, type ApplicationData } from "./application-data.js";
import type { LogLevel, TargetLogRecord } from "./types.js";

export class TargetState {
  #data: ApplicationData;
  #logs: TargetLogRecord[] = [];
  #requestSequence = 0;

  public constructor() {
    this.#data = createApplicationData();
  }

  public reset(): void {
    this.#data = createApplicationData();
    this.#logs = [];
    this.#requestSequence = 0;
  }

  public nextRequestId(): string {
    this.#requestSequence += 1;
    return `trace-${String(this.#requestSequence).padStart(4, "0")}`;
  }

  public log(
    requestId: string,
    level: LogLevel,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ): void {
    this.#logs.push(Object.freeze({
      sequence: this.#logs.length + 1,
      requestId,
      level,
      message,
      details: Object.freeze(structuredClone(details)),
    }));
  }

  public logs(requestId?: string): readonly TargetLogRecord[] {
    const logs = requestId === undefined
      ? this.#logs
      : this.#logs.filter((record) => record.requestId === requestId);
    return Object.freeze(structuredClone(logs));
  }

  public data(): Readonly<ApplicationData> {
    return this.#data;
  }
}
