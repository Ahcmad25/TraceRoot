# TraceRoot demo video script (4:30 maximum)

## Recommended live case

Use **case-004**. Its failure is understandable in seconds—an existing account lookup returns 500—and it demonstrates why runtime investigation is more useful than a plausible one-shot answer. TraceRoot reads both the handler and fixture data, identifies an `id`/`externalId` mismatch, reproduces the exact HTTP failure, and shows that the louder audit error is secondary. It is more visually compelling than case-001, simpler than case-005’s signing-key/category nuance, and shorter than case-008’s six-tool path.

Prepare a credentialed `.env` locally, close unrelated terminals, increase terminal font size, and keep [case-004-r1.json](trajectories/case-004-r1.json) open as a no-network fallback. Never show `.env`.

## 0:00–0:30 — Problem

**Screen:** README title and result highlights.

**Say:** “API failures rarely point to their cause. The loudest log can be secondary, and a plausible static diagnosis is not the same as a reproduced one. TraceRoot is a bounded investigation workflow that inspects permitted artifacts, runs one controlled experiment, and verifies the causal chain.”

## 0:30–1:10 — Architecture

**Screen:** Mermaid diagram in `docs/architecture.md`.

**Say:** “The model proposes actions, but it never owns execution. The orchestrator controls budgets, allowed transitions, four tools, target resets, and the final gate. Ground truth, runtime mappings, and evaluation results are outside the model-visible boundary.”

## 1:10–2:35 — Live investigation

**Screen:** clean terminal.

```sh
npm run demo
```

**Say while it runs:** “The demo is the frozen case-004 workflow—no special prompt or benchmark variant. It loads the public case, starts the controlled target, and runs the existing Investigator, Reproducer, and Verifier.”

**Point out as the concise output appears:** case loaded; investigation started; two source reads; hypothesis formed; reproduction executed; expected 500 reproduced; Verifier outcome; final status and LLM/tool/token counts.

## 2:35–3:25 — Evidence and verification

**Screen:** `submission/trajectories/case-004-r1.json`, folded to `hypothesisRevisions`, `experiments`, and `outcome`.

**Say:** “The handler compares the route’s external ID against the internal `id`. Fixture data proves those fields differ. The correlated runtime shows the exact 500 path. The audit sink also fails, but only after lookup failure and does not choose the response branch. Verification requires source evidence, reproduced HTTP evidence, valid citations, and zero unsupported positive claims.”

## 3:25–4:10 — Benchmark

**Screen:** final-results table in `docs/evaluation-report.md`.

**Say:** “We froze both systems and ran eight cases, two modes, three repetitions: 48 of 48 slots completed with zero fairness issues. The strong one-shot baseline remained better on strict all-field localization—87.5 versus 83.3 percent—so we do not claim an accuracy uplift. TraceRoot’s demonstrated advantage is evidence: 23 of 24 agentic runs reached runtime-backed verification, with zero unsupported claims.”

## 4:10–4:30 — Close

**Screen:** README highlights.

**Say:** “The key insight is that agentic value is not simply a longer answer. It is controlled interaction with reality, an auditable trajectory, and the ability to abstain when the evidence gate is not satisfied.”
