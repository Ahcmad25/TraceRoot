# TraceRoot evaluation report

## Evaluation question

Can a bounded agentic workflow add runtime-grounded confidence to API failure diagnosis while remaining fair to a strong one-shot baseline? The benchmark measures strict root-cause localization and the additional ability to reproduce and verify a causal explanation. It does not assume that more calls or tools imply a better diagnosis.

## Benchmark design

The frozen benchmark contains eight deterministic API failures (`case-001`–`case-008`). Each mode ran every case three times, producing 48 scored runs. The corpus includes validation, configuration, coercion, lookup, signing-key selection, configuration precedence, boolean parsing, and optimistic-version behavior. All cases expose the same five-file source corpus so an allowlist cannot reveal the responsible file.

The target API resets to a known state before each reproduction. Hidden ground truth and internal runtime mappings are isolated from model-visible artifacts. The official run used `gpt-5.6-sol`; temperature was omitted for both modes because that model does not support the parameter.

## Baseline definition

`baseline-v2` receives the complete immutable public artifact bundle in one deterministic serialization. It makes exactly one reasoning call, with at most one schema-only repair call. It cannot use tools, reproduce a request, iteratively investigate, or claim verification.

## Agentic definition

The frozen workflow uses `investigator-v1`, `reproducer-v2`, and `verifier-v2`. The Investigator may use only `search_source`, `read_source`, and `search_logs`; the Reproducer proposes a bounded HTTP experiment; and only `execute_reproduction` may reset and call the controlled target API. A separate Verifier assesses cited source and runtime evidence. A deterministic gate—not the model—decides whether verification prerequisites are met.

## Fairness controls

- Both modes receive the same `ArtifactBundle` and aggregate artifact hash for a case.
- Both use the same model and effective sampling configuration.
- Evaluation schedules three repetitions for every case/mode pair and records failed attempts rather than dropping them.
- Execution completes before hidden ground truth is loaded for scoring.
- Category, normalized source path, and normalized symbol are scored exactly; no fuzzy matching is used.
- Causal-mechanism review is blinded and separate from deterministic scoring.
- The official evaluation reported 0 failed attempts and 0 fairness issues.

## Metrics

Primary static metrics are category, source-file, symbol, and all-three-fields accuracy. Agentic-only evidence metrics include verified-diagnosis rate and unsupported positive factual claims. Efficiency metrics include LLM calls, bounded tool calls, tokens, and wall-clock duration. Baseline verification is **not applicable**: its 0% stored rate reflects the deliberate absence of runtime verification, not a failed verification attempt.

## Final aggregate results

| Metric | One-shot baseline | TraceRoot agentic |
|---|---:|---:|
| Category accuracy | 87.5% | 91.7% |
| Source-file accuracy | 100.0% | 91.7% |
| Symbol accuracy | 100.0% | 91.7% |
| All root-cause fields | 87.5% | 83.3% |
| Evidence-verified | N/A | 95.8% (23/24) |
| Unsupported positive claims | 0.0% | 0.0% |
| Mean LLM calls | 1.00 | 6.17 |
| Mean tool calls | 0.00 | 3.08 |
| Mean tokens | 4,106 | 22,525 |
| Mean runtime | 4.9 s | 30.6 s |

TraceRoot did not consistently improve strict static localization accuracy over the strong one-shot baseline. Its measurable advantage was different: it reproduced failures, collected correlated runtime evidence, and passed 23 of 24 diagnoses through an independent evidence gate with no unsupported positive claims.

## Per-case observations

| Case | Baseline all fields | Agentic all fields | Agentic verification | Observation |
|---|---:|---:|---:|---|
| case-001 | 3/3 | 3/3 | 3/3 | Clean source-to-runtime validation failure. |
| case-002 | 3/3 | 1/3 | 2/3 | One bounded abstention; location ownership varies between the configuration producer and consumer. |
| case-003 | 3/3 | 3/3 | 3/3 | Stable numeric-string coercion diagnosis. |
| case-004 | 3/3 | 3/3 | 3/3 | The workflow separated the primary lookup defect from a louder secondary audit error. |
| case-005 | 0/3 | 1/3 | 3/3 | All agentic runs reproduced and verified the mechanism, while category labels varied across an authentication/data-access boundary. |
| case-006 | 3/3 | 3/3 | 3/3 | Stable configuration-precedence diagnosis. |
| case-007 | 3/3 | 3/3 | 3/3 | Stable string-to-boolean coercion diagnosis despite a secondary symptom. |
| case-008 | 3/3 | 3/3 | 3/3 | Stable concurrency localization; one repetition used substantially more exploration. |

## Repetition variability

Six cases were perfectly stable on all root-cause fields in both modes. Agentic variability was concentrated in case-002 and case-005. Case-002 repetition 2 ended `evidence_insufficient_after_max_rounds` after two reproduced failures still did not provide the requested counterfactual evidence. Case-005 varied in category choice despite consistent runtime verification. Case-008 repetition 3 used six tools and nine LLM calls, compared with three tools and six calls in its other repetitions, but reached the same diagnosis.

## Cost and latency trade-off

The agentic workflow used about 5.5× the tokens and 6.2× the wall time of the baseline. That cost bought selective inspection, controlled reproduction, correlated logs, and independent verification—not a demonstrated uplift in overall static localization. For low-risk or obvious failures, the one-shot baseline may be the proportionate choice. TraceRoot is most useful when runtime confirmation and an auditable causal chain matter.

## Evidence-verification interpretation

“Verified” means the frozen deterministic gate found source evidence, a reproduced required HTTP failure signature, runtime HTTP evidence, valid evidence references, a Verifier outcome of `verified`, and zero unsupported positive factual claims. It does not mean the benchmark tested a patch or proved production-wide generality. Limitations and explicit non-claims remain visible without blocking verification.

## Failure and abstention example

In case-002 repetition 2, the controlled request reproduced twice, but the Verifier asked for a successful control after correcting the configuration name. Because the four-tool boundary cannot edit source or configuration, and the bounded rounds were exhausted, the orchestrator returned an unverified diagnosis with `evidence_insufficient_after_max_rounds`. This is preferable to forcing a verified label from incomplete causal evidence.

## Ontology limitations

- **case-005 category overlap:** selecting a retired signing key can reasonably be framed as `authentication` (invalid signing credentials) or `data-access` (wrong record selection). Exact category scoring treats those as distinct even when the mechanism is substantially the same.
- **case-002 ownership ambiguity:** the mismatch is created by a configuration producer and observed by a consumer. Exact file/symbol scoring must choose one ownership convention, while a technically useful diagnosis may name the adjacent side of the same mismatch.

These cases remain unchanged after evaluation. The limitations are documented rather than retroactively optimizing the benchmark.

## Threats to validity

- Eight deterministic cases are a compact benchmark, not a representative sample of production incidents.
- One model family was evaluated; provider and model effects are not separated.
- Repetitions can vary even with the same effective sampling configuration.
- The target API is controlled and local; distributed timing, partial observability, and real dependency failures are underrepresented.
- Exact category/location scoring is sensitive to ontology and ownership conventions.
- Evidence verification establishes the observed benchmark path, not that a proposed remediation works.
- Causal-mechanism quality still requires blinded human judgment; deterministic scores do not award it by keyword overlap.

## Reproducibility

The submission-safe machine-readable aggregates are in [evaluation-summary.json](evaluation-summary.json). Original credentialed results remain isolated under ignored `results/`; sanitized representatives are under `submission/trajectories/`. Follow [reproducibility.md](reproducibility.md) for clean-install checks, a fake-provider investigation test, and a zero-credit evaluation dry run. `--execute` is deliberately excluded because it makes paid provider calls.

Frozen reference versions: `baseline-v2`, `investigator-v1`, `reproducer-v2`, `verifier-v2`, `agentic-trajectory-v3`, tool contract `1.1.0`, `agentic-result-v1`, and `human-review-set-v2`.
