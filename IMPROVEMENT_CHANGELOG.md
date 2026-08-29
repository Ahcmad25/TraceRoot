# TraceRoot improvement changelog

This log records evidence-driven changes made before the frozen comparison. It documents defects and infrastructure corrections, not optimization against hidden evaluation answers.

## Benchmark leakage removed; baseline-v1 invalidated

- Observed failure: Model-visible context contained benchmark-construction details and semantic scenario labels.
- Root cause: Internal setup metadata was reused directly as public investigation context.
- Change: Added a strict public projection, neutral IDs, shared source allowlists, and internal/ground-truth denial. Invalidated `baseline-v1` and froze `baseline-v2`.
- Evidence/test: Canonical-context leakage tests scan forbidden labels and verify identical source corpora.
- Impact: Official runs begin from realistic artifacts rather than answer-bearing metadata.

## Real-provider response shape mismatch

- Observed failure: A Responses API call returned an unexpected response-shape failure before Investigator validation.
- Root cause: The adapter assumed the assistant response was the first output/content item.
- Change: Added explicit traversal of supported output/content variants and sanitized shape diagnostics.
- Evidence/test: Sanitized real-response fixture, multiple-output tests, and missing-output failure tests.
- Impact: Legitimate provider responses are parsed without accepting arbitrary text.

## Provider error classification

- Observed failure: Provider failures terminated as `invalid_investigator_action`.
- Root cause: Provider, parsing, schema, and runtime-policy failures shared one termination path.
- Change: Separated `provider_error`, `invalid_json`, `invalid_structured_output`, and `invalid_investigator_action`.
- Evidence/test: Dedicated provider-failure and malformed-runtime-action tests.
- Impact: Trajectories identify the responsible layer without relaxing action safety.

## Unsupported temperature handling

- Observed failure: `gpt-5.6-sol` rejected requests containing `temperature`.
- Root cause: Provider requests always sent a numeric value.
- Change: Added model-capability resolution that omits unsupported temperature and records `null`.
- Evidence/test: Supported-model inclusion, GPT-5.6-style omission, and metadata tests.
- Impact: Baseline and agentic modes share the same effective sampling configuration.

## Investigator provider/runtime schema mismatch

- Observed failure: OpenAI accepted hypothesis ID `H1`, while runtime required `^hyp-`.
- Root cause: Provider JSON Schema was weaker than the runtime action union.
- Change: Aligned ID, count, confidence, non-empty fields, and action discriminators while retaining runtime strictness.
- Evidence/test: Provider/runtime consistency suite covers invalid IDs, confidence, counts, and branches.
- Impact: Provider-constrained output satisfies the frozen runtime contract more reliably.

## Missing budget-state propagation

- Observed failure: Investigator claimed reproduction budgets were exhausted with zero attempts used.
- Root cause: Live budgets and allowed actions were omitted from role context.
- Change: Injected exact budget/capability state plus one bounded correction for false exhaustion claims.
- Evidence/test: Boundary tests cover reproduction, tool, round, and false-exhaustion states.
- Impact: Models no longer infer runtime facts the orchestrator already knows.

## Strict Reproducer schema incompatibility

- Observed failure: OpenAI rejected nested Reproducer objects lacking `additionalProperties: false`.
- Root cause: Provider schema did not satisfy strict Structured Outputs rules at every object level.
- Change: Audited Reproducer and Verifier graphs and encoded bounded request JSON with strict entries.
- Evidence/test: Strict-object graph and provider/runtime fixture tests.
- Impact: Role calls pass provider schema validation without arbitrary execution capability.

## Reproduction required-versus-supporting semantics

- Observed failure: A matching status/body was marked `not-reproduced` because one predicted log word was absent.
- Root cause: Required report assertions and speculative markers were combined with `every()`.
- Change: Derived required method/path/status/body from the report and recorded model log predictions separately.
- Evidence/test: Supporting-marker failures remain visible but do not override required matches.
- Impact: Runtime facts determine reproduction while the Verifier still receives contradictions.

## Limitation-versus-unsupported-claim semantics

- Observed failure: A statement that evidence did not establish an intended 4xx response blocked verification.
- Root cause: Caveats and unsupported positive assertions shared one array and gate rule.
- Change: Added separate `limitations` and `unsupportedClaims` fields in `verifier-v2`.
- Evidence/test: Limitation-only verification passes; positive unsupported claims and contradictions fail.
- Impact: Epistemic caution remains visible without weakening the final gate.

## Phase 5 evaluation isolation and resumability

- Observed failure: No frozen, answer-isolated path existed for repeated baseline-versus-agentic measurement.
- Root cause: Earlier phases intentionally stopped before scoring and batch infrastructure.
- Change: Added separate execution scheduling, result-only evaluation, exact scoring, three-repetition aggregation, resumable attempts, fairness checks, and blinded review.
- Evidence/test: Isolation, scoring, fresh-target, resume, aggregation, report, and redaction tests.
- Impact: The project can measure either workflow honestly without loading answers during investigation or discarding completed paid runs.

## Blinded-review leakage removed

- Observed failure: Human-review evidence references used baseline-specific locators and agentic evidence UUIDs, allowing a reviewer familiar with TraceRoot to infer execution mode.
- Root cause: Run-native evidence identifiers were copied into an otherwise blinded review item.
- Change: Added `human-review-set-v2` with neutral evidence labels, normalized evidence packets, opaque review case IDs, and deterministic seed-based candidate ordering.
- Evidence/test: Blinding tests reject mode labels, run/model metadata, tool origins, correlation IDs, UUID evidence IDs, and baseline/agentic locator conventions.
- Impact: Mechanism reviewers can judge supporting content without knowing which system produced the candidate.

## Evaluation ontology ambiguity documented

- Observed failure: Exact scoring disagreed with technically overlapping diagnoses in case-005 and adjacent producer/consumer locations in case-002.
- Root cause: The category ontology separates authentication from data-access, while the location ontology assigns a cross-file configuration mismatch to one owner.
- Change: Preserved the frozen cases, ground truth, and scores; documented category overlap and root-cause ownership ambiguity in the public report.
- Evidence/test: Per-repetition result/trajectory inspection confirmed the causal mechanisms and the exact fields responsible for scoring differences.
- Impact: Submission claims distinguish runtime verification from strict static accuracy without tuning the benchmark after observing results.
