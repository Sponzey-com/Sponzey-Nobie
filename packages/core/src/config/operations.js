import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import JSON5 from "json5";
import BetterSqlite3 from "better-sqlite3";
import { PATHS } from "./paths.js";
import { MIGRATIONS } from "../db/migrations.js";
import { closeDb, getDb } from "../db/index.js";
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js";
import { ensurePromptSourceFiles, exportPromptSourcesToFile, importPromptSourcesFromFile, loadPromptSourceRegistry, } from "../memory/nobie-md.js";
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|authorization|auth[_-]?token)/iu;
const SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|\d{6,}:[A-Za-z0-9_-]{20,})\b/gu;
function backupRoot() {
    return join(PATHS.stateDir, "backups");
}
function timestampId(prefix) {
    return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}
function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function sqliteTableExists(db, tableName) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    return Boolean(row);
}
function readMigrationStatusFromDb(db, dbPath, exists) {
    const latestVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
    const knownVersions = new Set(MIGRATIONS.map((migration) => migration.version));
    const appliedVersions = sqliteTableExists(db, "schema_migrations")
        ? db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all().map((row) => row.version)
        : [];
    const applied = new Set(appliedVersions);
    const pendingVersions = MIGRATIONS
        .filter((migration) => !applied.has(migration.version))
        .map((migration) => migration.version);
    const unknownAppliedVersions = appliedVersions.filter((version) => !knownVersions.has(version));
    const currentVersion = appliedVersions.reduce((max, version) => Math.max(max, version), 0);
    return {
        databasePath: dbPath,
        exists,
        currentVersion,
        latestVersion,
        appliedVersions,
        pendingVersions,
        unknownAppliedVersions,
        upToDate: pendingVersions.length === 0 && unknownAppliedVersions.length === 0,
    };
}
export function getDatabaseMigrationStatus(dbPath = PATHS.dbFile) {
    const resolvedPath = resolve(dbPath);
    if (!existsSync(resolvedPath)) {
        const latestVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
        return {
            databasePath: resolvedPath,
            exists: false,
            currentVersion: 0,
            latestVersion,
            appliedVersions: [],
            pendingVersions: MIGRATIONS.map((migration) => migration.version),
            unknownAppliedVersions: [],
            upToDate: false,
        };
    }
    const db = new BetterSqlite3(resolvedPath, { readonly: true, fileMustExist: true });
    try {
        return readMigrationStatusFromDb(db, resolvedPath, true);
    }
    finally {
        db.close();
    }
}
export function dryRunDatabaseMigrations(dbPath = PATHS.dbFile) {
    const status = getDatabaseMigrationStatus(dbPath);
    const pending = new Set(status.pendingVersions);
    const willApply = MIGRATIONS
        .filter((migration) => pending.has(migration.version))
        .map((migration) => ({ version: migration.version, transaction: migration.transaction !== false }));
    const warnings = [];
    if (!status.exists)
        warnings.push("DB 파일이 아직 없습니다. 최초 실행 시 전체 schema가 생성됩니다.");
    if (status.unknownAppliedVersions.length > 0)
        warnings.push("현재 코드가 알지 못하는 migration version이 적용되어 있습니다.");
    return {
        status,
        willApply,
        warnings,
        changesDatabase: false,
        userMessage: willApply.length === 0
            ? "적용할 DB migration이 없습니다."
            : `${willApply.length}개의 DB migration이 적용 대상입니다. dry-run은 DB를 변경하지 않았습니다.`,
    };
}
function copyOptionalSqliteSidecar(sourceDbPath, backupDbPath, suffix) {
    const sourcePath = `${sourceDbPath}${suffix}`;
    if (!existsSync(sourcePath))
        return undefined;
    const targetPath = `${backupDbPath}${suffix}`;
    copyFileSync(sourcePath, targetPath);
    return targetPath;
}
export function createDatabaseBackup(kind = "backup", dbPath = PATHS.dbFile) {
    const resolvedPath = resolve(dbPath);
    if (!existsSync(resolvedPath))
        throw new Error("DB 파일이 없어 backup을 만들 수 없습니다.");
    mkdirSync(join(backupRoot(), "db"), { recursive: true });
    try {
        if (resolvedPath === resolve(PATHS.dbFile)) {
            getDb().pragma("wal_checkpoint(TRUNCATE)");
        }
    }
    catch {
        // Backup is still useful even when checkpoint is unavailable.
    }
    const createdAt = Date.now();
    const id = timestampId(kind === "export" ? "db-export" : kind === "rollback" ? "db-rollback" : "db-backup");
    const backupPath = join(backupRoot(), "db", `${id}.sqlite3`);
    copyFileSync(resolvedPath, backupPath);
    const walPath = copyOptionalSqliteSidecar(resolvedPath, backupPath, "-wal");
    const shmPath = copyOptionalSqliteSidecar(resolvedPath, backupPath, "-shm");
    return {
        id,
        kind,
        databasePath: resolvedPath,
        backupPath,
        ...(walPath ? { walPath } : {}),
        ...(shmPath ? { shmPath } : {}),
        checksum: sha256File(backupPath),
        createdAt,
    };
}
export function importDatabaseFromBackup(input) {
    const targetPath = resolve(input.dbPath ?? PATHS.dbFile);
    const importPath = resolve(input.backupPath);
    if (!existsSync(importPath))
        throw new Error("가져올 DB backup 파일을 찾을 수 없습니다.");
    const rollbackBackup = existsSync(targetPath)
        ? createDatabaseBackup("rollback", targetPath)
        : (() => {
            mkdirSync(dirname(targetPath), { recursive: true });
            const id = timestampId("db-empty-rollback");
            const placeholder = join(backupRoot(), "db", `${id}.sqlite3`);
            mkdirSync(dirname(placeholder), { recursive: true });
            writeFileSync(placeholder, "");
            return {
                id,
                kind: "rollback",
                databasePath: targetPath,
                backupPath: placeholder,
                checksum: createHash("sha256").update("").digest("hex"),
                createdAt: Date.now(),
            };
        })();
    closeDb();
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(importPath, targetPath);
    try {
        getDb();
        return {
            ok: true,
            importedPath: importPath,
            rollbackBackup,
            status: getDatabaseMigrationStatus(targetPath),
        };
    }
    catch (error) {
        closeDb();
        copyFileSync(rollbackBackup.backupPath, targetPath);
        getDb();
        const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error));
        throw new Error(`DB import가 실패해 rollback했습니다: ${sanitized.userMessage}`);
    }
}
export function maskSecretsDeep(value) {
    let maskedCount = 0;
    const mask = (item, key = "") => {
        if (typeof item === "string") {
            if (SECRET_KEY_PATTERN.test(key) || SECRET_VALUE_PATTERN.test(item)) {
                maskedCount += 1;
                return item ? "***MASKED***" : item;
            }
            return item;
        }
        if (Array.isArray(item))
            return item.map((entry) => mask(entry, key));
        if (item && typeof item === "object") {
            return Object.fromEntries(Object.entries(item).map(([entryKey, entryValue]) => [
                entryKey,
                mask(entryValue, entryKey),
            ]));
        }
        return item;
    };
    return { value: mask(value), maskedCount };
}
export function exportMaskedConfig() {
    const configPath = resolve(PATHS.configFile);
    if (!existsSync(configPath))
        throw new Error("설정 파일이 없어 export할 수 없습니다.");
    const parsed = JSON5.parse(readFileSync(configPath, "utf-8"));
    const masked = maskSecretsDeep(parsed);
    const createdAt = Date.now();
    const id = timestampId("config-export");
    const exportPath = join(backupRoot(), "config", `${id}.json`);
    mkdirSync(dirname(exportPath), { recursive: true });
    const payload = {
        kind: "nobie.config.export",
        createdAt,
        masking: {
            secretsMasked: masked.maskedCount,
            channelIdsMasked: false,
            userIdsMasked: false,
            policy: "Secrets are masked. Channel IDs and user IDs are retained because they are routing identifiers, not authentication secrets.",
        },
        config: masked.value,
    };
    writeFileSync(exportPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    return {
        id,
        configPath,
        exportPath,
        checksum: sha256File(exportPath),
        createdAt,
        masking: payload.masking,
    };
}
export function recoverPromptSources(workDir = process.cwd()) {
    return ensurePromptSourceFiles(workDir);
}
export function exportPromptSources(workDir = process.cwd()) {
    return exportPromptSourcesToFile({
        workDir,
        outputPath: join(backupRoot(), "prompts", `${timestampId("prompt-sources-export")}.json`),
    });
}
export function importPromptSources(input) {
    return importPromptSourcesFromFile({
        workDir: input.workDir ?? process.cwd(),
        exportPath: input.exportPath,
        overwrite: input.overwrite ?? false,
    });
}
export function buildConfigurationOperationsSnapshot(workDir = process.cwd()) {
    const maskedConfig = existsSync(PATHS.configFile)
        ? maskSecretsDeep(JSON5.parse(readFileSync(PATHS.configFile, "utf-8")))
        : { value: {}, maskedCount: 0 };
    const promptSources = loadPromptSourceRegistry(workDir);
    return {
        database: getDatabaseMigrationStatus(),
        promptSources: {
            workDir,
            count: promptSources.length,
            versions: promptSources.map(({ content: _content, ...metadata }) => metadata),
        },
        config: {
            configPath: resolve(PATHS.configFile),
            exists: existsSync(PATHS.configFile),
            masked: maskedConfig.value,
            maskingPolicy: "Secrets are masked. Channel IDs and user IDs are retained because they are routing identifiers, not authentication secrets.",
        },
    };
}
export function replaceFileAtomically(sourcePath, targetPath) {
    const tempPath = `${targetPath}.tmp-${randomUUID()}`;
    copyFileSync(sourcePath, tempPath);
    renameSync(tempPath, targetPath);
}
//# sourceMappingURL=operations.js.map