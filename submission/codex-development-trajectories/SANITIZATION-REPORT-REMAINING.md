# TraceRoot Remaining Codex Development Traces — Sanitization Report

These files are sanitized exports of real Codex sessions. They are not reconstructed or synthetic.

## Files

### `02-agentic-orchestrator-debugging.sanitized.jsonl`
- Purpose: Agentic orchestrator debugging
- Source records: 121
- Retained submission-relevant records: 50
- Original size: 759,557 bytes
- Sanitized size: 310,374 bytes
- Sanitized SHA-256: `8faca0a8b0fdee6e2deefc9226de952d32f7d38ffb453b4e26a1694db4c8de18`
- Repository path redactions: 194
- User-home path redactions: 22
- `sk-*` credential-like strings redacted: 5
- Bearer-token strings redacted: 2
- API-key assignment values redacted: 2
- UUID occurrences pseudonymized: 44
- Provider-response IDs pseudonymized: 1

Post-sanitization scan:
- Windows user path: **0 raw matches**
- OpenAI-style key: **0 raw matches**
- Bearer token: **0 raw matches**
- Provider response id: **0 raw matches**
- Raw UUID: **0 raw matches**

### `03-provider-schema-debugging.sanitized.jsonl`
- Purpose: Provider/schema debugging
- Source records: 111
- Retained submission-relevant records: 46
- Original size: 726,949 bytes
- Sanitized size: 299,451 bytes
- Sanitized SHA-256: `26f8ce2a3f79c668e97b3875c003e45fbe97714c30cb4581edb70b9f39cd5924`
- Repository path redactions: 154
- User-home path redactions: 20
- `sk-*` credential-like strings redacted: 0
- Bearer-token strings redacted: 2
- API-key assignment values redacted: 1
- UUID occurrences pseudonymized: 42
- Provider-response IDs pseudonymized: 0

Post-sanitization scan:
- Windows user path: **0 raw matches**
- OpenAI-style key: **0 raw matches**
- Bearer token: **0 raw matches**
- Provider response id: **0 raw matches**
- Raw UUID: **0 raw matches**

### `04-evaluation.sanitized.jsonl`
- Purpose: Evaluation and benchmark work
- Source records: 115
- Retained submission-relevant records: 46
- Original size: 757,552 bytes
- Sanitized size: 311,124 bytes
- Sanitized SHA-256: `589d597a64e540e8980275f9cbf318b0c1d809a2bc484c4725604021ab0813b5`
- Repository path redactions: 174
- User-home path redactions: 19
- `sk-*` credential-like strings redacted: 0
- Bearer-token strings redacted: 0
- API-key assignment values redacted: 6
- UUID occurrences pseudonymized: 65
- Provider-response IDs pseudonymized: 0

Post-sanitization scan:
- Windows user path: **0 raw matches**
- OpenAI-style key: **0 raw matches**
- Bearer token: **0 raw matches**
- Provider response id: **0 raw matches**
- Raw UUID: **0 raw matches**

### `05-submission-reproducibility.sanitized.jsonl`
- Purpose: Submission/reproducibility work
- Source records: 94
- Retained submission-relevant records: 38
- Original size: 444,400 bytes
- Sanitized size: 166,841 bytes
- Sanitized SHA-256: `d85626489a4a0e9f480dc8ea0a7bb564c066943431739ea2b0eb3bc66fa1925b`
- Repository path redactions: 97
- User-home path redactions: 20
- `sk-*` credential-like strings redacted: 4
- Bearer-token strings redacted: 2
- API-key assignment values redacted: 5
- UUID occurrences pseudonymized: 37
- Provider-response IDs pseudonymized: 0

Post-sanitization scan:
- Windows user path: **0 raw matches**
- OpenAI-style key: **0 raw matches**
- Bearer token: **0 raw matches**
- Provider response id: **0 raw matches**
- Raw UUID: **0 raw matches**

## Removed material

- encrypted/internal reasoning records;
- system/developer runtime instructions and app-context boilerplate;
- filesystem/permission turn-context records;
- world-state and compaction records;
- token-count telemetry;
- duplicate event mirrors and thread-settings events.

The exports preserve user/assistant messages, tool calls, tool outputs, failures, retries, tests, fixes, and task handoffs.