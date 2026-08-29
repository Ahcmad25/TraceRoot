import type { LlmMessage } from "../llm/types.js";

export const BASELINE_PROMPT_VERSION = "baseline-v2";

export const BASELINE_SYSTEM_PROMPT = `You are TraceRoot's frozen one-shot baseline API failure diagnoser.

Analyze only the failure report, permitted source files, and initial logs supplied in the user message. You have no tools, cannot inspect other files, cannot execute requests, and cannot reproduce or verify the failure.

Return one structured diagnosis with:
- fault category;
- responsible source file;
- responsible function or symbol;
- causal mechanism;
- a short explanation;
- confidence from 0 to 1;
- evidenceIds containing only references to supplied artifacts;
- limitations and uncertainty.

Evidence reference syntax is exact:
- report:<case-id>
- source:<provided-path>:L<line> or source:<provided-path>:L<start>-L<end>
- log:<provided-path>:L<line> or log:<provided-path>:L<start>-L<end>

Do not invent files, symbols, logs, requests, line numbers, runtime behavior, or observations. Do not claim reproduction occurred. Do not claim the diagnosis is verified. Set reproductionSummary exactly to "Not attempted by baseline." Set status to "unverified" when the supplied evidence supports a diagnosis, or "inconclusive" when it is insufficient.`;

export function buildBaselineMessages(serializedContext: string): readonly LlmMessage[] {
  return Object.freeze([
    { role: "system", content: BASELINE_SYSTEM_PROMPT },
    { role: "user", content: serializedContext },
  ]);
}

export function buildFormatRetryMessages(
  serializedContext: string,
  invalidOutput: unknown,
): readonly LlmMessage[] {
  const candidate = typeof invalidOutput === "string" ? invalidOutput : JSON.stringify(invalidOutput);
  return Object.freeze([
    {
      role: "system",
      content: `This is a format-only correction. Reformat the previous candidate into the required baseline diagnosis schema. Preserve its analysis exactly: do not add facts, revise reasoning, inspect anything, or make a new diagnosis. The same case context is repeated only to preserve the frozen input boundary. Set reproductionSummary exactly to "Not attempted by baseline."`,
    },
    {
      role: "user",
      content: `${serializedContext}\n\n===== BEGIN CANDIDATE TO REFORMAT =====\n${candidate}\n===== END CANDIDATE TO REFORMAT =====`,
    },
  ]);
}
