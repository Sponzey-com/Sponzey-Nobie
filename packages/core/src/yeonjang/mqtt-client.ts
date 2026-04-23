import { randomUUID } from "node:crypto"
import mqtt, { type MqttClient } from "mqtt"
import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { getMqttBrokerSnapshot, getMqttExtensionSnapshots, validateMqttBrokerConfig, type MqttExtensionSnapshot } from "../mqtt/broker.js"

const log = createLogger("yeonjang:mqtt")

export interface YeonjangRequestEnvelope {
  id: string
  method: string
  params: Record<string, unknown>
  metadata?: YeonjangRequestMetadata
}

export interface YeonjangRequestMetadata {
  runId?: string
  requestGroupId?: string
  sessionId?: string
  source?: "webui" | "cli" | "telegram" | "slack"
  agentId?: string
  auditId?: string
  capabilityDelegationId?: string
}

export interface YeonjangErrorBody {
  code: string
  message: string
}

export interface YeonjangResponseEnvelope<T = unknown> {
  id?: string
  ok: boolean
  result?: T
  error?: YeonjangErrorBody
}

interface YeonjangChunkEnvelope {
  transport: "chunk"
  id?: string
  chunk_index: number
  chunk_count: number
  total_size_bytes?: number
  encoding?: "base64"
  mime_type?: string
  base64_data?: string
}

export interface YeonjangClientOptions {
  extensionId?: string
  timeoutMs?: number
  forceRefresh?: boolean
  metadata?: YeonjangRequestMetadata
}

export interface YeonjangMethodCapability {
  name: string
  implemented: boolean
  supported?: boolean
  requiresApproval?: boolean
  requiresPermission?: boolean
  permissionSetting?: string | null
  knownLimitations?: string[]
  outputModes?: string[]
  lastCheckedAt?: number
}

export interface YeonjangCapabilityMatrixEntry {
  supported?: boolean
  requiresApproval?: boolean
  requiresPermission?: boolean
  permissionSetting?: string | null
  knownLimitations?: string[]
  outputModes?: string[]
  lastCheckedAt?: number
}

export interface YeonjangCapabilitiesPayload {
  node?: string
  version?: string
  protocolVersion?: string
  protocol_version?: string
  gitTag?: string
  git_tag?: string
  gitCommit?: string
  git_commit?: string
  buildTarget?: string
  build_target?: string
  os?: string
  arch?: string
  platform?: string
  transport?: string | string[]
  capabilityHash?: string
  capability_hash?: string
  capabilityMatrix?: Record<string, YeonjangCapabilityMatrixEntry>
  capability_matrix?: Record<string, YeonjangCapabilityMatrixEntry>
  methods?: YeonjangMethodCapability[]
  permissions?: Record<string, unknown>
  toolHealth?: Record<string, unknown>
  tool_health?: Record<string, unknown>
  lastCapabilityRefreshAt?: number
  lastCheckedAt?: number
}

export const DEFAULT_YEONJANG_EXTENSION_ID = "yeonjang-main"
const YEONJANG_CAPABILITY_TTL_MS = 5_000

const capabilityCache = new Map<string, { payload: YeonjangCapabilitiesPayload; cachedAt: number }>()
const extensionExecutionQueues = new Map<string, Promise<void>>()

export function buildYeonjangTopics(extensionId = DEFAULT_YEONJANG_EXTENSION_ID): {
  statusTopic: string
  capabilitiesTopic: string
  requestTopic: string
  responseTopic: string
  eventTopic: string
} {
  const normalized = extensionId.trim() || DEFAULT_YEONJANG_EXTENSION_ID
  const prefix = `nobie/v1/node/${normalized}`
  return {
    statusTopic: `${prefix}/status`,
    capabilitiesTopic: `${prefix}/capabilities`,
    requestTopic: `${prefix}/request`,
    responseTopic: `${prefix}/response`,
    eventTopic: `${prefix}/event`,
  }
}

export async function invokeYeonjangMethod<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: YeonjangClientOptions = {},
): Promise<T> {
  const extensionId = options.extensionId?.trim() || DEFAULT_YEONJANG_EXTENSION_ID
  const execute = async (): Promise<T> => {
    const timeoutMs = clampTimeout(options.timeoutMs)
    const topics = buildYeonjangTopics(extensionId)
    const requestId = randomUUID()
    const metadata = normalizeYeonjangRequestMetadata(options.metadata)
    const client = createClient()

    log.debug(`invoking ${method} on ${extensionId}`)

    try {
      await waitForConnect(client, timeoutMs)
      await subscribe(client, topics.responseTopic)
      await publish(client, topics.requestTopic, {
        id: requestId,
        method,
        params,
        ...(metadata ? { metadata } : {}),
      })
      const response = await waitForResponse<T>(client, topics.responseTopic, requestId, timeoutMs)
      return response
    } finally {
      await closeClient(client)
    }
  }

  if (!shouldSerializeYeonjangMethod(method)) {
    return await execute()
  }
  return await enqueueYeonjangExtensionExecution(extensionId, execute)
}

function normalizeYeonjangRequestMetadata(
  metadata?: YeonjangRequestMetadata,
): YeonjangRequestMetadata | undefined {
  if (!metadata) return undefined
  const normalizedEntries = Object.entries(metadata).filter(([, value]) => {
    if (typeof value === "string") return value.trim().length > 0
    return value != null
  })
  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries) as YeonjangRequestMetadata
}

export async function getYeonjangCapabilities(options: YeonjangClientOptions = {}): Promise<YeonjangCapabilitiesPayload> {
  const extensionId = normalizeExtensionId(options.extensionId)
  if (!options.forceRefresh) {
    const cached = getFreshCachedCapabilities(extensionId)
    if (cached) return cached

    const snapshot = getFreshCapabilitySnapshot(extensionId)
    if (snapshot) {
      const payload = snapshotToYeonjangCapabilitiesPayload(snapshot)
      rememberCapabilities(extensionId, payload)
      return payload
    }
  }

  const payload = await invokeYeonjangMethod<YeonjangCapabilitiesPayload>(
    "node.capabilities",
    {},
    { ...options, extensionId },
  )
  rememberCapabilities(extensionId, payload)
  return payload
}

export function clearYeonjangCapabilityCache(): void {
  capabilityCache.clear()
}

export function shouldSerializeYeonjangMethod(method: string): boolean {
  const normalized = method.trim().toLowerCase()
  return normalized !== "node.capabilities" && normalized !== "camera.list"
}

export async function enqueueYeonjangExtensionExecution<T>(
  extensionId: string,
  task: () => Promise<T>,
): Promise<T> {
  const normalizedExtensionId = normalizeExtensionId(extensionId)
  const previous = extensionExecutionQueues.get(normalizedExtensionId) ?? Promise.resolve()
  let releaseCurrentQueue!: () => void
  const currentQueue = new Promise<void>((resolve) => {
    releaseCurrentQueue = resolve
  })
  const queued = previous
    .catch(() => undefined)
    .then(() => currentQueue)
  extensionExecutionQueues.set(normalizedExtensionId, queued)

  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    releaseCurrentQueue()
    if (extensionExecutionQueues.get(normalizedExtensionId) === queued) {
      extensionExecutionQueues.delete(normalizedExtensionId)
    }
  }
}

export async function canYeonjangHandleMethod(
  method: string,
  options: YeonjangClientOptions = {},
): Promise<boolean> {
  try {
    const capabilities = await getYeonjangCapabilities(options)
    return doesYeonjangCapabilitySupportMethod(capabilities, method)
  } catch (error) {
    if (isYeonjangUnavailableError(error)) return false
    throw error
  }
}

export function resolveYeonjangMethodCapability(
  capabilities: YeonjangCapabilitiesPayload,
  method: string,
): YeonjangCapabilityMatrixEntry | YeonjangMethodCapability | null {
  const matrix = capabilities.capabilityMatrix ?? capabilities.capability_matrix
  const matrixEntry = matrix?.[method]
  if (matrixEntry) return matrixEntry
  return capabilities.methods?.find((candidate) => candidate.name === method) ?? null
}

export function doesYeonjangCapabilitySupportMethod(
  capabilities: YeonjangCapabilitiesPayload,
  method: string,
): boolean {
  const entry = resolveYeonjangMethodCapability(capabilities, method)
  if (!entry) return false
  if ("supported" in entry && typeof entry.supported === "boolean") return entry.supported
  if ("implemented" in entry && typeof entry.implemented === "boolean") return entry.implemented
  return false
}

export function hasYeonjangCapabilityMatrix(capabilities: YeonjangCapabilitiesPayload): boolean {
  return Boolean(capabilities.capabilityMatrix ?? capabilities.capability_matrix)
}

export function resolveYeonjangCapabilityOutputModes(
  capabilities: YeonjangCapabilitiesPayload,
  method: string,
): string[] | null {
  const entry = resolveYeonjangMethodCapability(capabilities, method)
  if (!entry || !Array.isArray(entry.outputModes)) return null
  return entry.outputModes
    .map((mode) => mode.trim().toLowerCase())
    .filter(Boolean)
}

export function doesYeonjangCapabilitySupportOutputMode(
  capabilities: YeonjangCapabilitiesPayload,
  method: string,
  outputMode: string,
): boolean | null {
  const modes = resolveYeonjangCapabilityOutputModes(capabilities, method)
  if (!modes) return null
  return modes.includes(outputMode.trim().toLowerCase())
}

export function snapshotToYeonjangCapabilitiesPayload(snapshot: MqttExtensionSnapshot): YeonjangCapabilitiesPayload {
  const matrix = snapshot.capabilityMatrix as Record<string, YeonjangCapabilityMatrixEntry> | undefined
  return {
    node: "nobie-yeonjang",
    ...(snapshot.version ? { version: snapshot.version } : {}),
    ...(snapshot.protocolVersion ? { protocolVersion: snapshot.protocolVersion } : {}),
    ...(snapshot.gitTag ? { gitTag: snapshot.gitTag } : {}),
    ...(snapshot.gitCommit ? { gitCommit: snapshot.gitCommit } : {}),
    ...(snapshot.buildTarget ? { buildTarget: snapshot.buildTarget } : {}),
    ...(snapshot.os ? { os: snapshot.os } : {}),
    ...(snapshot.arch ? { arch: snapshot.arch } : {}),
    ...(snapshot.platform ? { platform: snapshot.platform } : {}),
    ...(snapshot.transport ? { transport: snapshot.transport } : {}),
    ...(snapshot.capabilityHash ? { capabilityHash: snapshot.capabilityHash } : {}),
    ...(matrix ? { capabilityMatrix: matrix } : {}),
    methods: matrix
      ? Object.entries(matrix).map(([name, entry]) => matrixEntryToMethodCapability(name, entry))
      : snapshot.methods.map((name) => ({ name, implemented: true })),
    ...(snapshot.permissions ? { permissions: snapshot.permissions } : {}),
    ...(snapshot.toolHealth ? { toolHealth: snapshot.toolHealth } : {}),
    lastCapabilityRefreshAt: snapshot.lastCapabilityRefreshAt ?? snapshot.lastSeenAt,
  }
}

function matrixEntryToMethodCapability(
  name: string,
  entry: YeonjangCapabilityMatrixEntry,
): YeonjangMethodCapability {
  return {
    name,
    implemented: entry.supported !== false,
    ...(typeof entry.supported === "boolean" ? { supported: entry.supported } : {}),
    ...(typeof entry.requiresApproval === "boolean" ? { requiresApproval: entry.requiresApproval } : {}),
    ...(typeof entry.requiresPermission === "boolean" ? { requiresPermission: entry.requiresPermission } : {}),
    ...(entry.permissionSetting !== undefined ? { permissionSetting: entry.permissionSetting } : {}),
    ...(entry.knownLimitations ? { knownLimitations: entry.knownLimitations } : {}),
    ...(entry.outputModes ? { outputModes: entry.outputModes } : {}),
    ...(typeof entry.lastCheckedAt === "number" ? { lastCheckedAt: entry.lastCheckedAt } : {}),
  }
}

function normalizeExtensionId(extensionId?: string): string {
  return extensionId?.trim() || DEFAULT_YEONJANG_EXTENSION_ID
}

function rememberCapabilities(extensionId: string, payload: YeonjangCapabilitiesPayload): void {
  capabilityCache.set(extensionId, { payload, cachedAt: Date.now() })
}

function getFreshCachedCapabilities(extensionId: string): YeonjangCapabilitiesPayload | null {
  const cached = capabilityCache.get(extensionId)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > YEONJANG_CAPABILITY_TTL_MS) return null
  return cached.payload
}

function getFreshCapabilitySnapshot(extensionId: string): MqttExtensionSnapshot | null {
  const now = Date.now()
  const snapshot = getMqttExtensionSnapshots().find((candidate) => candidate.extensionId === extensionId)
  if (!snapshot) return null
  if (String(snapshot.state ?? "").toLowerCase() === "offline") return null
  if (!snapshot.capabilityMatrix && snapshot.methods.length === 0) return null
  const refreshedAt = snapshot.lastCapabilityRefreshAt ?? snapshot.lastSeenAt
  if (now - refreshedAt > YEONJANG_CAPABILITY_TTL_MS) return null
  return snapshot
}

export function isYeonjangUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return [
    "mqtt 브로커가 비활성화되어 있습니다",
    "mqtt 브로커가 실행 중이 아닙니다",
    "yeonjang mqtt 연결 시간이 초과되었습니다",
    "yeonjang mqtt 응답 시간이 초과되었습니다",
    "yeonjang mqtt 연결이 닫혔습니다",
    "yeonjang mqtt 응답 대기 중 연결이 닫혔습니다",
    "connection refused",
    "connack timeout",
    "econnrefused",
    "getaddrinfo",
    "not authorized",
    "authentication",
  ].some((pattern) => normalized.includes(pattern))
}

function createClient(): MqttClient {
  const config = getConfig().mqtt
  const snapshot = getMqttBrokerSnapshot()
  const validationError = validateMqttBrokerConfig(config)
  if (!config.enabled) {
    throw new Error("MQTT 브로커가 비활성화되어 있습니다.")
  }
  if (validationError) {
    throw new Error(validationError)
  }
  if (!snapshot.running) {
    throw new Error(snapshot.reason ?? "MQTT 브로커가 실행 중이 아닙니다.")
  }

  const host = normalizeConnectHost(config.host)
  return mqtt.connect(`mqtt://${host}:${config.port}`, {
    clientId: `nobie-core-${process.pid}-${randomUUID().slice(0, 8)}`,
    username: config.username,
    password: config.password,
    connectTimeout: 5_000,
    reconnectPeriod: 0,
    clean: true,
  })
}

function normalizeConnectHost(host: string): string {
  const trimmed = host.trim()
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") {
    return "127.0.0.1"
  }
  return trimmed
}

function clampTimeout(timeoutMs?: number): number {
  const candidate = Number(timeoutMs)
  if (!Number.isFinite(candidate)) return 15_000
  return Math.max(1_000, Math.min(60_000, Math.floor(candidate)))
}

async function waitForConnect(client: MqttClient, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Yeonjang MQTT 연결 시간이 초과되었습니다."))
    }, timeoutMs)

    const onConnect = () => {
      cleanup()
      resolve()
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onClose = () => {
      if (settled) return
      cleanup()
      reject(new Error("Yeonjang MQTT 연결이 닫혔습니다."))
    }

    const cleanup = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.off("connect", onConnect)
      client.off("error", onError)
      client.off("close", onClose)
    }

    client.once("connect", onConnect)
    client.once("error", onError)
    client.once("close", onClose)
  })
}

async function subscribe(client: MqttClient, topic: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function publish(client: MqttClient, topic: string, request: YeonjangRequestEnvelope): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.publish(topic, JSON.stringify(request), { qos: 1 }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function waitForResponse<T>(
  client: MqttClient,
  responseTopic: string,
  requestId: string,
  timeoutMs: number,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const chunkParts = new Map<number, string>()

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Yeonjang MQTT 응답 시간이 초과되었습니다."))
    }, timeoutMs)

    const onMessage = (topic: string, payload: Buffer) => {
      if (topic !== responseTopic) return

      let parsed: unknown
      try {
        parsed = JSON.parse(payload.toString("utf8")) as unknown
      } catch (error) {
        cleanup()
        reject(new Error(`Yeonjang 응답 JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`))
        return
      }

      if (isChunkEnvelope(parsed)) {
        if (parsed.id && parsed.id !== requestId) return
        if (typeof parsed.chunk_index !== "number" || typeof parsed.chunk_count !== "number" || !parsed.base64_data) {
          cleanup()
          reject(new Error("Yeonjang 청크 응답 형식이 올바르지 않습니다."))
          return
        }

        chunkParts.set(parsed.chunk_index, parsed.base64_data)
        if (chunkParts.size < parsed.chunk_count) return

        const orderedParts: string[] = []
        for (let index = 0; index < parsed.chunk_count; index += 1) {
          const part = chunkParts.get(index)
          if (!part) {
            cleanup()
            reject(new Error(`Yeonjang 청크 응답이 누락되었습니다. (${index + 1}/${parsed.chunk_count})`))
            return
          }
          orderedParts.push(part)
        }

        let response: YeonjangResponseEnvelope<T>
        try {
          const bytes = Buffer.concat(orderedParts.map((part) => Buffer.from(part, "base64")))
          response = JSON.parse(bytes.toString("utf8")) as YeonjangResponseEnvelope<T>
        } catch (error) {
          cleanup()
          reject(new Error(`Yeonjang 청크 응답 복원 실패: ${error instanceof Error ? error.message : String(error)}`))
          return
        }

        if (response.id && response.id !== requestId) return
        cleanup()
        if (!response.ok) {
          reject(new Error(response.error?.message ?? "Yeonjang 요청이 실패했습니다."))
          return
        }
        resolve((response.result ?? null) as T)
        return
      }

      const response = parsed as YeonjangResponseEnvelope<T>
      if (response.id && response.id !== requestId) return

      cleanup()
      if (!response.ok) {
        reject(new Error(response.error?.message ?? "Yeonjang 요청이 실패했습니다."))
        return
      }
      resolve((response.result ?? null) as T)
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onClose = () => {
      cleanup()
      reject(new Error("Yeonjang MQTT 응답 대기 중 연결이 닫혔습니다."))
    }

    const cleanup = () => {
      clearTimeout(timer)
      client.off("message", onMessage)
      client.off("error", onError)
      client.off("close", onClose)
      chunkParts.clear()
    }

    client.on("message", onMessage)
    client.once("error", onError)
    client.once("close", onClose)
  })
}

function isChunkEnvelope(value: unknown): value is YeonjangChunkEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { transport?: unknown }).transport === "chunk",
  )
}

async function closeClient(client: MqttClient): Promise<void> {
  await new Promise<void>((resolve) => {
    client.end(true, {}, () => resolve())
  })
}
