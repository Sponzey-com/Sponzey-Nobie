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
6. Run backup/restore rehearsal: `pnpm run backup:rehearsal`.
7. Run channel smoke dry-run: `pnpm run smoke:channels`.
8. Build Yeonjang packages for each target OS.
9. Generate release manifest and checksum files: `pnpm run release:package`.
10. Run at least one live channel smoke and one Yeonjang smoke before public publish.

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
3. Restore previous Gateway/CLI/Core bundle.
4. Restore previous WebUI static build.
5. Restore DB, memory DB, prompt seed files, setup state, and prompt registry from the verified snapshot.
6. Restore config skeleton and re-enter secrets if the restored release requires them.
7. Restore Yeonjang binary and protocol/permission files compatible with the Gateway release.
8. Start Gateway and Yeonjang.
9. Confirm `/api/status`, prompt checksum, schedule list, memory search, Yeonjang capability status, and channel smoke.

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
- Channel smoke result.
- Yeonjang smoke result.

