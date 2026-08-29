# TraceRoot

TraceRoot is an agentic API failure investigator for backend developers. Given a failure report, permitted source code, and initial logs, it forms hypotheses, executes bounded reproductions against a controlled API, verifies causal claims, and emits an auditable diagnosis.

Phase 4 is frozen at `traceroot-phase4-frozen`. Phase 5 adds an eight-case benchmark and evaluation infrastructure, but no official credentialed results have been generated yet.

## Problem

Backend failures rarely identify their own cause. A loud log may be secondary, a valid configuration value may lose to precedence, and a runtime value may differ from its TypeScript assertion. TraceRoot evaluates whether controlled investigation and reproduction improve root-cause identification over a fair one-shot comparison.

## Why one-shot diagnosis fails

The baseline must interpret every permitted source file and initial log in one prompt. It cannot inspect selectively, ask a follow-up question, reproduce the request, or distinguish a plausible explanation from a runtime-confirmed cause. This makes it vulnerable to incomplete logs, misleading secondary errors, and cross-file assumptions.

## Baseline architecture

`baseline-v2` receives the immutable `ArtifactBundle`, serialized deterministically with stable ordering and hashes. It makes exactly one reasoning call, with at most one schema-only repair call. It has no tools, reproduction, verification, retries for reasoning, or access to hidden ground truth.

## Agentic architecture

The frozen workflow uses `investigator-v1`, `reproducer-v2`, and `verifier-v2` in a bounded deterministic state machine. The Investigator gathers evidence and maintains hypotheses. The Reproducer describes a controlled request. Runtime code executes it. The Verifier checks whether source and correlated runtime evidence establish causation rather than correlation.

## Tool boundary

Only four tools exist:

- `search_source`
- `read_source`
- `search_logs`
- `execute_reproduction`

Source and log tools operate only on artifacts loaded through explicit allowlists. `execute_reproduction` is the only tool permitted to call target reset and correlated-log control endpoints. There is no shell tool, database, vector store, frontend, or unrestricted filesystem access.

## Evidence model

Investigations use an append-only journal. Evidence and hypothesis revisions are retained, while `activeHypotheses` exposes only each hypothesis’s latest non-rejected revision. Every tool observation records origin, locator, collection time, duration, and the tool contract version.

## Reproduction model

The orchestrator derives the required failure signature from the immutable public report: method, path, status, and response marker. Model-predicted log markers are supporting observations and cannot redefine whether the reported failure reproduced. Each attempt resets a fresh controlled target, assigns a correlation ID, captures response and correlated logs, and records required and supporting assertions separately.

## Verification gate

A diagnosis can be `verified` only when all of the following hold:

- supporting source evidence exists;
- the required runtime failure signature reproduced;
- runtime HTTP evidence exists;
- reproduction evidence is cited;
- every cited evidence reference is valid;
- the Verifier returned `verified`;
- there are zero unsupported positive factual claims.

Limitations and explicit non-claims remain visible but do not weaken or invalidate the gate.

## Benchmark design

The current deterministic corpus contains `case-001` through `case-008`. Every case exposes exactly the same five-file source corpus, so source allowlists cannot reveal the responsible file. Cases cover nested validation, configuration naming, numeric-string coercion, incorrect lookup fields with a secondary error, cross-file signing-key selection, configuration precedence, string-to-boolean coercion with a louder secondary error, and optimistic-version collision.

Each case has a public manifest and initial logs, deterministic target behavior, an internal neutral runtime mapping, hidden ground truth, and tests. Public identifiers remain neutral.

## Leakage prevention

`ArtifactLoader` can read only public manifests, manifest-permitted source files, and case-local initial logs. It explicitly denies `cases/ground-truth`, `cases/internal`, and `results`. Automated tests scan all eight artifact bundles and canonical baseline contexts for internal scenario IDs, hidden fields, benchmark paths, and answer labels. Runtime mappings and ground truth are never imported by baseline or agentic runners.

Evaluation execution and scoring are separate modules. All requested baseline and agentic attempts finish and their result artifacts are parsed before hidden ground truth is loaded for scoring.

## Evaluation methodology

Official evaluation uses eight cases, two frozen implementations, and three repetitions: 48 run slots. Both modes use the same case artifacts, model ID, and effective sampling configuration. GPT-5.6-family models omit temperature and record it as `null`.

Deterministic scoring reports category, normalized source file, normalized symbol, verification status, unsupported claims, calls, tools, tokens, duration, and termination reason. No fuzzy matching is used. A root-cause field match requires category, file, and symbol all to match. Causal-mechanism quality is emitted in a blinded human-review artifact and is never self-awarded by keyword overlap.

Summaries contain baseline means, agentic means, absolute differences, per-case/per-repetition rows, fairness violations, and every failed attempt. The evaluator is neutral: it can report either approach winning or no meaningful difference.

## Requirements and setup

- Node.js 22 or newer
- npm
- Docker, optionally

```sh
npm ci
cp .env.example .env
npm run typecheck
npm test
npm run build
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

## Developer commands

```sh
npm run target
npm run case -- case-001
npm run tool:search-source -- case-001 profile
npm run tool:read-source -- case-001 src/target-api/scenarios/user-registration.ts
npm run tool:search-logs -- case-001 ERROR
npm run tool:reproduce -- case-001
npm run baseline -- case-001
npm run investigate -- case-001
```

Baseline and agentic commands require `OPENAI_API_KEY` and `OPENAI_MODEL`. Credentials are read only from environment variables and are redacted from saved artifacts.

## How to reproduce evaluation results

Evaluation commands are dry runs unless `--execute` is explicitly supplied:

```sh
npm run evaluate -- --case case-001 --mode both --repetitions 3
npm run evaluate:all -- --repetitions 3
```

After the runner and evaluator are reviewed and frozen, the official credentialed execution is:

```sh
npm run evaluate:all -- --repetitions 3 --execute
```

Each case/mode/repetition is a resumable slot. Failed retries are written as separate attempt records; completed slots are not rerun. Outputs are stored under:

```text
results/baseline/
results/agentic/
results/evaluation/runs/
results/evaluation/summary.json
results/evaluation/summary.md
results/evaluation/human-review/items.json
```

## Docker reproducibility

The image contains no credentials. Build and run checks with:

```sh
docker build -t traceroot .
docker run --rm traceroot
docker run --rm traceroot npm run typecheck
docker run --rm traceroot npm run build
```

For an explicitly authorized credentialed command, pass environment variables at runtime rather than baking them into the image:

```sh
docker run --rm --env-file .env traceroot npm run evaluate:all -- --repetitions 3 --execute
```

## Current frozen versions

```text
git tag: traceroot-phase4-frozen
baseline-v2
investigator-v1
reproducer-v2
verifier-v2
agentic-trajectory-v3
tool contract 1.1.0
```

Phase 5 adds `evaluation-attempt-v1` and `evaluation-summary-v1`. Frozen Phase 4 contracts are unchanged.

## Limitations

- Official numerical results do not exist until the credentialed 48-slot evaluation is run.
- Model output may vary even when effective sampling settings are fixed.
- Causal-mechanism correctness requires blinded human review.
- The controlled API is a compact deterministic benchmark, not a production service emulator.
- Token usage is reported; dollar cost is not estimated because pricing changes over time.
- Eight cases improve diversity but remain smaller than the planned 10–12-case final corpus.
