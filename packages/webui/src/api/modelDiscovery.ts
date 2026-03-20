import { api } from "./client"
import type { AIBackendCredentials, AIProviderType } from "../contracts/ai"

export interface ModelDiscoveryResult {
  models: string[]
  sourceUrl: string
}

function formatBackendDiscoveryError(message: string, providerType: AIProviderType): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("incorrect api key") ||
    normalized.includes("forbidden") ||
    normalized.includes("api key")
  ) {
    return `인증 정보가 맞지 않습니다. ${providerType} 연결에 필요한 API Key를 다시 확인해 주세요.`
  }

  if (
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("connect")
  ) {
    return "연결 주소에 접속할 수 없습니다. 엔드포인트와 네트워크 상태를 다시 확인해 주세요."
  }

  if (normalized.includes("model") || normalized.includes("models")) {
    return "연결은 되었지만 사용할 수 있는 모델 정보를 읽지 못했습니다. 서버 상태와 모델 목록을 확인해 주세요."
  }

  return "연결 확인에 실패했습니다. 주소, 인증 정보, 서버 상태를 다시 확인해 주세요."
}

export async function discoverModelsFromEndpoint(
  endpoint: string,
  providerType: AIProviderType,
  credentials: AIBackendCredentials,
): Promise<ModelDiscoveryResult> {
  try {
    const result = await api.testBackend(endpoint, providerType, credentials)
    if (!result.ok || !result.models || !result.sourceUrl) {
      throw new Error(formatBackendDiscoveryError(result.error ?? "모델 목록을 가져오지 못했습니다.", providerType))
    }
    return {
      models: result.models,
      sourceUrl: result.sourceUrl,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(formatBackendDiscoveryError(message, providerType))
  }
}
