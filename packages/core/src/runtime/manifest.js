import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { getConfig, PATHS } from "../config/index.js";
import { getDatabaseMigrationStatus } from "../config/operations.js";
import { getMqttBrokerSnapshot, getMqttExtensionSnapshots } from "../mqtt/broker.js";
import { checkPromptSourceLocaleParity, loadPromptSourceRegistry } from "../memory/nobie-md.js";
import { buildReleaseManifest } from "../release/package.js";
import { getCurrentAppVersion, getCurrentDisplayVersion, getWorkspaceRootPath } from "../version.js";
import { getProviderCapabilityMatrix } from "../ai/capabilities.js";
import { buildRolloutSafetySnapshot } from "./rollout-safety.js";
import { resolveAdminUiActivation } from "../ui/mode.js";
import { getWebUiWsClientCount } from "../api/ws/stream.js";
let lastRuntimeManifest = null;
function commandOutput(command, args, cwd = getWorkspaceRootPath()) {
    try {
        const value = execFileSync(command, args, {
            cwd,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 1500,
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function hashObject(value) {
    return sha256(stableStringify(value));
}
function readPromptSources(workDir) {
    try {
        const sources = loadPromptSourceRegistry(workDir);
        const parity = checkPromptSourceLocaleParity(workDir);
        const digestInput = sources.map((source) => ({
            sourceId: source.sourceId,
            locale: source.locale,
            checksum: source.checksum,
            enabled: source.enabled,
            required: source.required,
            usageScope: source.usageScope,
            version: source.version,
        }));
        return {
            workDir,
            count: sources.length,
            checksum: sources.length > 0 ? hashObject(digestInput) : null,
            requiredCount: sources.filter((source) => source.required).length,
            enabledCount: sources.filter((source) => source.enabled).length,
            localeParityOk: parity.ok,
            diagnostics: parity.issues.map((issue) => ({
                severity: "warning",
                code: issue.code,
                message: issue.message,
            })),
        };
    }
    catch (error) {
        return {
            workDir,
            count: 0,
            checksum: null,
            requiredCount: 0,
            enabledCount: 0,
            localeParityOk: false,
            diagnostics: [{ severity: "error", code: "prompt_registry_unreadable", message: error instanceof Error ? error.message : String(error) }],
        };
    }
}
function tableExists(db, tableName) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?").get(tableName);
    return Boolean(row);
}
function readCount(db, tableName) {
    if (!tableExists(db, tableName))
        return null;
    const row = db.prepare(`SELECT count(*) AS count FROM ${tableName}`).get();
    return row?.count ?? null;
}
function readMemoryState() {
    const cfg = getConfig();
    const base = {
        dbPath: PATHS.dbFile,
        dbExists: existsSync(PATHS.dbFile),
        searchMode: cfg.memory.searchMode ?? null,
        ftsAvailable: null,
        vectorTableAvailable: null,
        embeddingRows: null,
        embeddingProvider: cfg.memory.embedding?.provider ?? null,
        embeddingModel: cfg.memory.embedding?.model ?? null,
    };
    if (!base.dbExists)
        return base;
    try {
        const db = new BetterSqlite3(PATHS.dbFile, { readonly: true, fileMustExist: true });
        try {
            const ftsAvailable = tableExists(db, "memory_chunks_fts") || tableExists(db, "memory_fts");
            const vectorTableAvailable = tableExists(db, "memory_embeddings");
            return {
                ...base,
                ftsAvailable,
                vectorTableAvailable,
                embeddingRows: vectorTableAvailable ? readCount(db, "memory_embeddings") : null,
            };
        }
        finally {
            db.close();
        }
    }
    catch {
        return base;
    }
}
function buildProviderProfile() {
    const cfg = getConfig();
    const connection = cfg.ai.connection;
    const auth = connection.auth;
    const embedding = cfg.memory.embedding;
    const capabilityMatrix = getProviderCapabilityMatrix({ connection, memory: cfg.memory });
    const normalized = {
        provider: connection.provider,
        model: connection.model,
        endpointConfigured: Boolean(connection.endpoint?.trim()),
        authMode: auth?.mode ?? null,
        credentialConfigured: Boolean(auth?.apiKey || auth?.oauthAuthFilePath || auth?.username || auth?.password),
        embeddingProvider: embedding?.provider ?? null,
        embeddingModel: embedding?.model ?? null,
    };
    return {
        profileId: capabilityMatrix.profileId,
        runtimeProfileId: capabilityMatrix.profileId,
        provider: connection.provider,
        model: connection.model,
        endpointConfigured: normalized.endpointConfigured,
        authMode: normalized.authMode,
        credentialConfigured: normalized.credentialConfigured,
        chatConfigured: Boolean(connection.provider && connection.model),
        capabilityMatrix,
        embeddingProvider: normalized.embeddingProvider,
        embeddingModel: normalized.embeddingModel,
        embeddingConfigured: Boolean(embedding?.provider && embedding.model),
        resolverPath: connection.provider ? `ai.connection.${connection.provider}` : "ai.connection.unconfigured",
    };
}
function buildChannels() {
    const cfg = getConfig();
    const mqtt = getMqttBrokerSnapshot();
    const telegram = cfg.telegram;
    const slack = cfg.slack;
    return {
        webui: {
            enabled: cfg.webui.enabled,
            host: cfg.webui.host,
            port: cfg.webui.port,
            authEnabled: cfg.webui.auth.enabled,
        },
        telegram: {
            enabled: telegram?.enabled ?? false,
            credentialConfigured: Boolean(telegram?.botToken?.trim()),
            targetConfigured: Boolean((telegram?.allowedUserIds.length ?? 0) > 0 || (telegram?.allowedGroupIds.length ?? 0) > 0),
        },
        slack: {
            enabled: slack?.enabled ?? false,
            credentialConfigured: Boolean(slack?.botToken?.trim() && slack.appToken.trim()),
            targetConfigured: Boolean((slack?.allowedChannelIds.length ?? 0) > 0),
        },
        mqtt: {
            enabled: mqtt.enabled,
            running: mqtt.running,
            host: mqtt.host,
            port: mqtt.port,
            authEnabled: mqtt.authEnabled,
            allowAnonymous: mqtt.allowAnonymous,
            reason: mqtt.reason,
        },
    };
}
function buildYeonjang() {
    const nodes = getMqttExtensionSnapshots().map((node) => ({
        extensionId: node.extensionId,
        state: node.state,
        version: node.version,
        protocolVersion: node.protocolVersion ?? null,
        capabilityHash: node.capabilityHash ?? null,
        methodCount: node.methods.length,
        lastSeenAt: node.lastSeenAt,
    }));
    return {
        nodeCount: nodes.length,
        capabilityHash: nodes.length > 0 ? hashObject(nodes.map((node) => ({ id: node.extensionId, hash: node.capabilityHash, methods: node.methodCount }))) : null,
        nodes,
    };
}
function buildReleasePackageState(includeReleasePackage) {
    if (!includeReleasePackage) {
        return { manifestId: null, releaseVersion: null, requiredMissingCount: null };
    }
    try {
        const manifest = buildReleaseManifest({ rootDir: getWorkspaceRootPath() });
        return {
            manifestId: hashObject({ releaseVersion: manifest.releaseVersion, artifacts: manifest.checksums, missing: manifest.requiredMissing }).slice(0, 16),
            releaseVersion: manifest.releaseVersion,
            requiredMissingCount: manifest.requiredMissing.length,
        };
    }
    catch {
        return { manifestId: null, releaseVersion: null, requiredMissingCount: null };
    }
}
function buildAdminUiState() {
    const activation = resolveAdminUiActivation();
    return {
        enabled: activation.enabled,
        configEnabled: activation.configEnabled,
        runtimeFlagEnabled: activation.runtimeFlagEnabled,
        envEnabled: activation.envEnabled,
        cliEnabled: activation.cliEnabled,
        localDevScriptEnabled: activation.localDevScriptEnabled,
        productionMode: activation.productionMode,
        subscriptionCount: getWebUiWsClientCount(),
        reason: activation.reason,
    };
}
function buildEnvironment(includeEnvironment) {
    return {
        node: process.version,
        pnpm: includeEnvironment ? commandOutput("pnpm", ["--version"]) : null,
        rustc: includeEnvironment ? commandOutput("rustc", ["--version"]) : null,
        cargo: includeEnvironment ? commandOutput("cargo", ["--version"]) : null,
        platform: process.platform,
        arch: process.arch,
    };
}
function buildDatabase() {
    const status = getDatabaseMigrationStatus(PATHS.dbFile);
    return {
        path: status.databasePath,
        exists: status.exists,
        currentVersion: status.currentVersion,
        latestVersion: status.latestVersion,
        pendingVersions: status.pendingVersions,
        unknownAppliedVersions: status.unknownAppliedVersions,
        upToDate: status.upToDate,
    };
}
export function buildRuntimeManifest(options = {}) {
    mkdirSync(dirname(PATHS.dbFile), { recursive: true });
    const now = options.now ?? new Date();
    const includeEnvironment = options.includeEnvironment ?? true;
    const includeReleasePackage = options.includeReleasePackage ?? true;
    const workspaceRoot = getWorkspaceRootPath();
    const gitDescribe = commandOutput("git", ["describe", "--tags", "--always", "--dirty"], workspaceRoot);
    const gitCommit = commandOutput("git", ["rev-parse", "--short", "HEAD"], workspaceRoot);
    const base = {
        kind: "nobie.runtime.manifest",
        version: 1,
        createdAt: now.toISOString(),
        app: {
            appVersion: getCurrentAppVersion(),
            displayVersion: getCurrentDisplayVersion(),
            workspaceRoot,
            gitDescribe,
            gitCommit,
        },
        process: {
            pid: process.pid,
            cwd: process.cwd(),
            startedAt: null,
        },
        environment: buildEnvironment(includeEnvironment),
        database: buildDatabase(),
        promptSources: readPromptSources(workspaceRoot),
        provider: buildProviderProfile(),
        channels: buildChannels(),
        yeonjang: buildYeonjang(),
        memory: readMemoryState(),
        releasePackage: buildReleasePackageState(includeReleasePackage),
        adminUi: buildAdminUiState(),
        rollout: buildRolloutSafetySnapshot(PATHS.dbFile),
        paths: {
            stateDir: PATHS.stateDir,
            configFile: PATHS.configFile,
            dbFile: PATHS.dbFile,
            memoryDbFile: PATHS.memoryDbFile,
        },
    };
    const id = hashObject({ ...base, createdAt: undefined }).slice(0, 24);
    lastRuntimeManifest = { ...base, id };
    return lastRuntimeManifest;
}
export function getLastRuntimeManifest() {
    return lastRuntimeManifest;
}
export function refreshRuntimeManifest(options = {}) {
    return buildRuntimeManifest(options);
}
//# sourceMappingURL=manifest.js.map
