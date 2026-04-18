import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { loadPromptSourceRegistry } from "../memory/nobie-md.js";
import { MIGRATIONS } from "../db/migrations.js";
import { getDatabaseMigrationStatus } from "./operations.js";
import { PATHS } from "./paths.js";
const LOGICAL_SQLITE_TABLES = ["audit_logs", "artifacts", "schedule_entries", "schedule_runs", "memory_documents", "memory_chunks"];
const SECRET_REENTRY_REQUIRED = [
    { scope: "config.ai.connection.auth", reason: "API keys and OAuth tokens are not copied into portable snapshot files." },
    { scope: "config.telegram.botToken", reason: "Telegram bot tokens must be re-entered after restore." },
    { scope: "config.slack.botToken/appToken/signingSecret", reason: "Slack tokens and signing secrets must be re-entered after restore." },
    { scope: "config.mqtt.password", reason: "MQTT passwords must be re-entered after restore." },
];
export const MIGRATION_ROLLBACK_RUNBOOK = {
    id: "migration-rollback-runbook",
    title: "Migration rollback runbook",
    retryForbiddenWhen: [
        "The backup snapshot checksum cannot be verified.",
        "SQLite integrity_check fails on the rollback DB.",
        "The current process still has active writers against the target DB.",
        "Provider config migration touched auth fields and secret re-entry has not been completed.",
    ],
    steps: [
        "Stop channel adapters and Yeonjang-triggered writes before touching the DB.",
        "Verify the selected snapshot manifest checksum and every file checksum.",
        "Copy the current DB aside as a rollback-of-rollback safety file.",
        "Restore the verified DB and prompt files into a temporary rehearsal directory first.",
        "Run SQLite integrity_check, migration version check, and prompt source registry check.",
        "Only after rehearsal passes, replace the operational DB and prompt files.",
        "Restart the service and confirm bootstrap, provider config loading, and memory lookup diagnostics.",
    ],
    restoreTargets: ["state/data.db", "state/memory.db3", "prompts/*.md", "prompts/*.md.en"],
};
export function buildBackupTargetInventory(options = {}) {
    const stateDir = resolve(options.stateDir ?? PATHS.stateDir);
    const workDir = resolve(options.workDir ?? process.cwd());
    const configPath = resolve(options.configPath ?? PATHS.configFile);
    const dbPath = resolve(options.dbPath ?? join(stateDir, "data.db"));
    const memoryDbPath = resolve(options.memoryDbPath ?? join(stateDir, "memory.db3"));
    const promptSources = loadPromptSourceRegistry(workDir).map(({ content: _content, ...metadata }) => metadata);
    const targets = [];
    targets.push(buildFileTarget({ id: "config", kind: "config", sourcePath: configPath, relativePath: "config/config.json5", include: false, required: false, reason: "secret_reentry_required" }));
    targets.push(buildFileTarget({ id: "sqlite:main", kind: "sqlite_db", sourcePath: dbPath, relativePath: "state/data.db", include: true, required: true, reason: "required" }));
    for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${dbPath}${suffix}`;
        targets.push(buildFileTarget({ id: `sqlite:main${suffix}`, kind: "sqlite_sidecar", sourcePath: sidecar, relativePath: `state/data.db${suffix}`, include: existsSync(sidecar), required: false, reason: existsSync(sidecar) ? "required" : "optional_missing" }));
    }
    targets.push(buildFileTarget({ id: "sqlite:memory", kind: "vector_db", sourcePath: memoryDbPath, relativePath: "state/memory.db3", include: existsSync(memoryDbPath), required: false, reason: existsSync(memoryDbPath) ? "required" : "optional_missing" }));
    targets.push(buildFileTarget({ id: "setup-state", kind: "setup_state", sourcePath: join(stateDir, "setup-state.json"), relativePath: "state/setup-state.json", include: existsSync(join(stateDir, "setup-state.json")), required: false, reason: existsSync(join(stateDir, "setup-state.json")) ? "required" : "optional_missing" }));
    for (const source of promptSources) {
        const fileName = basename(source.path);
        targets.push(buildFileTarget({ id: `prompt:${source.sourceId}:${source.locale}`, kind: "prompt_source", sourcePath: source.path, relativePath: `prompts/${fileName}`, include: true, required: source.required, reason: "required" }));
    }
    for (const tableName of LOGICAL_SQLITE_TABLES) {
        targets.push({ id: `logical:${tableName}`, kind: "logical_sqlite_table", sourcePath: dbPath, relativePath: `sqlite://${tableName}`, include: false, required: false, reason: "logical_coverage" });
    }
    for (const excluded of buildExcludedTargets(stateDir, workDir))
        targets.push(excluded);
    return {
        stateDir,
        workDir,
        configPath,
        dbPath,
        memoryDbPath,
        targets,
        included: targets.filter((target) => target.include),
        excluded: targets.filter((target) => !target.include),
        promptSources,
    };
}
export function createBackupSnapshot(options = {}) {
    const inventory = buildBackupTargetInventory(options);
    const now = options.now ?? Date.now();
    const id = `snapshot-${new Date(now).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const snapshotDir = resolve(options.snapshotDir ?? join(inventory.stateDir, "backups", "snapshots", id));
    const filesDir = join(snapshotDir, "files");
    mkdirSync(filesDir, { recursive: true });
    if (options.checkpointSqlite !== false)
        checkpointSqliteDatabase(inventory.dbPath);
    const files = [];
    for (const target of inventory.included) {
        if (!existsSync(target.sourcePath))
            continue;
        const snapshotPath = join(filesDir, ...target.relativePath.split("/"));
        mkdirSync(dirname(snapshotPath), { recursive: true });
        copyFileSync(target.sourcePath, snapshotPath);
        files.push({
            id: target.id,
            kind: target.kind,
            sourcePath: target.sourcePath,
            relativePath: target.relativePath,
            snapshotPath,
            sizeBytes: statSync(snapshotPath).size,
            checksum: sha256File(snapshotPath),
        });
    }
    const schemaVersion = safeMigrationStatus(inventory.dbPath)?.currentVersion ?? 0;
    const latestSchemaVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
    const manifestWithoutChecksum = {
        kind: "nobie.backup.snapshot",
        version: 1,
        id,
        createdAt: now,
        snapshotDir,
        appVersion: options.appVersion ?? "unknown",
        ...(options.gitTag ? { gitTag: options.gitTag } : {}),
        ...(options.gitCommit ? { gitCommit: options.gitCommit } : {}),
        schemaVersion,
        latestSchemaVersion,
        files,
        excluded: inventory.excluded,
        promptSources: inventory.promptSources,
        logicalCoverage: LOGICAL_SQLITE_TABLES,
        secretReentryRequired: SECRET_REENTRY_REQUIRED,
    };
    const checksum = checksumJson(manifestWithoutChecksum);
    const manifest = { ...manifestWithoutChecksum, checksum };
    writeFileSync(join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    return manifest;
}
export function verifyBackupSnapshotManifest(manifest) {
    const expectedManifestChecksum = checksumJson({ ...manifest, checksum: undefined });
    const failures = [];
    if (expectedManifestChecksum !== manifest.checksum)
        failures.push({ relativePath: "manifest.json", reason: "checksum_mismatch" });
    for (const file of manifest.files) {
        if (!existsSync(file.snapshotPath)) {
            failures.push({ relativePath: file.relativePath, reason: "missing" });
            continue;
        }
        if (sha256File(file.snapshotPath) !== file.checksum)
            failures.push({ relativePath: file.relativePath, reason: "checksum_mismatch" });
    }
    return { ok: failures.length === 0, checked: manifest.files.length + 1, failures };
}
export function runRestoreRehearsal(options) {
    const restoredDir = resolve(options.restoreDir);
    mkdirSync(restoredDir, { recursive: true });
    const checks = [];
    const restoredFiles = [];
    const verification = verifyBackupSnapshotManifest(options.manifest);
    checks.push({ name: "manifest_checksum", ok: verification.ok, message: verification.ok ? "Snapshot manifest and file checksums are valid." : `Snapshot verification failed: ${verification.failures.map((failure) => `${failure.relativePath}:${failure.reason}`).join(", ")}` });
    if (!verification.ok)
        return buildRestoreReport(options, restoredDir, checks, restoredFiles, undefined, 0);
    for (const file of options.manifest.files) {
        const targetPath = join(restoredDir, ...file.relativePath.split("/"));
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(file.snapshotPath, targetPath);
        restoredFiles.push(targetPath);
    }
    checks.push({ name: "file_copy", ok: true, message: `${restoredFiles.length} files restored into rehearsal directory.` });
    const restoredDbPath = join(restoredDir, "state", "data.db");
    const integrity = existsSync(restoredDbPath) ? checkSqliteIntegrity(restoredDbPath) : { ok: false, message: "Restored DB file is missing." };
    checks.push({ name: "sqlite_integrity", ok: integrity.ok, message: integrity.message });
    const migrationStatus = integrity.ok ? getDatabaseMigrationStatus(restoredDbPath) : undefined;
    checks.push({ name: "migration_status", ok: Boolean(migrationStatus?.upToDate), message: migrationStatus?.upToDate ? "Restored DB schema is up to date." : "Restored DB schema has pending or unknown migrations." });
    const promptSources = loadPromptSourceRegistry(restoredDir);
    checks.push({ name: "prompt_source_registry", ok: promptSources.length > 0, message: promptSources.length > 0 ? `${promptSources.length} prompt sources loaded without sys_prop dependency.` : "No prompt sources could be loaded from rehearsal directory." });
    return buildRestoreReport(options, restoredDir, checks, restoredFiles, migrationStatus, promptSources.length);
}
export function buildMigrationPreflightReport(options = {}) {
    const dbPath = resolve(options.dbPath ?? PATHS.dbFile);
    const status = getDatabaseMigrationStatus(dbPath);
    const pending = new Set(status.pendingVersions);
    const checks = [];
    checks.push(options.manifest
        ? { name: "backup_available", ok: true, risk: "low", message: `Backup snapshot ${options.manifest.id} is available.` }
        : { name: "backup_available", ok: false, risk: "blocking", message: "A verified backup snapshot is required before migration." });
    if (options.manifest) {
        const verification = verifyBackupSnapshotManifest(options.manifest);
        checks.push({ name: "snapshot_checksum", ok: verification.ok, risk: verification.ok ? "low" : "blocking", message: verification.ok ? "Backup snapshot checksum is valid." : "Backup snapshot checksum verification failed." });
    }
    checks.push({ name: "schema_version", ok: status.unknownAppliedVersions.length === 0, risk: status.unknownAppliedVersions.length === 0 ? "low" : "high", message: status.unknownAppliedVersions.length === 0 ? `Current schema ${status.currentVersion}, latest ${status.latestVersion}.` : `Unknown schema versions: ${status.unknownAppliedVersions.join(", ")}` });
    if (options.diskFreeBytes !== undefined || options.requiredFreeBytes !== undefined) {
        const free = options.diskFreeBytes ?? 0;
        const required = options.requiredFreeBytes ?? 0;
        checks.push({ name: "disk_space", ok: free >= required, risk: free >= required ? "low" : "blocking", message: `Disk free ${free} bytes, required ${required} bytes.` });
    }
    checks.push({ name: "db_lock", ok: options.dbLocked !== true, risk: options.dbLocked === true ? "blocking" : "low", message: options.dbLocked === true ? "DB lock is active; migration must not start." : "No DB lock was reported." });
    checks.push({ name: "wal_state", ok: true, risk: existsSync(`${dbPath}-wal`) ? "medium" : "low", message: existsSync(`${dbPath}-wal`) ? "WAL sidecar exists; checkpoint before snapshot or restore." : "No WAL sidecar detected." });
    checks.push({ name: "permission", ok: options.canWrite !== false, risk: options.canWrite === false ? "blocking" : "low", message: options.canWrite === false ? "Write permission check failed." : "Write permission was not reported as blocked." });
    checks.push({ name: "provider_config_sanity", ok: options.providerConfigSane !== false, risk: options.providerConfigSane === false ? "high" : "low", message: options.providerConfigSane === false ? "Provider config sanity check failed; secrets may need re-entry." : "Provider config sanity check passed or was not required." });
    const risk = summarizePreflightRisk(checks);
    return {
        ok: risk !== "blocking",
        risk,
        dbPath,
        latestSchemaVersion: status.latestVersion,
        currentSchemaVersion: status.currentVersion,
        pendingVersions: status.pendingVersions,
        checks,
        dryRun: {
            changesDatabase: false,
            willApply: MIGRATIONS.filter((migration) => pending.has(migration.version)).map((migration) => ({ version: migration.version, transaction: migration.transaction !== false })),
        },
        runbook: MIGRATION_ROLLBACK_RUNBOOK,
    };
}
function buildFileTarget(input) {
    const target = { ...input, sourcePath: resolve(input.sourcePath) };
    if (existsSync(target.sourcePath) && statSync(target.sourcePath).isFile()) {
        target.sizeBytes = statSync(target.sourcePath).size;
        target.checksum = sha256File(target.sourcePath);
    }
    if (target.required && !existsSync(target.sourcePath)) {
        target.include = false;
        target.reason = "optional_missing";
    }
    return target;
}
function buildExcludedTargets(stateDir, workDir) {
    const candidates = [
        { id: "exclude:artifacts", sourcePath: join(stateDir, "artifacts"), relativePath: "state/artifacts", reason: "large_retention_binary" },
        { id: "exclude:logs", sourcePath: join(stateDir, "logs"), relativePath: "state/logs", reason: "transient_runtime" },
        { id: "exclude:cache", sourcePath: join(stateDir, "cache"), relativePath: "state/cache", reason: "cache_or_build_output" },
        { id: "exclude:node_modules", sourcePath: join(workDir, "node_modules"), relativePath: "node_modules", reason: "cache_or_build_output" },
        { id: "exclude:dist", sourcePath: join(workDir, "packages", "core", "dist"), relativePath: "packages/core/dist", reason: "cache_or_build_output" },
    ];
    return candidates.map((candidate) => ({ kind: "excluded_path", include: false, required: false, ...candidate, sourcePath: resolve(candidate.sourcePath) }));
}
function checkpointSqliteDatabase(dbPath) {
    if (!existsSync(dbPath))
        return;
    let db;
    try {
        db = new BetterSqlite3(dbPath);
        db.pragma("wal_checkpoint(TRUNCATE)");
    }
    catch {
        // Snapshot creation still verifies the copied DB, so checkpoint failure is not fatal here.
    }
    finally {
        db?.close();
    }
}
function checkSqliteIntegrity(dbPath) {
    let db;
    try {
        db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
        const rows = db.prepare("PRAGMA integrity_check").all();
        const ok = rows.length === 1 && rows[0]?.integrity_check === "ok";
        return { ok, message: ok ? "SQLite integrity_check passed." : `SQLite integrity_check failed: ${rows.map((row) => row.integrity_check).join(", ")}` };
    }
    catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    finally {
        db?.close();
    }
}
function buildRestoreReport(options, restoredDir, checks, restoredFiles, migrationStatus, promptSourceCount) {
    const report = {
        ok: checks.every((check) => check.ok),
        snapshotId: options.manifest.id,
        restoredDir,
        checks,
        restoredFiles,
        ...(migrationStatus ? { migrationStatus } : {}),
        promptSourceCount,
    };
    if (options.writeReport) {
        const reportPath = join(restoredDir, "restore-rehearsal-report.json");
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
        report.reportPath = reportPath;
    }
    return report;
}
function safeMigrationStatus(dbPath) {
    try {
        return getDatabaseMigrationStatus(dbPath);
    }
    catch {
        return undefined;
    }
}
function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function checksumJson(value) {
    return createHash("sha256").update(JSON.stringify(normalizeForChecksum(value))).digest("hex");
}
function normalizeForChecksum(value) {
    if (Array.isArray(value))
        return value.map(normalizeForChecksum);
    if (value && typeof value === "object") {
        const object = value;
        return Object.fromEntries(Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => [key, normalizeForChecksum(object[key])]));
    }
    return value;
}
function summarizePreflightRisk(checks) {
    if (checks.some((check) => check.risk === "blocking" && !check.ok))
        return "blocking";
    if (checks.some((check) => check.risk === "high" && !check.ok))
        return "high";
    if (checks.some((check) => check.risk === "medium"))
        return "medium";
    return "low";
}
export function formatInventoryPathForDisplay(path, baseDir) {
    const resolvedBase = resolve(baseDir);
    const resolvedPath = resolve(path);
    const relativePath = relative(resolvedBase, resolvedPath);
    return relativePath && !relativePath.startsWith("..") && !relativePath.includes(`..${sep}`) ? relativePath : resolvedPath;
}
//# sourceMappingURL=backup-rehearsal.js.map