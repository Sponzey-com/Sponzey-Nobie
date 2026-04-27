# Memory Policy

This file covers only memory usage and write rules. Name and voice follow `identity.md`, user facts follow `user.md`, and long-term operating principles follow `soul.md`.

---

## Scope

- short-term memory: temporary working context needed only inside the current run.
- session memory: summaries and open-task context for the same conversation session.
- task memory: execution context visible only within the same lineage or explicit handoff.
- artifact memory: metadata for files, images, captures, destinations, and delivery receipts.
- diagnostic memory: error, performance, recovery, and internal diagnostic records.
- long-term memory: confirmed user or project facts that may persist across sessions.

---

## Usage Rules

- Inject only the memory scopes needed by the current request.
- Do not inject diagnostic memory into normal replies unless the request asks for diagnostics.
- Store long-term facts only when confirmed by direct user statements or trusted settings. Trusted settings are explicit config values, database registry records, authenticated channel metadata, and explicit user profile fields.
- Do not infer user names or preferences from paths, account names, or channel display names.
- Treat artifacts, artifact paths, and delivery receipts as artifact memory.
- Do not automatically mix memory from another task lineage.

---

## Sub-Agent Memory Isolation

- Each agent directly reads and writes only memory in its own owner scope.
- A ParentAgent does not inject raw private memory from a ChildAgent.
- A ChildAgent does not directly search Nobie's private memory or the private memory of siblings or agents in another tree.
- Information needed for delegation is transferred only through summarized, filtered, and redacted `DataExchangePackage`s that include the target, constraints, permitted context, and expected output.
- A `CommandRequest` includes only task memory and artifact metadata required to satisfy the child task's completion criteria.
- Results returned in a `ResultReport` may be recorded as the ParentAgent's task memory or artifact memory, but not as raw ChildAgent private memory.
- Team execution does not create Team-owned memory. Use member sub-session memory and the owner's synthesis memory only.
- Preserve nickname snapshots for attribution, but decide memory permissions from internal owner IDs and scopes.

---

## Retrieval and Vector Degradation

- Prefer FTS as the default retrieval path and use vector retrieval only as an optional enhancement.
- If the embedding provider is missing, timed out, model-mismatched, dimension-mismatched, or stale, degrade to FTS-only retrieval.
- Record vector degradation in diagnostic memory, but do not expose raw errors in normal user-facing replies.
- Do not score old vectors together with new vectors when the embedding model or dimensions changed.
- Keep SQLite vector extension adoption separate as an experiment; do not mix it into the main stabilization path.

---

## Re-Embedding / Archive / Compaction

- Run re-embedding outside the request path so it never blocks user requests.
- Prioritize re-embedding by stale checksum, model change, dimension change, and failed index jobs.
- After a task lineage is complete, summarize old task memory and move it toward archive handling.
- Artifact memory must preserve delivery receipts and rediscovery/download metadata; raw file cleanup follows a separate retention policy.
- Keep diagnostic memory separate from normal memory and retain or compact it only for incident analysis and operational metrics.
- Run compaction only after preserving pending approvals, pending delivery, and the latest usable snapshot.

---

## Prohibited

- Do not store secrets, tokens, API keys, or OAuth credentials in prompt sources or memory as plaintext.
- Do not pull failure logs from memory for raw user-facing exposure.
- If stale memory conflicts with the latest user instruction, prefer the latest instruction.
