import { useState } from "react"
import { discoverModelsFromEndpoint } from "../../api/modelDiscovery"
import {
  AI_PROVIDER_OPTIONS,
  getAIProviderDefaultEndpoint,
  getAIProviderEndpointPlaceholder,
  getAIProviderCredentialFields,
  hasRequiredProviderCredentials,
  isBuiltinBackendId,
  isLocalProviderType,
  type AIBackendCard,
  type AIBackendCredentialKey,
  type AIAuthMode,
  type RoutingProfile,
  type AIProviderType,
  type ProviderCapabilityItem,
} from "../../contracts/ai"
import { getAIProviderDisplayLabel, getBackendDisplayLabel, getRoutingProfileDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"
import type { BackendCardErrors } from "../../lib/setupFlow"
import { CapabilityBadge } from "../CapabilityBadge"

function getKindLabel(text: (ko: string, en: string) => string): string {
  return text("직접 연결 (Provider)", "Direct Provider")
}

function getOpenAIAuthModeLabel(mode: AIAuthMode, text: (ko: string, en: string) => string): string {
  return mode === "chatgpt_oauth"
    ? text("ChatGPT OAuth", "ChatGPT OAuth")
    : text("API Key", "API Key")
}

function capabilityTone(status: ProviderCapabilityItem["status"]): string {
  switch (status) {
    case "supported":
      return "border-emerald-200 bg-emerald-50 text-emerald-800"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800"
    case "unsupported":
      return "border-stone-200 bg-stone-50 text-stone-500"
    case "unknown":
      return "border-sky-200 bg-sky-50 text-sky-800"
  }
}

function capabilityStatusLabel(status: ProviderCapabilityItem["status"], text: (ko: string, en: string) => string): string {
  switch (status) {
    case "supported":
      return text("지원", "Supported")
    case "warning":
      return text("주의", "Warning")
    case "unsupported":
      return text("미지원", "Unsupported")
    case "unknown":
      return text("확인 필요", "Unknown")
  }
}

export function BackendHealthCard({
  backend,
  routingProfiles,
  onToggle,
  onChange,
  onRemove,
  onSetRoutingTargetEnabled,
  onSelectBuiltinProviderType,
  errors,
  showRoutingTags = true,
}: {
  backend: AIBackendCard
  routingProfiles: RoutingProfile[]
  onToggle: (id: string, enabled: boolean) => void
  onChange: (id: string, patch: Partial<AIBackendCard>) => void
  onRemove?: (id: string) => void
  onSetRoutingTargetEnabled: (profileId: RoutingProfile["id"], backendId: string, enabled: boolean) => void
  onSelectBuiltinProviderType?: (providerType: AIProviderType) => void
  errors?: BackendCardErrors
  showRoutingTags?: boolean
}) {
  const [loadingModels, setLoadingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [discoveryError, setDiscoveryError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const { text, displayText, language } = useUiI18n()

  function clearDiscoveryState() {
    setDiscoveryError("")
    setSuccessMessage("")
    setSourceUrl("")
  }

  async function runDiscovery(mode: "test" | "models") {
    if (!backend.endpoint?.trim()) return
    if (mode === "test") {
      setTestingConnection(true)
    } else {
      setLoadingModels(true)
    }
    clearDiscoveryState()

    try {
      const result = await discoverModelsFromEndpoint(backend.endpoint ?? "", backend.providerType, backend.credentials, backend.authMode ?? "api_key")
      onChange(backend.id, {
        availableModels: result.models,
        defaultModel: result.models.includes(backend.defaultModel) ? backend.defaultModel : result.models[0] ?? "",
        status: "ready",
        reason: undefined,
        ...(result.capabilityMatrix ? { capabilityMatrix: result.capabilityMatrix } : {}),
      })
      setSourceUrl(result.sourceUrl)
      setSuccessMessage(
        result.models.length > 0
          ? text(
              `연결이 확인되었습니다. 사용 가능한 모델 ${result.models.length}개를 읽었습니다.`,
              `Connection confirmed. Found ${result.models.length} available models.`,
            )
          : text("연결은 확인되었지만 모델 목록은 비어 있습니다.", "Connection confirmed, but the model list is empty."),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onChange(backend.id, {
        availableModels: [],
        defaultModel: "",
        status: "error",
        reason: message,
      })
      setDiscoveryError(message)
    } finally {
      setLoadingModels(false)
      setTestingConnection(false)
    }
  }

  const selectValue =
    backend.availableModels.includes(backend.defaultModel) || !backend.defaultModel
      ? backend.defaultModel
      : "__current__"

  function handleProviderTypeChange(providerType: AIProviderType) {
    if (isBuiltinBackend && onSelectBuiltinProviderType) {
      onSelectBuiltinProviderType(providerType)
      clearDiscoveryState()
      return
    }
    onChange(backend.id, {
      providerType,
      authMode: providerType === "openai" ? (backend.authMode ?? "api_key") : "api_key",
      credentials: {},
      local: isLocalProviderType(providerType),
      endpoint: getAIProviderDefaultEndpoint(providerType),
      availableModels: [],
      defaultModel: "",
      enabled: false,
      status: "disabled",
      reason: undefined,
    })
    clearDiscoveryState()
  }

  function handleAuthModeChange(authMode: AIAuthMode) {
    onChange(backend.id, {
      authMode,
      credentials: {
        ...backend.credentials,
        ...(authMode === "chatgpt_oauth" ? { apiKey: "" } : {}),
      },
      endpoint: authMode === "chatgpt_oauth" ? "https://chatgpt.com/backend-api/codex" : "https://api.openai.com/v1",
      availableModels: [],
      defaultModel: "",
      status: "disabled",
      reason: undefined,
    })
    clearDiscoveryState()
  }

  function patchCredential(key: AIBackendCredentialKey, value: string) {
    onChange(backend.id, {
      credentials: {
        ...backend.credentials,
        [key]: value,
      },
      status: "disabled",
      reason: undefined,
    })
  }

  const credentialFields = getAIProviderCredentialFields(backend.providerType, backend.authMode ?? "api_key")
  const isOpenAIOAuthMode = backend.providerType === "openai" && (backend.authMode ?? "api_key") === "chatgpt_oauth"
  const isBuiltinBackend = isBuiltinBackendId(backend.id)
  const capabilityMatrix = backend.capabilityMatrix
  const canLoadModels =
    Boolean(backend.endpoint?.trim()) && hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode ?? "api_key")

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{getBackendDisplayLabel(backend.id, backend.label, language)}</div>
          <div className="mt-1 text-xs tracking-wide text-stone-500">{getKindLabel(text)}</div>
        </div>
        <CapabilityBadge status={backend.status} />
      </div>

      {backend.summary.trim() ? <p className="text-sm leading-6 text-stone-600">{backend.summary}</p> : null}

      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("AI 종류 (Provider Type)", "AI Type (Provider Type)")}</label>
          <select
            className="input"
            value={backend.providerType}
            onChange={(event) => handleProviderTypeChange(event.target.value as AIProviderType)}
          >
            {AI_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {getAIProviderDisplayLabel(option.value, language)}
              </option>
            ))}
          </select>
          {isBuiltinBackend ? (
            <p className="mt-2 text-xs leading-5 text-stone-500">
              {text(
                "기본 제공 연결은 여기서 바로 전환됩니다. 내부 역할 구분은 화면에 따로 표시하지 않습니다.",
                "Built-in connections switch directly here. Internal role distinctions are not shown in the UI.",
              )}
            </p>
          ) : null}
        </div>

        {backend.providerType === "openai" ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">{text("인증 방식", "Authentication Method")}</label>
            <select
              className="input"
              value={backend.authMode ?? "api_key"}
              onChange={(event) => handleAuthModeChange(event.target.value as AIAuthMode)}
            >
              <option value="api_key">{getOpenAIAuthModeLabel("api_key", text)}</option>
              <option value="chatgpt_oauth">{getOpenAIAuthModeLabel("chatgpt_oauth", text)}</option>
            </select>
          </div>
        ) : null}

        {credentialFields.length > 0 ? (
          <div>
            <div className="mb-2 text-sm font-medium text-stone-700">{text("인증 정보 (Credentials)", "Credentials")}</div>
            <div className="grid gap-4 md:grid-cols-2">
              {credentialFields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-sm font-medium text-stone-700">
                    {field.label}
                    {field.required ? <span className="ml-1 text-red-500">*</span> : null}
                  </label>
                  <input
                    type={field.inputType}
                    className="input"
                    value={backend.credentials[field.key] ?? ""}
                    onChange={(event) => patchCredential(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
            {errors?.credentials ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.credentials}</p> : null}
          </div>
        ) : null}

        {isOpenAIOAuthMode ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-6 text-sky-900">
            <div className="font-semibold">{text("ChatGPT OAuth 사용 안내", "How ChatGPT OAuth works")}</div>
            <div className="mt-2">
              {text(
                "이 방식은 ChatGPT OAuth 인증 파일을 읽어 `https://chatgpt.com/backend-api/codex`에 연결합니다. OpenAI API Key 대신 OAuth 인증을 사용하며, 연결 확인과 모델 조회는 OpenAI 호환 probe로 처리됩니다.",
                "This mode reads the ChatGPT OAuth auth file and connects to `https://chatgpt.com/backend-api/codex`. It uses OAuth authentication instead of the OpenAI API key path, and connection checks and model loading are handled through an OpenAI-compatible probe.",
              )}
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("연결 주소 (Endpoint) *", "Endpoint *")}</label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <input
              className="input font-mono"
              value={backend.endpoint ?? ""}
              onChange={(event) =>
                onChange(backend.id, {
                  endpoint: event.target.value,
                  availableModels: [],
                  defaultModel: "",
                  status: "disabled",
                  reason: undefined,
                })}
              placeholder={
                isOpenAIOAuthMode
                  ? "https://chatgpt.com/backend-api/codex"
                  : getAIProviderEndpointPlaceholder(backend.providerType)
              }
            />
            <button
              onClick={() => void runDiscovery("test")}
              disabled={!canLoadModels || loadingModels || testingConnection}
              className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testingConnection ? text("확인 중...", "Checking...") : text("연결 확인", "Check Connection")}
            </button>
            <button
              onClick={() => void runDiscovery("models")}
              disabled={!canLoadModels || loadingModels || testingConnection}
              className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingModels ? text("조회 중...", "Loading...") : text("모델 조회", "Load Models")}
            </button>
          </div>
          {errors?.endpoint ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.endpoint}</p> : null}
          {successMessage ? <p className="mt-2 text-xs leading-5 text-emerald-700">{successMessage}</p> : null}
          {sourceUrl ? <p className="mt-1 text-xs text-emerald-700">{text("조회 경로", "Source URL")}: {sourceUrl}</p> : null}
          {discoveryError ? <p className="mt-2 text-xs leading-5 text-red-600">{displayText(discoveryError)}</p> : null}
          {!hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode ?? "api_key") ? (
            <p className="mt-2 text-xs text-amber-700">{text("필수 인증 정보를 입력해야 연결 확인과 모델 조회를 진행할 수 있습니다.", "Enter the required credentials before checking the connection and loading models.")}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("기본 모델 (Default Model) *", "Default Model *")}</label>
          <select
            className="input font-mono"
            value={selectValue}
            onChange={(event) => {
              if (event.target.value === "__current__") return
              onChange(backend.id, { defaultModel: event.target.value })
            }}
            disabled={backend.availableModels.length === 0}
          >
            {backend.availableModels.length === 0 && backend.defaultModel ? (
              <option value="__current__">{backend.defaultModel} {text("(현재 설정값)", "(current setting)")}</option>
            ) : null}
            {backend.availableModels.length === 0 && !backend.defaultModel ? (
              <option value="">{text("연결 확인 뒤 모델을 먼저 조회해 주세요", "Check the connection and load models first")}</option>
            ) : null}
            {backend.availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {errors?.defaultModel ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.defaultModel}</p> : null}
        </div>

        {showRoutingTags ? (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="text-sm font-semibold text-stone-900">{text("AI 라우팅 태그", "AI Routing Tags")}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {routingProfiles.map((profile) => {
                const active = profile.targets.includes(backend.id)
                return (
                  <button
                    key={`${backend.id}-${profile.id}`}
                    onClick={() => onSetRoutingTargetEnabled(profile.id, backend.id, !active)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 bg-white text-stone-700"
                    }`}
                  >
                    {getRoutingProfileDisplayLabel(profile.id, profile.label, language)}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {capabilityMatrix ? (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-stone-900">{text("Provider 기능", "Provider capabilities")}</div>
                <div className="mt-1 font-mono text-[11px] text-stone-500">profile {capabilityMatrix.profileId} · {capabilityMatrix.adapterType} · {capabilityMatrix.authType}</div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${capabilityTone(capabilityMatrix.endpointMismatch.status)}`}>
                {capabilityMatrix.endpointMismatch.status === "supported" ? text("endpoint 일치", "endpoint ok") : text("endpoint 확인", "check endpoint")}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {[
                [text("Chat", "Chat"), capabilityMatrix.chatCompletions],
                [text("Responses", "Responses"), capabilityMatrix.responsesApi],
                [text("도구 호출", "Tool calling"), capabilityMatrix.toolCalling],
                [text("JSON 출력", "JSON output"), capabilityMatrix.jsonSchemaOutput],
                [text("모델 목록", "Model listing"), capabilityMatrix.modelListing],
                [text("Embedding", "Embedding"), capabilityMatrix.embeddings],
                [text("Auth refresh", "Auth refresh"), capabilityMatrix.authRefresh],
                [text("Context", "Context"), capabilityMatrix.contextWindow],
              ].map(([label, item]) => {
                const capability = item as ProviderCapabilityItem
                return (
                  <div key={String(label)} className={`rounded-lg border px-3 py-2 ${capabilityTone(capability.status)}`}>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span>{String(label)}</span>
                      <span>{capabilityStatusLabel(capability.status, text)}</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-5 opacity-90">{displayText(capability.detail)}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 text-[11px] leading-5 text-stone-500">
              {text("마지막 확인", "Last check")}: {capabilityMatrix.lastCheckResult.status} · {displayText(capabilityMatrix.lastCheckResult.message)}
            </div>
          </div>
        ) : null}
      </div>

      {backend.reason ? <div className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600">{displayText(backend.reason)}</div> : null}
      {errors?.enabled ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{errors.enabled}</div> : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-stone-500">{backend.enabled ? text("활성화됨", "Enabled") : text("비활성화됨", "Disabled")}</span>
        <div className="flex items-center gap-2">
          {onRemove && !isBuiltinBackend ? (
            <button
              onClick={() => onRemove(backend.id)}
              className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              {text("삭제", "Delete")}
            </button>
          ) : null}
          <button
            onClick={() => onToggle(backend.id, !backend.enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${backend.enabled ? "bg-stone-900" : "bg-stone-300"}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${backend.enabled ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
