import { createHash } from "node:crypto"
import type { AIConnectionConfig, MemoryConfig } from "../config/types.js"
import {
  resolveAIConnection,
  type ProviderAdapterType,
  type ProviderAuditTrace,
  type ProviderBaseUrlClass,
  type ProviderCredentialKind,
  type ResolvedAiConnection,
} from "./index.js"

export type ProviderCapabilityStatus = "supported" | "unsupported" | "warning" | "unknown"

export interface ProviderCapabilityItem {
  status: ProviderCapabilityStatus
  detail: string
}

export interface ProviderCapabilityMatrix {
  profileId: string
  providerId: string
  adapterType: ProviderAdapterType
  authType: ProviderCredentialKind
  baseUrlClass: ProviderBaseUrlClass
  endpoint: string
  modelId: string
  chatCompletions: ProviderCapabilityItem
  responsesApi: ProviderCapabilityItem
  streaming: ProviderCapabilityItem
  toolCalling: ProviderCapabilityItem
  jsonSchemaOutput: ProviderCapabilityItem
  embeddings: ProviderCapabilityItem
  modelListing: ProviderCapabilityItem
  imageInput: ProviderCapabilityItem
  imageOutput: ProviderCapabilityItem
  contextWindow: ProviderCapabilityItem & { tokens: number | null }
  authRefresh: ProviderCapabilityItem
  endpointMismatch: ProviderCapabilityItem
  createdAt: string
  expiresAt: string
  lastCheckResult: {
    status: "ok" | "warning" | "failed" | "not_checked"
    checkedAt: string | null
    message: string
    sourceUrl: string | null
  }
}

export interface EmbeddingProviderResolutionSnapshot {
  providerId: string
  modelId: string
  configured: boolean
  credentialKind: "api_key" | "local_endpoint" | "none"
  baseUrlClass: ProviderBaseUrlClass
  degradedReason: string | null
}

const CAPABILITY_CACHE_TTL_MS = 10 * 60 * 1000
const capabilityCache = new Map<string, ProviderCapabilityMatrix>()

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function capability(status: ProviderCapabilityStatus, detail: string): ProviderCapabilityItem {
  return { status, detail }
}

function classifyEndpoint(endpoint: string | undefined): ProviderBaseUrlClass {
  const normalized = endpoint?.trim()
  if (!normalized) return "none"
  try {
    const host = new URL(normalized).hostname.toLowerCase()
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt_codex"
    if (host === "api.openai.com" || host.endsWith(".openai.com")) return "official_openai"
    if (
      host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || host.startsWith("192.168.")
      || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return "local"
    return "custom"
  } catch {
    return "custom"
  }
}

export function buildProviderProfileId(input: {
  connection: AIConnectionConfig
  embedding?: MemoryConfig["embedding"] | undefined
}): string {
  const connection = input.connection
  const authMode = connection.auth?.mode ?? "api_key"
  const credentialKind = connection.auth?.apiKey?.trim()
    ? "api_key"
    : connection.auth?.oauthAuthFilePath?.trim()
      ? "chatgpt_oauth"
      : connection.provider === "ollama" || connection.provider === "llama"
        ? "local_endpoint"
        : "none"
  return hashStable({
    provider: connection.provider,
    model: connection.model,
    endpoint: connection.endpoint?.trim() ?? "",
    authMode,
    credentialKind,
    oauthAuthFilePathConfigured: Boolean(connection.auth?.oauthAuthFilePath?.trim()),
    usernameConfigured: Boolean(connection.auth?.username?.trim()),
    passwordConfigured: Boolean(connection.auth?.password?.trim()),
    embeddingProvider: input.embedding?.provider ?? "",
    embeddingModel: input.embedding?.model ?? "",
    embeddingBaseUrl: input.embedding?.baseUrl ?? "",
  }).slice(0, 16)
}

export function resolveEmbeddingProviderResolutionSnapshot(memory: MemoryConfig): EmbeddingProviderResolutionSnapshot {
  const embedding = memory.embedding
  if (!embedding?.provider || !embedding.model?.trim()) {
    return {
      providerId: "none",
      modelId: "",
      configured: false,
      credentialKind: "none",
      baseUrlClass: "none",
      degradedReason: "embedding_provider_missing",
    }
  }
  if (embedding.provider === "ollama") {
    return {
      providerId: "ollama",
      modelId: embedding.model,
      configured: true,
      credentialKind: "local_endpoint",
      baseUrlClass: classifyEndpoint(embedding.baseUrl ?? "http://localhost:11434"),
      degradedReason: null,
    }
  }
  if (!embedding.apiKey?.trim()) {
    return {
      providerId: embedding.provider,
      modelId: embedding.model,
      configured: false,
      credentialKind: "none",
      baseUrlClass: classifyEndpoint(embedding.baseUrl),
      degradedReason: "embedding_api_key_missing",
    }
  }
  return {
    providerId: embedding.provider,
    modelId: embedding.model,
    configured: true,
    credentialKind: "api_key",
    baseUrlClass: classifyEndpoint(embedding.baseUrl),
    degradedReason: null,
  }
}

function resolveContextWindow(resolution: ResolvedAiConnection): number | null {
  const model = resolution.model.toLowerCase()
  if (!model) return null
  if (model.includes("gpt-5")) return 400_000
  if (model.includes("gpt-4.1")) return 1_000_000
  if (model.includes("gpt-4o")) return 128_000
  if (model.includes("gemini-2.5")) return 1_000_000
  if (model.includes("claude")) return 200_000
  if (resolution.providerId === "ollama" || resolution.providerId === "llama") return null
  return 128_000
}

function detectEndpointMismatch(resolution: ResolvedAiConnection): ProviderCapabilityItem {
  if (!resolution.providerId) return capability("unknown", "provider가 설정되지 않았습니다.")
  if (resolution.providerId === "openai" && resolution.authMode === "chatgpt_oauth" && resolution.baseUrlClass !== "chatgpt_codex") {
    return capability("warning", "ChatGPT OAuth는 chatgpt.com Codex endpoint를 사용해야 합니다.")
  }
  if (resolution.providerId === "openai" && resolution.authMode === "api_key" && resolution.baseUrlClass === "chatgpt_codex") {
    return capability("warning", "OpenAI API key 경로가 ChatGPT OAuth endpoint를 가리키고 있습니다.")
  }
  if ((resolution.providerId === "ollama" || resolution.providerId === "llama") && resolution.baseUrlClass !== "local") {
    return capability("warning", "로컬 provider로 설정됐지만 endpoint가 로컬 주소가 아닙니다.")
  }
  return capability("supported", "provider와 endpoint 종류가 일치합니다.")
}

function buildStaticMatrix(params: {
  connection: AIConnectionConfig
  memory?: MemoryConfig | undefined
  checkedAt?: Date | undefined
  checkResult?: ProviderCapabilityMatrix["lastCheckResult"] | undefined
}): ProviderCapabilityMatrix {
  const resolution = resolveAIConnection(params.connection)
  const now = params.checkedAt ?? new Date()
  const expiresAt = new Date(now.getTime() + CAPABILITY_CACHE_TTL_MS)
  const profileId = buildProviderProfileId({
    connection: params.connection,
    embedding: params.memory?.embedding,
  })
  const embedding = params.memory ? resolveEmbeddingProviderResolutionSnapshot(params.memory) : null
  const supportsOpenAICompatibleChat = resolution.adapterType === "openai_chat" || resolution.adapterType === "openai_compatible"
  const supportsChat = supportsOpenAICompatibleChat || resolution.adapterType === "anthropic" || resolution.adapterType === "gemini"
  const supportsResponses = resolution.adapterType === "openai_codex_oauth"
  const contextWindow = resolveContextWindow(resolution)
  const modelListingStatus: ProviderCapabilityItem =
    resolution.adapterType === "openai_codex_oauth"
      ? capability("warning", "Codex OAuth는 공식 모델 목록 API 대신 알려진 Codex 모델 목록을 사용합니다.")
      : resolution.providerId === "custom"
        ? capability("warning", "OpenAI-compatible endpoint는 모델 목록 API가 없을 수 있습니다.")
        : capability("supported", "provider 모델 목록 조회 경로가 정의되어 있습니다.")

  return {
    profileId,
    providerId: resolution.providerId,
    adapterType: resolution.adapterType,
    authType: resolution.authType,
    baseUrlClass: resolution.baseUrlClass,
    endpoint: resolution.endpoint,
    modelId: resolution.model,
    chatCompletions: supportsOpenAICompatibleChat || resolution.adapterType === "anthropic" || resolution.adapterType === "gemini"
      ? capability("supported", "일반 chat 실행 경로가 지원됩니다.")
      : capability("unsupported", "이 provider는 chat completions 경로를 사용하지 않습니다."),
    responsesApi: supportsResponses
      ? capability("supported", "ChatGPT Codex OAuth responses 경로가 지원됩니다.")
      : resolution.adapterType === "openai_chat"
        ? capability("supported", "OpenAI Responses API 호환 경로로 확장 가능합니다.")
        : capability("unsupported", "Responses API 전용 경로가 정의되지 않았습니다."),
    streaming: supportsChat || supportsResponses
      ? capability("supported", "streaming 응답 처리가 가능합니다.")
      : capability("unsupported", "streaming 경로가 없습니다."),
    toolCalling: supportsChat || supportsResponses
      ? capability("supported", "도구 호출 요청을 전달할 수 있습니다.")
      : capability("unsupported", "도구 호출 경로가 없습니다."),
    jsonSchemaOutput: supportsChat || supportsResponses
      ? capability("supported", "구조화 출력 요청을 전달할 수 있습니다.")
      : capability("unknown", "구조화 출력 지원 여부를 확인할 수 없습니다."),
    embeddings: embedding?.configured
      ? capability("supported", `${embedding.providerId}/${embedding.modelId} embedding provider가 별도로 설정되어 있습니다.`)
      : capability("warning", "chat provider와 별개로 embedding provider가 설정되지 않았습니다."),
    modelListing: modelListingStatus,
    imageInput: resolution.providerId === "openai" || resolution.providerId === "gemini"
      ? capability("supported", "멀티모달 입력 가능성이 있는 provider입니다.")
      : capability("unknown", "이미지 입력 지원 여부는 모델별로 확인해야 합니다."),
    imageOutput: resolution.providerId === "openai" || resolution.providerId === "gemini"
      ? capability("warning", "이미지 출력은 별도 모델/endpoint가 필요할 수 있습니다.")
      : capability("unsupported", "이미지 출력 경로가 정의되지 않았습니다."),
    contextWindow: {
      ...(contextWindow
        ? capability("supported", `${contextWindow.toLocaleString("en-US")} token 수준의 기본 추정값입니다.`)
        : capability("unknown", "로컬/사용자 정의 모델은 context window를 자동 확정하지 않습니다.")),
      tokens: contextWindow,
    },
    authRefresh: resolution.authType === "chatgpt_oauth"
      ? capability("supported", "ChatGPT OAuth token refresh 경로가 분리되어 있습니다.")
      : resolution.authType === "api_key"
        ? capability("unsupported", "API key 인증은 refresh 개념이 없습니다.")
        : capability("unknown", "인증 refresh 경로가 없습니다."),
    endpointMismatch: detectEndpointMismatch(resolution),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastCheckResult: params.checkResult ?? {
      status: "not_checked",
      checkedAt: null,
      message: "runtime 계산값이며 아직 네트워크 확인은 수행하지 않았습니다.",
      sourceUrl: null,
    },
  }
}

export function getProviderCapabilityMatrix(params: {
  connection: AIConnectionConfig
  memory?: MemoryConfig | undefined
  now?: Date | undefined
  forceRefresh?: boolean | undefined
  checkResult?: ProviderCapabilityMatrix["lastCheckResult"] | undefined
}): ProviderCapabilityMatrix {
  const profileId = buildProviderProfileId({
    connection: params.connection,
    embedding: params.memory?.embedding,
  })
  const cached = capabilityCache.get(profileId)
  const now = params.now ?? new Date()
  if (!params.forceRefresh && !params.checkResult && cached && Date.parse(cached.expiresAt) > now.getTime()) return cached
  const matrix = buildStaticMatrix({
    connection: params.connection,
    memory: params.memory,
    checkedAt: now,
    ...(params.checkResult ? { checkResult: params.checkResult } : {}),
  })
  capabilityCache.set(profileId, matrix)
  return matrix
}

export function clearProviderCapabilityCache(): void {
  capabilityCache.clear()
}

export function attachCapabilityProfileToTrace(
  trace: ProviderAuditTrace,
  matrix: ProviderCapabilityMatrix,
): ProviderAuditTrace {
  return {
    ...trace,
    profileId: matrix.profileId,
    resolverPath: `ai.connection.${trace.providerId || "unconfigured"}`,
    credentialSourceKind: trace.authType,
    endpointMismatch: matrix.endpointMismatch.status !== "supported",
  }
}
