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
6. Run UI mode release gate: `pnpm test tests/task017-ui-release-gate.test.ts`.
7. Run sub-agent release readiness gate: `pnpm test tests/task030-release-gate-rollback-soak.test.ts`.
8. Run backup/restore rehearsal: `pnpm run backup:rehearsal`.
9. Run channel smoke dry-run: `pnpm run smoke:channels`.
10. Build Yeonjang packages for each target OS.
11. Generate release manifest and checksum files: `pnpm run release:package`.
12. Run at least one live channel smoke and one Yeonjang smoke before public publish.

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
4. Confirm the single Nobie path can create a run and produce one final answer without deleting data.
5. Restore previous Gateway/CLI/Core bundle when feature flag rollback alone is not enough.
6. Restore previous WebUI static build.
7. Restore DB, memory DB, prompt seed files, setup state, and prompt registry from the verified snapshot only after rehearsal passes.
8. Restore config skeleton and re-enter secrets if the restored release requires them.
9. Restore Yeonjang binary and protocol/permission files compatible with the Gateway release.
10. Start Gateway and Yeonjang.
11. Confirm `/api/status`, prompt checksum, schedule list, memory search, Yeonjang capability status, and channel smoke.

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
- Channel smoke result.
- Yeonjang smoke result.