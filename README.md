# TraceRoot

TraceRoot is a hackathon project for investigating backend API failures. It will compare a one-shot LLM baseline with a bounded agentic workflow that inspects source and logs, reproduces failures, and verifies diagnoses.

## Current phase

Phase 4 adds a deterministic bounded state machine around the versioned `investigator-v1`, `reproducer-v2`, and `verifier-v2` roles. It uses only the four approved tools, derives the required reproduction signature from the immutable failure report, treats model-proposed diagnostic markers as supporting observations, distinguishes unsupported positive factual claims from non-blocking limitations, enforces verification prerequisites independently of the model, and writes separate result and trajectory artifacts. The corrected `baseline-v2` contract remains frozen. Scoring and baseline-versus-agent evaluation remain unimplemented.

The planned final evaluation corpus contains 10–12 deterministic cases. Both approaches will receive the same report, permitted source files, and initial logs. The baseline will make exactly one temperature-zero model call, while the agentic approach will have four bounded tools: `search_source`, `read_source`, `search_logs`, and `execute_reproduction`.

## Requirements

- Node.js 22 or newer
- npm

## Setup

```sh
npm install
cp .env.example .env
```

On Windows PowerShell, copy the environment file with `Copy-Item .env.example .env`.

## Commands

```sh
npm test
npm run typecheck
npm run build
npm run target
npm run case -- case-001
npm run tool:search-source -- case-001 profile
npm run tool:read-source -- case-001 src/target-api/scenarios/user-registration.ts
npm run tool:search-logs -- case-001 ERROR
npm run tool:reproduce -- case-001
npm run baseline -- case-001
npm run baseline:all
npm run investigate -- case-001
```

`npm run target` starts only the controlled failure-fixture API on `127.0.0.1:4310` by default.

## Controlled API

Reset a scenario before reproducing it:

```text
POST /__control/reset/:scenarioId
GET  /__control/logs?requestId=trace-0001
```

Runtime scenario identifiers and case-to-scenario mappings are internal benchmark-control data. The reproduction CLI resolves them without adding them to the model-visible artifact bundle.

Public reports and initial logs are stored under `cases/public`. Ground truth is stored separately under `cases/ground-truth` and must never be exposed to a future diagnoser or tool sandbox.

The shared artifact loader reads only manifest-allowlisted target source files and case-local logs. It produces a SHA-256 hash for each artifact and a canonical aggregate hash. Tool reads operate against that loaded artifact version, while filesystem paths are independently checked against real paths and explicit allowlists.

Baseline and investigation commands require `OPENAI_API_KEY` and `OPENAI_MODEL` at runtime. They share the configured model, temperature, and timeout. Credentials are never included in prompts, metadata, CLI summaries, result files, or saved trajectories. Agentic results are written beneath `results/agentic/`; baseline results remain beneath `results/baseline/`. Both are ignored by Git and inaccessible to the artifact loader.

## Diagnosis correctness

A diagnosis is correct only when its fault category, source file and symbol, and causal mechanism match hidden ground truth. Diagnosis status is one of `verified`, `unverified`, or `inconclusive`.
