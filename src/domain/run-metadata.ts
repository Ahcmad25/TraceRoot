import { z } from "zod";
import { tokenUsageSchema, type LlmConfiguration, type TokenUsage } from "../llm/types.js";

export const runMetadataSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  mode: z.enum(["baseline", "agentic"]),
  modelId: z.string().min(1),
  temperature: z.number().min(0).max(2).nullable(),
  promptVersion: z.string().min(1),
  artifactHashes: z.object({
    manifest: z.string().length(64),
    sources: z.record(z.string().length(64)),
    logs: z.record(z.string().length(64)),
    aggregate: z.string().length(64),
  }),
  toolVersion: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  tokenUsage: tokenUsageSchema,
  toolCallCount: z.number().int().nonnegative(),
});

export type RunMetadata = z.infer<typeof runMetadataSchema>;

export class RunMetadataRecorder {
  readonly #metadata: RunMetadata;
  readonly #clock: () => Date;
  #completedAt: string | undefined;
  #usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  #toolCallCount = 0;

  public constructor(input: {
    runId: string;
    caseId: string;
    mode: "baseline" | "agentic";
    llm: LlmConfiguration;
    promptVersion: string;
    artifactHashes: RunMetadata["artifactHashes"];
    toolVersion: string;
    clock?: () => Date;
  }) {
    this.#clock = input.clock ?? (() => new Date());
    this.#metadata = runMetadataSchema.parse({
      runId: input.runId,
      caseId: input.caseId,
      mode: input.mode,
      modelId: input.llm.modelId,
      temperature: input.llm.temperature,
      promptVersion: input.promptVersion,
      artifactHashes: input.artifactHashes,
      toolVersion: input.toolVersion,
      startedAt: this.#clock().toISOString(),
      tokenUsage: this.#usage,
      toolCallCount: 0,
    });
  }

  public recordTokenUsage(usage: TokenUsage): void {
    this.#assertOpen();
    const parsed = tokenUsageSchema.parse(usage);
    this.#usage = {
      inputTokens: this.#usage.inputTokens + parsed.inputTokens,
      outputTokens: this.#usage.outputTokens + parsed.outputTokens,
      totalTokens: this.#usage.totalTokens + parsed.totalTokens,
    };
  }

  public recordToolCall(): void {
    this.#assertOpen();
    this.#toolCallCount += 1;
  }

  public complete(): RunMetadata {
    this.#assertOpen();
    this.#completedAt = this.#clock().toISOString();
    return this.snapshot();
  }

  public snapshot(): RunMetadata {
    return Object.freeze(runMetadataSchema.parse({
      ...this.#metadata,
      ...(this.#completedAt === undefined ? {} : { completedAt: this.#completedAt }),
      tokenUsage: this.#usage,
      toolCallCount: this.#toolCallCount,
    }));
  }

  #assertOpen(): void {
    if (this.#completedAt !== undefined) {
      throw new Error("Run metadata is already completed");
    }
  }
}
