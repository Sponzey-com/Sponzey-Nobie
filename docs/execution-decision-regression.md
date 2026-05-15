# Execution Decision Regression Gate

## Purpose

Phase 022 removes natural-language keyword matching from core execution decisions. A request may arrive from a channel, WebUI, a schedule, or a topology run, but the decision flow must stay the same:

1. The current agent receives the request or delegated work.
2. The current agent produces an `AgentExecutionDecision` from its prompt, available executor profiles, visible connections, tools, and risk policy.
3. The harness validates only structured facts: executor id, connection path, availability, explicit target permission, and risk boundary.
4. If no delegated executor is valid, the current agent tries `self_solve` inside its own role and permissions.
5. If that is impossible, the work returns to the delegating agent or requester with an unresolved reason. Root Nobie may use `nobie_direct` or ask the user.

There is no separate router agent in the user model. Nobie and every delegated executor use the same execution decision capability from their own position in the graph.

## Regression Commands

Fast prompt and bundle gate:

```sh
pnpm run test:phase022:prompts
```

Fast execution decision gate:

```sh
pnpm run test:phase022:execution
```

Fast WebUI and inspector gate:

```sh
pnpm run test:phase022:webui
```

Full Phase 022 gate:

```sh
pnpm run test:phase022
```

Architecture cleanup gate:

```sh
pnpm run test:architecture
```

Topology V2 DB and release-readiness gate:

```sh
pnpm run test:phase026:db
```

The full gate is still a focused regression set. Long-running live channel smoke, Yeonjang smoke, soak, backup rehearsal, and release packaging remain separate release gates in `docs/release-runbook.md`.

## Minimum Coverage

The prompt gate must cover:

- prompt source registry loading and seed behavior
- runtime prompt source assembly
- sub-agent prompt bundle assembly
- `bootstrap` isolation from normal runtime and sub-agent prompt bundles
- prompt source regression snapshots

The execution gate must cover:

- no keyword execution decision static guard
- orchestration planner compatibility
- topology execution decision injection
- explicit target validation
- multilingual executor selection
- undefined request fallback
- risk boundary fallback

The WebUI gate must cover:

- simple run UX does not infer templates from typed keywords
- failure trace/result panels use structured enum fields, not reason string contains checks
- Runtime Inspector exposes execution decision, selected executor, fallback, and risk boundary evidence
- user-facing copy explains execution decisions with executor/path terms instead of a separate router concept

The Topology V2 DB gate must cover:

- active V1 topology loads as a V2 read model without validation 500/400
- V2 repair removes `children`, missing tool/system hints, stale `metadata.executorGraph.workspace`, and default-entry metadata
- dry-run migration reports stale cleanup without writing
- materialization appends and activates a new version while preserving old versions as audit history
- topology decision and topology run traces persist to DB
- Runtime Inspector can display topology schema version and migration source

## String Handling Policy

Forbidden for execution decisions:

- raw user message `includes`, regex, keyword tables, token overlap, or locale lowercasing to choose domain, tool, executor, route, relation, or final failure
- node name/description keyword matching to infer runtime profile or executor suitability
- retry count as a terminal failure condition

Allowed when it does not change execution decisions:

- explicit id parsing such as `topology:...`, `agent:...`, `provider:...`, `run:...`
- JSON, URL, path, extension, and enum parsing
- secret, token, password, authorization, and local path redaction
- UI label translation and display-only message formatting
- parser logic for already selected tool results

When adding or changing a prompt source, update all of the following in the same change:

- prompt source registry and seed list
- prompt bundle assembly expectations
- prompt source regression test
- this regression gate if the source changes the execution decision contract

## Runtime Inspector Check

Operators should verify the run in Runtime Inspector by checking:

- `Execution decision`: chosen path and selected executor
- `route`: structured execution route such as `delegate_to_child`, `self_solve`, `ask_parent`, or `ask_user`
- `fallback`: structured fallback reason when the chosen executor is unavailable or invalid
- `risk`: risk boundary kind and whether user approval is required
- topology trace: active executor nodes and connection edges
- finalizer: parent-owned aggregation status and final delivery status

Internal field names may still include legacy terms such as `topologyRouting` or `routingProfiles` for compatibility. User and operator copy should use execution decision, selected executor, execution path, and delegation flow.

## Task012 Legacy Routing Acceptance

Task012 is the final focused acceptance gate for channel request isolation and topology-first execution.

Run the focused suite:

```sh
pnpm run test:phase024:acceptance
```

The suite proves:

- separate Telegram/Slack messages start as new root request groups unless there is explicit continuation evidence
- root channel requests enter execution decision before any delegated follow-up run is created
- `provider:openai` direct execution is allowed only through an explicit provider target
- topology feature-flag fallback does not reopen provider direct execution
- `activeSubAgents` is never used as the execution-decision candidate list
- direct children in `ExecutionGraphSnapshot` are the only prompt-visible delegation candidates
- current-fact retrieval treats search snippets as discovery and tries alternative concrete sources before failure
- child results require parent aggregation before final channel delivery
- follow-up prompts do not include previous request group context unless continuation is explicit
- source/dist/gateway start status proves `build -> restart -> smoke` before live channel validation

Static audit commands:

```sh
rg "resolveRunRoute\\(" packages/core/src
rg "provider:openai" packages/core/src/runs packages/core/src/orchestration
rg "topology_routing_not_opted_in|non_root_request" packages/core/src
rg "delegate_failure_single_nobie|single_nobie" packages/core/src
rg "activeSubAgents" packages/core/src/orchestration packages/core/src/runs packages/core/src/topology-runtime
```

Allowed legacy locations:

- `resolveRunRoute()` may exist in `runs/routing` and may be called only as the explicit provider target resolver passed from `runs/intake-bridge-pass` into `decideExecutionRoute`.
- The explicit provider branch belongs in `orchestration/decide-execution-route.ts` and must run before execution graph selection. It must not be used as root request selection fallback.
- `provider:openai` may appear in route normalization only. It must not be the implicit child run target for a normal channel request.
- `topology_routing_not_opted_in` and `non_root_request` may remain in `topology-runtime/harness` as diagnostic fallback reason codes only.
- `single_nobie` may remain in compatibility contracts, config/settings, mode snapshots, release gates, and runtime inspector warnings. It must not appear in planner or execution harness selection logic.
- `activeSubAgents` may remain in mode projection, topology runtime diagnostics, and start-time dispatch checks. It must not build execution-decision candidates.

Operational smoke procedure:

1. Run `./scripts/status-local.sh`.
2. If `buildRequired=true`, run `pnpm --filter @nobie/core build` and `pnpm --filter @nobie/cli build`.
3. If `restartRequired=true`, restart local services with `bash scripts/start-local.sh --restart`.
4. Run `./scripts/status-local.sh` again and confirm `buildRequired=false` and `restartRequired=false`.
5. Run WebUI dry channel smoke:

```sh
curl -s -X POST -H 'content-type: application/json' \
  --data '{"mode":"dry-run","channel":"webui"}' \
  http://127.0.0.1:18888/api/channel-smoke/runs
```

6. Open the smoke run detail and confirm every step has `requestFlow.requestGroupMatchesRunId=true`, `decisionTracePresent=true`, `topologyRunCreated=true`, and `providerDirectUsed=false`.

DB evidence queries for live regression investigation:

```sql
SELECT id, request_group_id, source, created_at
FROM runs
ORDER BY created_at DESC
LIMIT 20;

SELECT run_id, label
FROM run_events
WHERE label LIKE '%execution_decision%'
ORDER BY created_at DESC
LIMIT 50;

SELECT run_id, label
FROM run_events
WHERE label LIKE '%provider_direct%'
ORDER BY created_at DESC
LIMIT 50;

SELECT run_id, label
FROM run_events
WHERE label LIKE '%parent_child_result_aggregated%'
ORDER BY created_at DESC
LIMIT 50;
```
