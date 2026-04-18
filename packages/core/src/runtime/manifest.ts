import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { getConfig, PATHS } from "../config/index.js"
import { getDatabaseMigrationStatus } from "../config/operations.js"
import { getMqttBrokerSnapshot, getMqttExtensionSnapshots } from "../mqtt/broker.js"
import { checkPromptSourceLocaleParity, loadPromptSourceRegistry } from "../memory/nobie-md.js"
import { buildReleaseManifest } from "../release/package.js"
import { getCurrentAppVersion, getCurrentDisplayVersion, getWorkspaceRootPath } from "../version.js"
import { getProviderCapabilityMatrix, type ProviderCapabilityMatrix } from "../ai/capabilities.js"
import { buildRolloutSafetySnapshot, type RolloutSafetySnapshot } from "./rollout-safety.js"
import { resolveAdminUiActivation } from "../ui/mode.js"
import { getWebUiWsClientCount } from "../api/ws/stream.js"

export interface RuntimeManifestEnvironment {
  node: string
  pnpm: string | null
  rustc: string | null
  cargo: string | null
  platform: NodeJS.Platform
  arch: string
}

export interface RuntimeManifestDatabase {
  path: string
  exists: boolean
  currentVersion: number
  latestVersion: number
  pendingVersions: number[]
  unknownAppliedVersions: number[]
  upToDate: boolean
}

export interface RuntimeManifestPromptSources {
  workDir: string
  count: number
  checksum: string | null
  requiredCount: number
  enabledCount: number
  localeParityOk: boolean
  diagnostics: Array<{ severity: "warning" | "error"; code: string; message: string }>
}

export interface RuntimeManifestProviderProfile {
  profileId: string
  runtimeProfileId: string
  provider: string
  model: string
  endpointConfigured: boolean
  authMode: string | null
  credentialConfigured: boolean
  chatConfigured: boolean
  capabilityMatrix: ProviderCapabilityMatrix
  embeddingProvider: string | null
  embeddingModel: string | null
  embeddingConfigured: boolean
  resolverPath: string
}

export interface RuntimeManifestChannelSummary {
  webui: {
    enabled: boolean
    host: string
    port: number
    authEnabled: boolean
  }
  telegram: {
    enabled: boolean
    credentialConfigured: boolean
    targetConfigured: boolean
  }
  slack: {
    enabled: boolean
    credentialConfigured: boolean
    targetConfigured: boolean
  }
  mqtt: {
    enabled: boolean
    running: boolean
    host: string
    port: number
    authEnabled: boolean
    allowAnonymous: boolean
    reason: string | null
  }
}

export interface RuntimeManifestYeonjangNode {
  extensionId: string
  state: string | null
  version: string | null
  protocolVersion: string | null
  capabilityHash: string | null
  methodCount: number
  lastSeenAt: number
}

export interface RuntimeManifestMemory {
  dbPath: string
  dbExists: boolean
  searchMode: string | null
  ftsAvailable: boolean | null
  vectorTableAvailable: boolean | null
  embeddingRows: number | null
  embeddingProvider: string | null
  embeddingModel: string | null
}

export interface RuntimeManifestReleasePackage {
  manifestId: string | null
  releaseVersion: string | null
  requiredMissingCount: number | null
}

export interface RuntimeManifestAdminUi {
  enabled: boolean
  configEnabled: boolean
  runtimeFlagEnabled: boolean
  envEnabled: boolean
  cliEnabled: boolean
  localDevScriptEnabled: boolean
  productionMode: boolean
  subscriptionCount: number
  reason: string
}

export interface RuntimeManifest {
  kind: "nobie.runtime.manifest"
  version: 1
  id: string
  createdAt: string
  app: {
    appVersion: string
    displayVersion: string
    workspaceRoot: string
    gitDescribe: string | null
    gitCommit: string | null
  }
  process: {
    pid: number
    cwd: string
    startedAt: string | null
  }
  environment: RuntimeManifestEnvironment
  database: RuntimeManifestDatabase
  promptSources: RuntimeManifestPromptSources
  provider: RuntimeManifestProviderProfile
  channels: RuntimeManifestChannelSummary
  yeonjang: {
    nodeCount: number
    capabilityHash: string | null
    nodes: RuntimeManifestYeonjangNode[]
  }
  memory: RuntimeManifestMemory
  releasePackage: RuntimeManifestReleasePackage
  adminUi: RuntimeManifestAdminUi
  rollout: RolloutSafetySnapshot
  paths: {
    stateDir: string
    configFile: string
    dbFile: string
    memoryDbFile: string
  }
}

export interface RuntimeManifestOptions {
  now?: Date
  includeEnvironment?: boolean
  includeReleasePackage?: boolean
}

let lastRuntimeManifest: RuntimeManifest | null = null

function commandOutput(command: string, args: string[], cwd = getWorkspaceRootPath()): string | null {
  try {
    const value = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim()
    return value || null
  } catch {
    return null
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(",")}}`
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function hashObject(value: unknown): string {
  return sha256(stableStringify(value))
}

function readPromptSources(workDir: string): RuntimeManifestPromptSources {
  try {
    const sources = loadPromptSourceRegistry(workDir)
    const parity = checkPromptSourceLocaleParity(workDir)
    const digestInput = sources.map((source) => ({
      sourceId: source.sourceId,
      locale: source.locale,
      checksum: source.checksum,
      enabled: source.enabled,
      required: source.required,
      usageScope: source.usageScope,
      version: source.version,
    }))
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
    }
  } catch (error) {
    return {
      workDir,
      count: 0,
      checksum: null,
      requiredCount: 0,
      enabledCount: 0,
      localeParityOk: false,
      diagnostics: [{ severity: "error", code: "prompt_registry_unreadable", message: error instanceof Error ? error.message : String(error) }],
    }
  }
}

function tableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  const row = db.prepare<[string], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
  ).get(tableName)
  return Boolean(row)
}

function readCount(db: BetterSqlite3.Database, tableName: string): number | null {
  if (!tableExists(db, tableName)) return null
  const row = db.prepare<[], { count: number }>(`SELECT count(*) AS count FROM ${tableName}`).get()
  return row?.count ?? null
}

function readMemoryState(): RuntimeManifestMemory {
  const cfg = getConfig()
  const base: RuntimeManifestMemory = {
    dbPath: PATHS.dbFile,
    dbExists: existsSync(PATHS.dbFile),
    searchMode: cfg.memory.searchMode ?? null,
    ftsAvailable: null,
    vectorTableAvailable: null,
    embeddingRows: null,
    embeddingProvider: cfg.memory.embedding?.provider ?? null,
    embeddingModel: cfg.memory.embedding?.model ?? null,
  }

  if (!base.dbExists) return base
  try {
    const db = new BetterSqlite3(PATHS.dbFile, { readonly: true, fileMustExist: true })
    try {
      const ftsAvailable = tableExists(db, "memory_chunks_fts") || tableExists(db, "memory_fts")
      const vectorTableAvailable = tableExists(db, "memory_embeddings")
      return {
        ...base,
        ftsAvailable,
        vectorTableAvailable,
        embeddingRows: vectorTableAvailable ? readCount(db, "memory_embeddings") : null,
      }
    } finally {
      db.close()
    }
  } catch {
    return base
  }
}

function buildProviderProfile(): RuntimeManifestProviderProfile {
  const cfg = getConfig()
  const connection = cfg.ai.connection
  const auth = connection.auth
  const embedding = cfg.memory.embedding
  const capabilityMatrix = getProviderCapabilityMatrix({ connection, memory: cfg.memory })
  const normalized = {
    provider: connection.provider,
    model: connection.model,
    endpointConfigured: Boolean(connection.endpoint?.trim()),
    authMode: auth?.mode ?? null,
    credentialConfigured: Boolean(auth?.apiKey || auth?.oauthAuthFilePath || auth?.username || auth?.password),
    embeddingProvider: embedding?.provider ?? null,
    embeddingModel: embedding?.model ?? null,
  }
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
  }
}

function buildChannels(): RuntimeManifestChannelSummary {
  const cfg = getConfig()
  const mqtt = getMqttBrokerSnapshot()
  const telegram = cfg.telegram
  const slack = cfg.slack
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
  }
}

function buildYeonjang(): RuntimeManifest["yeonjang"] {
  const nodes = getMqttExtensionSnapshots().map((node) => ({
    extensionId: node.extensionId,
    state: node.state,
    version: node.version,
    protocolVersion: node.protocolVersion ?? null,
    capabilityHash: node.capabilityHash ?? null,
    methodCount: node.methods.length,
    lastSeenAt: node.lastSeenAt,
  }))
  return {
    nodeCount: nodes.length,
    capabilityHash: nodes.length > 0 ? hashObject(nodes.map((node) => ({ id: node.extensionId, hash: node.capabilityHash, methods: node.methodCount }))) : null,
    nodes,
  }
}

function buildReleasePackageState(includeReleasePackage: boolean): RuntimeManifestReleasePackage {
  if (!includeReleasePackage) {
    return { manifestId: null, releaseVersion: null, requiredMissingCount: null }
  }
  try {
    const manifest = buildReleaseManifest({ rootDir: getWorkspaceRootPath() })
    return {
      manifestId: hashObject({ releaseVersion: manifest.releaseVersion, artifacts: manifest.checksums, missing: manifest.requiredMissing }).slice(0, 16),
      releaseVersion: manifest.releaseVersion,
      requiredMissingCount: manifest.requiredMissing.length,
    }
  } catch {
    return { manifestId: null, releaseVersion: null, requiredMissingCount: null }
  }
}

function buildAdminUiState(): RuntimeManifestAdminUi {
  const activation = resolveAdminUiActivation()
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
  }
}

function buildEnvironment(includeEnvironment: boolean): RuntimeManifestEnvironment {
  return {
    node: process.version,
    pnpm: includeEnvironment ? commandOutput("pnpm", ["--version"]) : null,
    rustc: includeEnvironment ? commandOutput("rustc", ["--version"]) : null,
    cargo: includeEnvironment ? commandOutput("cargo", ["--version"]) : null,
    platform: process.platform,
    arch: process.arch,
  }
}

function buildDatabase(): RuntimeManifestDatabase {
  const status = getDatabaseMigrationStatus(PATHS.dbFile)
  return {
    path: status.databasePath,
    exists: status.exists,
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    pendingVersions: status.pendingVersions,
    unknownAppliedVersions: status.unknownAppliedVersions,
    upToDate: status.upToDate,
  }
}

export function buildRuntimeManifest(options: RuntimeManifestOptions = {}): RuntimeManifest {
  mkdirSync(dirname(PATHS.dbFile), { recursive: true })
  const now = options.now ?? new Date()
  const includeEnvironment = options.includeEnvironment ?? true
  const includeReleasePackage = options.includeReleasePackage ?? true
  const workspaceRoot = getWorkspaceRootPath()
  const gitDescribe = commandOutput("git", ["describe", "--tags", "--always", "--dirty"], workspaceRoot)
  const gitCommit = commandOutput("git", ["rev-parse", "--short", "HEAD"], workspaceRoot)
  const base = {
    kind: "nobie.runtime.manifest" as const,
    version: 1 as const,
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
  }
  const id = hashObject({ ...base, createdAt: undefined }).slice(0, 24)
  lastRuntimeManifest = { ...base, id }
  return lastRuntimeManifest
}

export function getLastRuntimeManifest(): RuntimeManifest | null {
  return lastRuntimeManifest
}

export function refreshRuntimeManifest(options: RuntimeManifestOptions = {}): RuntimeManifest {
  return buildRuntimeManifest(options)
}
