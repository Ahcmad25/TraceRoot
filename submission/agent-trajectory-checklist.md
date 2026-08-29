# Agent trajectory submission checklist

The hackathon asks for agent trajectories in two distinct senses. Submit both where required; do not describe one as the other.

## A. TraceRoot runtime investigation trajectories

These record the product’s Investigator → Reproducer → Verifier workflow.

- [x] Sanitized representative package generated under `submission/trajectories/`.
- [x] Includes clean verification, misleading symptom, cross-file reasoning, multi-step exploration, and bounded abstention.
- [x] Preserves roles, actions, bounded tools, evidence links, hypothesis revisions, reproduction, verification, and termination.
- [x] Removes provider/run IDs, correlation/evidence UUIDs, secrets, machine paths, hidden ground truth, and evaluator-only data.
- [x] Keeps original raw trajectories unchanged and ignored under `results/`.
- [ ] Confirm whether the contest portal wants representative runs or every runtime run; upload more only if required.

## B. Codex development trajectories

These are the **actual Codex task/session exports** showing how TraceRoot itself was built and debugged. They are external to the product’s runtime trajectory format and must be exported from the real Codex history—never reconstructed from repository files.

- [ ] Export the architecture/Phase 1–3 implementation task(s), if retained.
- [ ] Export the benchmark-leakage audit that invalidated `baseline-v1`.
- [ ] Export the real-provider compatibility debugging sequence.
- [ ] Export the provider/runtime schema-alignment work.
- [ ] Export the budget-state propagation diagnosis.
- [ ] Export the reproduction-semantics and unsupported-claim fixes.
- [ ] Export the blinded-review leakage fix and evaluation interpretation work.
- [ ] Check each export for API keys, `.env` content, raw provider IDs/responses, machine paths, and unrelated personal data.
- [ ] Match exported task titles/timestamps to changelog entries without editing the historical content.
- [ ] Upload these Codex exports in the portal’s coding-agent trajectory field.

Repository runtime JSON files satisfy section A only. Screenshots, rewritten summaries, and fabricated transcripts do not satisfy section B.
