# Sanitized TraceRoot runtime trajectories

These five representative files were derived from the completed repetition artifacts without rerunning a model or modifying the originals. They use `submission-trajectory-v1`, neutral evidence labels, neutral hypothesis labels, sanitized request arguments, bounded tool names, evidence relationships, hypothesis revisions, reproduction outcomes, Verifier decisions, termination reasons, and aggregate call/token counts.

Removed data includes raw provider/run IDs, evidence UUIDs, request/correlation UUIDs, timestamps, evidence origins/locators, machine-specific paths, secrets, hidden ground truth, and evaluator-only fields. Source paths remain repository-relative because they are part of the diagnosis and do not identify a machine.

| File | Why it is included |
|---|---|
| `case-001-r1.json` | Clean verified path: source inspection → hypothesis → reproduction → verification. |
| `case-004-r1.json` | Misleading symptom: the Verifier separates the primary account lookup defect from a secondary audit failure. |
| `case-005-r2.json` | Cross-file reasoning across logs, source search, and shared application data. |
| `case-008-r3.json` | Most extensive representative: six tools and multiple source/log inspections before verification. |
| `case-002-r2.json` | Bounded abstention after two reproductions could not satisfy the requested counterfactual evidence. |

These are **TraceRoot runtime investigation trajectories**. They are not Codex development histories and must not be submitted as a substitute for required coding-agent session exports.
