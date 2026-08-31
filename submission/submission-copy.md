# Hackathon submission copy

## Project title

TraceRoot — Evidence-backed API failure investigation

## One-line pitch

TraceRoot turns an API failure report into a bounded, reproducible investigation with source evidence, a controlled runtime experiment, and an independently verified diagnosis.

## Demo

Watch the TraceRoot demo on YouTube:
[https://youtu.be/-OdVg0Ldw_Q](https://youtu.be/-OdVg0Ldw_Q)

## Problem

Backend developers often start with an error report, a large source surface, and logs whose loudest message may be secondary. One-shot LLM answers can be useful hypotheses, but they cannot establish that a request actually follows the claimed causal path.

## Solution

TraceRoot loads a strictly permitted artifact bundle, selectively inspects source and logs, maintains explicit hypotheses, describes one bounded reproduction against a controlled Express API, gathers correlated HTTP/log evidence, and applies an independent Verifier plus deterministic final gate.

## How agents are used

The Investigator chooses bounded evidence actions and maintains hypotheses. The Reproducer converts a selected hypothesis into a constrained HTTP experiment. The Verifier evaluates the hypothesis against cited source and runtime evidence, separating unsupported positive claims from limitations. Runtime code—not an LLM—executes tools and decides whether verification prerequisites pass.

## Why the architecture is agentic

The workflow changes its next action based on observations: it can inspect additional artifacts, revise a hypothesis, request reproduction, respond to missing-evidence feedback, or stop inconclusively. That loop is stateful and evidence-driven, but capabilities and budgets remain deterministic.

## Tools

Exactly four tools are exposed: `search_source`, `read_source`, `search_logs`, and `execute_reproduction`. There is no shell, database, vector store, unrestricted filesystem, or arbitrary network tool.

## Safety and boundedness

Path sandboxing prevents traversal, symlink escape, hidden-ground-truth access, and oversized reads. The orchestrator enforces tool, round, reproduction, and token limits; advertises allowed next actions; validates every role response; and owns target reset, tool execution, state transitions, and the verification gate.

## Evaluation methodology

We compared a frozen one-call baseline against the frozen agentic workflow on the same eight deterministic cases, with three repetitions per mode. Both used the same artifact hashes, `gpt-5.6-sol`, and effective sampling configuration. All 48 slots completed, with no failed attempts or fairness issues. Exact deterministic scoring covered category, normalized source file, and normalized symbol; causal mechanism review was blinded separately.

## Measured results

The baseline achieved 87.5% category accuracy and 87.5% all-field accuracy. TraceRoot achieved 91.7% category accuracy and 83.3% all-field accuracy. Therefore, the benchmark does **not** establish higher overall static accuracy for the agentic system. Its demonstrated advantage is runtime evidence: 23/24 agentic runs reached evidence-backed verification, with zero unsupported positive factual claims; one run stopped when evidence remained insufficient.

## Reproducibility

The repository uses Node.js, TypeScript, Express, Vitest, deterministic fixtures, a clean-install workflow, fake-provider tests, and a zero-credit evaluation dry run. Submission trajectories are sanitized derivatives of completed runs; raw credentialed artifacts remain ignored.

## Technical challenge

Real provider smoke tests exposed incompatibilities that mocks missed: Responses API output organization, unsupported temperature parameters, strict nested JSON Schema rules, provider/runtime schema drift, stale budget context, and ambiguous unsupported-claim semantics. Each defect was isolated, classified, and covered by regression tests before evaluation.

## Key engineering insights

Models should not infer deterministic runtime facts the application already knows. Provider schemas and runtime schemas need executable consistency tests. Reproduction expectations must distinguish report-required assertions from model-suggested supporting observations. Limitations are not unsupported factual claims. Finally, benchmark metadata and review artifacts need the same leakage discipline as prompts.

## Hot take

The strongest reason to use an agent is not that it talks longer or necessarily scores higher on static diagnosis. It is that a bounded agent can interact with a controlled system, leave an audit trail, and refuse to claim certainty when deterministic evidence is missing.

## Limitations

The benchmark has eight controlled local cases, one model family, and ontology ambiguity around category and root-cause ownership. Agentic runs cost roughly 5.5× more tokens and 6.2× more time. Verification establishes the observed failure path, not that a proposed code fix works in production.

## Future work

Without changing the frozen evaluation, future work could expand to 10–12 independently authored cases, add counterfactual patch validation, study additional models/providers, and test against richer distributed traces and dependency failures.
