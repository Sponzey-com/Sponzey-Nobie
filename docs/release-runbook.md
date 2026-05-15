# Sponzey Nobie Release, Backup, Restore, Rollback Runbook

## Purpose

This runbook defines the minimum release process for Sponzey Nobie. A release is not just a binary build. It must carry the Gateway/CLI bundle, WebUI static files, prompt seed files, DB migration source, Yeonjang protocol files, package checksums, backup rehearsal evidence, and rollback instructions.

## Release Version Rule

- The displayed release version is based on `git describe --tags --always --dirty`.
- `NOBIE_DISPLAY_VERSION` or `NOBIE_GIT_VERSION` may override display version for reproducible CI builds.
- Gateway `/api/status`, CLI `--version`, and Yeonjang MQTT/node status must expose the same git-tag-derived version when built from the same checkout.
- `package.json` and `Cargo.toml` remain package baseline versions. They do not replace the release display version.

## Release Artifact Inventory

Required payload:

- Gateway/CLI Node bundle: `packages/cli/dist/index.js`, `packages/core/dist/index.js`.
- WebUI static build: `packages/webui/dist`.
- DB migration source: `packages/core/src/db/migrations.ts`.
- Prompt seed files: all required files from the prompt source registry.
- Yeonjang protocol and permission contract: `Yeonjang/src/protocol.rs`, `Yeonjang/manifests/permissions.json`.
- Release runbook: `docs/release-runbook.md`.

Platform payload:

- macOS: `Yeonjang.app` from `scripts/build-yeonjang-macos.sh`.
- Windows: `nobie-yeonjang.exe`, `build/start/stop-yeonjang-windows.bat`, tray/service packaging notes.
- Linux: `nobie-yeonjang` binary from a Linux build host.

Platform binaries are optional on a single-host local release build, but must be present before publishing a release for that platform.

## Release Build Order

1. Confirm checkout state and tag.
2. Run release dry-run: `pnpm run release:dry-run`.
3. Build packages: `pnpm -r build`.
4. Typecheck packages: `pnpm -r typecheck`.
5. Run automated tests: `pnpm test`.
6. Run Phase 022 execution decision regression gate: `pnpm run test:phase022`.
7. Run Phase 027 topology delegation/runtime cleanup gate: `pnpm run test:phase027`.
8. Run architecture cleanup gate: `pnpm run test:architecture`.
9. Review dead-code cleanup evidence in `.tasks/dead-code-candidates.md` and confirm no immediate-delete candidate remains in production source.
10. Run UI mode release gate: `pnpm test tests/task017-ui-release-gate.test.ts`.
11. Run sub-agent release readiness gate: `pnpm test tests/task030-release-gate-rollback-soak.test.ts`.
12. Run Enterprise Topology release gate: `pnpm test tests/task025-enterprise-topology-release-gate.test.ts`.
13. Run backup/restore rehearsal: `pnpm run backup:rehearsal`.
14. Run channel delivery release gate: `pnpm exec vitest run tests/channel-delivery-fallback.test.ts tests/channel-smoke-runner.test.ts tests/channel-adapter-contract-runner.test.ts tests/channel-connections.test.ts tests/task013-channel-api.test.ts`.
15. Run channel smoke dry-run: `pnpm run smoke:channels`.
16. Build Yeonjang packages for each target OS.
17. Generate release manifest and checksum files: `pnpm run release:package`.
18. Run at least one live channel smoke and one Yeonjang smoke before public publish.

## Execution Decision Regression Gate

Before release, `pnpm run test:phase022` must pass. The gate is defined in `docs/execution-decision-regression.md` and covers prompt source loading, prompt bundles, no-keyword execution decisions, orchestration planner compatibility, topology execution, explicit target validation, multilingual executor selection, risk boundaries, WebUI simple run UX, and Runtime Inspector evidence.

This gate is intentionally separate from long-running smoke and soak gates. It should remain fast enough to run frequently in CI, while live channels, Yeonjang smoke, backup rehearsal, and package release checks remain release-only evidence.

## Phase 027 Topology Delegation Gate

Before release, `pnpm run test:phase027` must pass. The gate protects the current topology runtime rules: Nobie and every current agent select from accessible direct children, deleted entry-selection fallback concepts stay out of runtime source, model profile timeout/retry fields do not terminate sub-sessions, provider direct routing is not used when topology executors are available, child results wait for parent aggregation, and Runtime Inspector/WebUI show selected executor, pending result, aggregation, and redelegation states instead of internal numeric execution limits.

The phase gate is split into:

- `pnpm run test:phase027:static`: removed routing/model-limit concepts do not return to source.
- `pnpm run test:phase027:routing`: execution-decision-first routing, topology executor selection, provider-direct blocking, and redelegation after child failure.
- `pnpm run test:phase027:runtime`: slow sub-session handling, late result aggregation, and no direct child-channel delivery.
- `pnpm run test:phase027:webui`: runtime inspector and topology trace display.

Release smoke must also confirm that a fresh channel request records no deleted entry-selection route reason, does not use provider direct when a matching direct child exists, and does not produce a model-timeout sub-session failure.

## Architecture Cleanup Gate

Before release, `pnpm run test:architecture` must pass. This gate binds the cleanup plan to executable evidence across source boundaries, runtime behavior, WebUI defaults, prompt bundles, and generated compatibility artifacts.

The architecture gate is split into:

- `pnpm run test:architecture:static`: Clean Architecture boundaries, deleted routing concepts, direct-child execution contracts, and critical-decision audit coverage.
- `pnpm run test:architecture:runtime`: current-agent fallback, execution trace, child result aggregation, final validation, and no direct child-channel delivery.
- `pnpm run test:architecture:webui`: default topology UI stays executor-graph first and excludes EnterpriseTopology V1, WorkOrder/manual run, compile preview, and raw internal ids from basic surfaces.
- `pnpm run test:architecture:prompts`: prompt source registry, prompt bundle assembly, AGENTS/prompt policy alignment, and no raw keyword/count-limit instruction regressions.
- `pnpm run test:architecture:generated`: TypeScript source and `packages/core/src` compatibility artifacts are synchronized.

Release checklist:

- No compiled default entry, first-node selection, or default-entry route is reintroduced.
- No ordinary request falls through to provider direct execution without an explicit provider target.
- No raw keyword or regex executor routing is introduced in code or prompts.
- Retry, attempt, delegation-turn, queue-retry, and timeout counts are not terminal business failure limits.
- EnterpriseTopology V1, WorkOrder/manual run, compile preview, and advanced route controls are absent from the default topology UI.
- Child results return to the parent/requesting agent and are not delivered directly to the user channel.
- Runtime Inspector and persisted trace agree on selected executor, fallback, aggregation, and finalizer state.
- Prompt bundles and `AGENTS.md` express the same delegation, self-solve, recovery, and completion policy.
- DB migration dry-run and backup rehearsal remain release blockers before public publish.

## Dead Code Cleanup Gate

Before release, `.tasks/dead-code-candidates.md` must be current. Immediate-delete items may be removed only when source references, package exports, tests, dynamic/runtime entry points, and generated artifacts have been checked. Public API, DB schema, compatibility adapters, and legacy/admin diagnostic surfaces must be deprecated or migrated in separate tasks instead of being deleted as part of opportunistic cleanup.

The cleanup gate must preserve the current product direction:

- ExecutorGraph/Topology V2 remains the runtime source of truth.
- Deleted routing concepts such as compiled default entry, keyword executor selection, provider-direct fallback, legacy follow-up auto attach, and attempt-count failure limits must not re-enter runtime behavior.
- Tests-only production exports should move to test helpers before deletion when they are still needed by regression coverage.
- Generated artifacts under `packages/core/src` must be synchronized from TypeScript source changes with `pnpm run core:sync-src-artifacts` and verified by `tests/generated-artifact-consistency.test.ts`.

## Channel Release Gate

The channel release gate must prove that provider differences are represented as channel fallback evidence, not as orchestration failures.

Automated or semi-automated gates:

- WebUI dry-run must pass for basic query, approval UI, artifact link, and unsupported feature fallback.
- Telegram and Slack must pass dry-run in CI and must have at least one live or semi-automated smoke before public publish when credentials are available.
- Long text must respect each channel `maxMessageLength`: split when allowed, summarize-and-link when requested, or deliver as a safe artifact link.
- Artifacts must use native file delivery when supported and fall back to a download link when native upload is unavailable.
- Sensitive artifacts must require explicit approval before delivery.

Fixture gates:

- Discord and Google Chat fixture smoke must cover basic query, approval/button UI, artifact delivery, and unsupported capability fallback.
- Fixture traces must reject cross-provider delivery tools, local path markdown, missing audit ids, and hidden approval controls.

Manual local bridge gates:

- iMessage and KakaoTalk are manual local bridge gates unless their local app, Yeonjang bridge, user session, automation permission, risk acknowledgement, and allowed targets are configured.
- Manual smoke evidence must include the selected bridge mode, target id type, manual confirmation setting, rate limit, and user-visible fallback text.
- Unsupported buttons, files, edits, deletes, threads, and typing indicators must be recorded as `unsupported_capability` receipt detail or a clear fallback notice.

Regression checklist:

- Duplicate delivery is blocked by idempotency keys and message ledger state.
- Continuation replies stay in the originating thread or explicit continuation context.
- Approval prompts are visible in the originating channel and do not silently downgrade into an invisible state.
- Artifact messages never expose local filesystem paths.
- Provider rate limits are recorded as retry/backoff receipts, not as lost runs.

## Sub-Agent Rollout Gate

Sub-agent orchestration must move through these release modes in order:

1. `flag_off`: `sub_agent_orchestration=off`, compatibility mode on, single Nobie only.
2. `dry_run_only`: shadow dry-run evidence only, no sub-agent final answer can become user-facing output.
3. `limited_beta`: limited operator beta with rollback smoke, benchmark thresholds, and restart-resume soak passing.
4. `full_enable`: public default only after limited beta evidence remains clean for the release window.

The release manifest must include `subAgentReleaseGate`. This evidence is the final sub-agent release blocker and must include:

- Release dry-run summary for orchestration mode, hot registry lookup, planner hot path, event stream recovery, final delivery dedupe, and migration rehearsal.
- Fallback gates for feature flag off, no sub-agent, and disabled sub-agent states.
- Delegation gates for one sub-agent, multiple parallel sub-agents, team composition, team target expansion, result review, nested delegation, and cascade stop.
- Isolation gates for memory scope, redacted data exchange, capability permission, approval, model/cost audit, and fallback reason audit.
- WebUI gates for React Flow topology validation, runtime projection, focus mode, templates, and import safety.
- Learning/history/restore append-only evidence with review-pending semantics.
- Benchmark thresholds: duplicate final answer count `0`, spawn ack p95 `<=300ms`, hot registry p95 `<=100ms`, planner hot path p95 `<=700ms`, first progress p95 `<=1.5s`, restart recovery p95 `<=3s`.
- Restart-resume soak evidence that verifies projection recovery, finalizer recovery, zero orphan sub-sessions, zero duplicate events, and zero duplicate final answers.

Do not proceed to full enablement when `subAgentReleaseGate.gateStatus` is `failed` or when `subAgentReleaseGate.blockingFailures` is non-empty.

MVP scope includes explicit sub-agent delegation, team target expansion, nested delegation within configured depth, memory/capability isolation, WebUI topology/runtime projection, benchmark evidence, and rollback by feature flag off. MVP excludes advanced automatic learning, complete external tool sandbox coverage, and cross-tree reference group UI.

## Enterprise Topology Rollout Gate

Enterprise Topology must ship behind an explicit staged flag matrix. The release manifest must include `enterpriseTopologyReleaseGate`, and public routing must not be enabled when this gate is failed.

Rollout stages:

1. `contracts_validator_only`: `enterprise_topology_validator=shadow`, `topology_runtime_enabled=off`. Contracts, relation rules, validator, and enterprise rule tests may run, but routing cannot change.
2. `dry_run_shadow`: registry, compiler, and declared/observed analysis may run in shadow or dual-write mode. Active topology selection and root-run routing remain off.
3. `gated_mode`: operators can validate activation, unified Workspace controls, Executor-first usability, runtime smoke, and rollback evidence. `topology_runtime_enabled` remains off.
4. `opt_in_routing`: registry, validator, compiler, and `topology_runtime_mvp` must be enforced before `topology_runtime_enabled=enforced` is allowed. Advanced recursive delegation, tool runtime, and exhaustion failure flags stay separately gated.

Required regression gates:

- Feature flag off path must fall back before topology registry lookup.
- Single Nobie fallback and existing sub-agent release gate must pass.
- Channel finalizer regression must preserve duplicate-final zero tolerance and late-result no-reply behavior.
- WebUI build gate must pass because the builder is GUI-first and should limit ordinary setup typing to executor name, executor work, and run input.
- Topology Workspace route gate must prove `/advanced/topology` is the only visible topology menu entry, `/advanced/enterprise-topology` redirects to `/advanced/topology?mode=build`, and the old Runtime Topology menu is removed.
- Topology Workspace layer gate must cover the visible Build, Run, Trace, and Improve layers. Runtime resource projection is internal evidence and must not be exposed as `/advanced/topology?mode=resources`.
- Executor-first usability gate must pass the happy path: `+ 실행자 추가`, executor name, executor work, `노비가 이해한 내용`, second executor, Smart Connect recommendation chip, run input, 실행, and 기록/고칠 점 review.
- Default UX leak gate must prove Task/Decision/Approval/Tool/Data/Group palette labels, WorkOrder Template, Context, AgentConfig, SubSession, CompiledSnapshot, Node Contract, Runtime Resource Topology, and JSON/YAML are hidden from the default surface.
- Internal stability gate must prove ExecutorGraph compiles to EnterpriseTopology, ExecutorGraph metadata remains projection-only, rule-based inference works without AI-assisted inference, feature flag off keeps single Nobie fallback, and the old Advanced/Developer topology surfaces are no longer exposed.
- Executor observability gate must prove confirmed understanding version, inference evidence id, runtime profile snapshot id, inferred WorkOrder template/context, trace event ids, and FailureReport evidence links can reconstruct `user description -> inference -> NodeContract -> WorkOrder -> FailureReport`.
- Topology runtime smoke must prove MVP execution with Nobie-owned final answer synthesis.
- Rollback smoke must restore the previous active topology and matching compiled snapshot without deleting runtime trace evidence.

Do not enable `topology_runtime_enabled` unless `enterpriseTopologyReleaseGate.gateStatus` is `passed`, the requested mode is `opt_in_routing`, and rollback evidence includes active topology plus compiled snapshot restore verification.

Workspace flag matrix meaning:

- `enterprise_topology_builder_ui`: controls the unified `/advanced/topology` Workspace. Off hides Workspace controls; the legacy enterprise builder URL still redirects to the canonical route and then follows the same feature gate.
- `declared_observed_topology_analysis`: controls Trace and Improve evidence that compares declared topology with observed runtime paths. Off must not delete trace tables.
- `topology_runtime_enabled`: controls Run layer root-run routing only. Off must preserve the existing single Nobie root-run path even when drafts, validation, or Workspace navigation are present.

Topology rollback checks:

- Simple mode rollback check: open the Executor Graph surface, confirm Build/Run/Trace/Improve remain visible, confirm `+ 실행자 추가`, 이름, 하는 일, `노비가 이해한 내용`, 입력, 실행, 기록, and 고칠 점 are available, and confirm Resources, Compile Preview, JSON/YAML, raw trace IDs, feature flag status, WorkOrder Template, Context, and direct relation/schema controls are not in the default surface.
- Removed surface rollback check: open `/advanced/topology?mode=resources`, `/advanced/topology?ux=advanced`, and `/advanced/topology?ux=developer&mode=build`; each must stay on the simple Executor Graph surface without Resources, Compile Preview, JSON/YAML, Developer tools, relation toolbar, Run Target, or advanced inspector settings.
- Rollback evidence must record which area failed: Simple UX regression, removed advanced surface regression, or runtime routing regression.
- Rollback evidence must also include `nobie.executor_graph.rollback_projection`: restored topology id/version, ExecutorGraph metadata presence, executor ids, connection ids, confirmed understanding ids, and `sourceOfTruth=executor_topology_v2`.

Executor evidence audit checks:

- In Simple mode, raw evidence ids stay hidden in the default result screen. Users see 실패 위치, 노비가 시도한 것, 다음 조치 first.
- Internal evidence audit may inspect sanitized developer logs outside the default topology surface, but the topology UI must not expose WorkOrder id, NodeContract id, raw trace ids, or JSON/YAML controls by default.
- If an inference was confirmed by the user, `confirmedUnderstandingVersion` must be present in topology metadata and node-level `executorGraph.inferenceEvidence`.
- Failure investigations must be able to follow: userDescription, normalizedUnderstanding, inferenceRuleIds, NodeContract id, WorkOrder id, traceEventIds, and FailureReport id.
- Rollback is incomplete if EnterpriseTopology version restores but ExecutorGraph projection metadata is missing or no longer matches the restored topology.

## UI Mode Release Gate

The release manifest must include `uiModeEvidence`. This evidence is a release blocker, not a UI-only checklist.

Required checks:

- Beginner smoke matrix: first-run shell, AI connection save/test, one chat run, one approval action, and result visibility.
- Advanced smoke matrix: AI settings save, channel status, Yeonjang status, execution monitor, and doctor summary.
- Admin smoke matrix: explicit admin flag, timeline access, inspectors, and diagnostic export dry-run.
- Resolver evidence: beginner default, advanced preference, admin request denied without flag, and admin request allowed with flag.
- Redaction evidence: beginner, advanced, admin, and export surfaces must mask secrets, raw HTML/payloads, and local paths.
- Admin guard evidence: admin API stays closed by default and in production unless config and runtime flag are both enabled.
- Route redirect evidence: legacy advanced URLs must redirect into `/advanced/*`; beginner `/chat` must not be redirected.
- Regression blockers: AI connection save stability, beginner raw error redaction, admin disabled data blocking, final-answer dedupe, and run-state reversal guard.

Do not publish when `uiModeEvidence.gateStatus` is `failed` or when `uiModeEvidence.blockingFailures` is non-empty.

## Update Preflight

Before updating a running installation:

- Verify Node.js 22+, pnpm, Rust toolchain for Yeonjang build hosts, OS compatibility, and write permissions.
- Create a backup snapshot with DB, memory DB, prompt seed files, setup state, and prompt source registry metadata.
- Do not include raw secrets in portable backup snapshots. Re-enter provider, Telegram, Slack, and MQTT secrets after restore if needed.
- Verify snapshot manifest checksum and every copied file checksum.
- Run migration preflight and block update when backup is missing, DB lock exists, checksum fails, or write permission is denied.
- Confirm Yeonjang `protocolVersion` compatibility before replacing Gateway or Yeonjang binaries.

## Topology V2 Migration Gate

Before enabling topology execution for a user DB, preserve history and materialize only the active runtime read model.

1. Stop channel writers or put the instance in maintenance mode.
2. Create a verified backup snapshot that includes `enterprise_topologies`, `enterprise_topology_versions`, `enterprise_topology_history`, `compiled_topology_snapshots`, `topology_validation_snapshots`, `topology_runs`, `topology_node_runs`, `topology_work_orders`, `topology_result_reports`, `topology_failure_reports`, `topology_trace_events`, `decision_traces`, `root_runs`, `run_events`, `run_subsessions`, and `orchestration_events`.
3. Run `PRAGMA integrity_check` and confirm migration lock status is clear.
4. Run the V2 dry-run path through `previewExecutorTopologyV2RegistryMigration`. The preview must report the source topology version, validation result, stale issue count, and a materialized topology payload without `metadata.executorGraph.workspace`, missing tool/system hints, default-entry metadata, or node permission caches.
5. Only after the dry run is clean, run `materializeExecutorTopologyV2ReadModelInRegistry`. This appends a new topology version and activates it; old versions remain audit history.
6. Do not physically delete old topology versions or run history unless the user explicitly requests DB initialization or physical cleanup.
7. Run `pnpm run test:phase026:db` and confirm Runtime Inspector shows topology schema `v2` and a materialization source such as `executor_topology_v2_materialized_read_model`.
8. Restart the local stack and run WebUI save/reload plus channel smoke before live validation.

### Topology V2 Dry-Run Report Contract

`previewExecutorTopologyV2RegistryMigration` is the required dry-run boundary for V1 to V2 cleanup. It must not append, activate, delete, compact, or rewrite registry state. Treat the report as release evidence, not as a migration side effect.

The report must show:

- `writePlanned=false` and `destructiveChangesPlanned=false`.
- `backupRequired=true`, `rollbackSupported=true`, and `approvalRequiredForDestructiveChanges=true`.
- Removed fields: legacy enterprise extension fields, stale node caches, non-delegation relation fields, and projection-only metadata that will be omitted from the V2 source read model.
- Transformed fields: executor nodes and `delegates_to` relations that become V2 nodes and edges.
- Preserved fields: topology identity, node identity/definition, topology version/history tables, compiled/validation snapshots, root runs, sub-sessions, orchestration events, and topology trace tables.
- Warnings for invalid V2 validation or unrepairable migration issues.

Removed fields in this report mean “not written into the V2 source model.” They do not mean physical DB deletion. Physical deletion of old versions, trace evidence, run history, or legacy columns requires a separate explicit administrative cleanup task with a verified backup and user confirmation.

### Topology V2 Rollback Boundary

Rollback must prefer version activation over physical restore when the only change is a newly materialized topology version.

1. Stop writers.
2. Record current active topology id/version, compiled snapshot id, and validation snapshot id.
3. Restore the previous active version with `rollbackTopologyVersion(topologyId, targetVersion)`.
4. Confirm the compiled snapshot matches the restored version hash.
5. Keep old V1 rows and all runtime traces as audit evidence.
6. Use full backup restore only when registry rollback cannot recover the incident.
7. After rollback, run WebUI topology reload and a channel smoke request before enabling live traffic.

## Restore Rehearsal

Restore into a rehearsal directory first:

1. Copy files from the verified snapshot manifest.
2. Run SQLite `integrity_check`.
3. Confirm migration status is known and up to date or intentionally pending.
4. Load prompt source registry without `sys_prop.md` dependency.
5. Confirm memory DB is readable when present.
6. Only promote rehearsal files to operational paths after every check passes.

## Rollback Procedure

Stop all writers first:

- Gateway server.
- Telegram/Slack channel adapters.
- Scheduler execution loop.
- Yeonjang agents or any tool path that can write artifacts or DB state.

Rollback steps:

1. Verify target release manifest and target backup snapshot checksums.
2. Copy current runtime state aside as rollback-of-rollback evidence.
3. Set `sub_agent_orchestration=off` before restoring binaries or state when the incident involves delegation, channel finalization, memory isolation, WebUI projection, or nested delegation.
4. Set `topology_runtime_enabled=off` before restoring binaries, active topology state, or compiled snapshots when the incident involves Enterprise Topology routing, Builder activation, validator/compiler output, or topology finalization.
5. Set `enterprise_topology_builder_ui=off` when the incident involves `/advanced/topology`, operator activation controls, `/advanced/enterprise-topology` compatibility routing, or the removed Runtime Topology menu entry.
6. Set `declared_observed_topology_analysis=off` when the incident involves Trace, Improve, observed edges, or gap analysis. Keep trace tables as evidence.
7. Record current active topology id, active version, validation snapshot id, and compiled snapshot id as rollback-of-rollback evidence.
8. Restore the previous active topology through `rollbackTopologyVersion(topologyId, targetVersion)` or from the verified backup.
9. Restore the compiled snapshot that matches the target topology version and source hash.
10. Confirm the single Nobie path can create a run and produce one final answer without deleting data.
11. Confirm `/advanced/topology` no longer exposes activation controls and `/advanced/enterprise-topology` still redirects to `/advanced/topology?mode=build`.
12. Restore previous Gateway/CLI/Core bundle when feature flag rollback alone is not enough.
13. Restore previous WebUI static build.
14. Restore DB, memory DB, prompt seed files, setup state, and prompt registry from the verified snapshot only after rehearsal passes.
15. Restore config skeleton and re-enter secrets if the restored release requires them.
16. Restore Yeonjang binary and protocol/permission files compatible with the Gateway release.
17. Start Gateway and Yeonjang.
18. Confirm `/api/status`, prompt checksum, schedule list, memory search, Yeonjang capability status, active topology version, compiled snapshot hash, `/advanced/topology` simple surface, and channel smoke.

Do not retry rollback automatically when:

- Release or backup checksum verification fails.
- SQLite integrity check fails.
- Prompt source registry cannot load.
- Yeonjang protocol is incompatible with the rollback Gateway.
- Secret re-entry is required but not completed.

## Required Evidence

Store these files with every release candidate:

- `manifest.json` from `scripts/release-package.mjs`.
- `SHA256SUMS` from `scripts/release-package.mjs`.
- Backup snapshot `manifest.json`.
- Restore rehearsal report.
- UI mode release gate summary from `manifest.json` under `uiModeEvidence`.
- Sub-agent release readiness summary from `manifest.json` under `subAgentReleaseGate`.
- Enterprise Topology release readiness summary from `manifest.json` under `enterpriseTopologyReleaseGate`.
- Channel delivery release gate and channel smoke result, including live/manual gate notes for external channels.
- Yeonjang smoke result.
