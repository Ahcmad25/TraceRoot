# TraceRoot Codex Development Trace — Sanitization Report

## Output

- Sanitized trace: `01-foundation-and-baseline.sanitized.jsonl`
- Source records: 3314
- Submission-relevant records retained: 1092
- Original size: 12,291,972 bytes
- Sanitized size: 3,232,878 bytes
- Original SHA-256: `3d6a68a93014dd5bf3ba730ec879f209945babd481327077272fbe63c3914d6c`
- Sanitized SHA-256: `2877339092d11f9f81de6f09866934f9752a1f00775424136da35ee5dccdce36`

## What was retained

This export preserves the real development chronology that is useful to judges:

- user prompts;
- assistant responses;
- Codex custom/function tool calls;
- corresponding tool results;
- task start/completion events;
- minimal session provenance.

It therefore retains implementation actions, commands/tests, failures, retries, fixes, and final handoffs.

## What was intentionally removed

The following were omitted because they are Codex-internal/runtime material rather than development evidence:

- encrypted/internal reasoning records;
- system/developer runtime instructions and app-context boilerplate;
- filesystem/permission turn-context records;
- world-state and compaction records;
- token-count telemetry;
- duplicate `item_completed` mirrors;
- thread-settings events;
- large base/system instruction payloads.

## Redactions / pseudonymization

- Repository absolute paths replaced with `<repo>`: 928
- User-home paths replaced with `<user-home>`: 37
- `sk-*` credential-like strings replaced: 15
- Bearer-token strings replaced: 20
- API-key assignment values replaced: 29
- Authorization values replaced: 2
- UUID occurrences pseudonymized: 286
- Provider-response IDs pseudonymized: 6

Pseudonymized identifiers are stable within this export so repeated references remain correlatable.

## Post-sanitization safety scan

- Windows user path: **0 raw matches**
- OpenAI-style key: **0 raw matches**
- Bearer token: **0 raw matches**
- Provider response id: **0 raw matches**
- Raw UUID: **0 raw matches**

All listed sensitive-pattern checks should be zero before public submission.

## Integrity note

This is a sanitized export of the real Codex session. It is not reconstructed or synthesized, and the source rollout file was not modified.
