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
} from "../../contracts/ai"
import { getAIProviderDisplayLabel, getBackendDisplayLabel, getRoutingProfileDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"
import type { BackendCardErrors } from "../../lib/setupFlow"
import { CapabilityBadge } from "../CapabilityBadge"

function getKindLabel(kind: AIBackendCard["kind"], text: (ko: string, en: string) => string): string {
  return kind === "worker"
    ? text("작업 워커 (Worker)", "Task Worker")
    : text("직접 연결 (Provider)", "Direct Provider")
}

function getOpenAIAuthModeLabel(mode: AIAuthMode, text: (ko: string, en: string) => string): string {
  return mode === "chatgpt_oauth"
    ? text("ChatGPT OAuth (Codex)", "ChatGPT OAuth (Codex)")
    : text("API Key", "API Key")
}

export function BackendHealthCard({
  backend,
  routingProfiles,
  onToggle,
  onChange,
  onRemove,
  onSetRoutingTargetEnabled,
  onSyncBuiltinBackends,
  errors,
}: {
  backend: AIBackendCard
  routingProfiles: RoutingProfile[]
  onToggle: (id: string, enabled: boolean) => void
  onChange: (id: string, patch: Partial<AIBackendCard>) => void
  onRemove?: (id: string) => void
  onSetRoutingTargetEnabled: (profileId: RoutingProfile["id"], backendId: string, enabled: boolean) => void
  onSyncBuiltinBackends: () => void
  errors?: BackendCardErrors
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
    })
  }

  const credentialFields = getAIProviderCredentialFields(backend.providerType, backend.authMode ?? "api_key")
  const isOpenAIOAuthMode = backend.providerType === "openai" && (backend.authMode ?? "api_key") === "chatgpt_oauth"
  const canLoadModels =
    Boolean(backend.endpoint?.trim()) && hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode ?? "api_key")
  const isPrimaryBuiltin = backend.id === "provider:openai"
  const isBuiltinBackend = isBuiltinBackendId(backend.id)

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{getBackendDisplayLabel(backend.id, backend.label, language)}</div>
          <div className="mt-1 text-xs tracking-wide text-stone-500">{getKindLabel(backend.kind, text)}</div>
        </div>
        <CapabilityBadge status={backend.status} />
      </div>

      {backend.summary.trim() ? <p className="text-sm leading-6 text-stone-600">{backend.summary}</p> : null}

      <div className="mt-4 space-y-4">
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
            <div className="font-semibold">{text("ChatGPT OAuth (Codex) 사용 안내", "How ChatGPT OAuth (Codex) works")}</div>
            <div className="mt-2">
              {text(
                "이 방식은 `codex login`으로 생성된 `~/.codex/auth.json` 토큰을 읽어 `https://chatgpt.com/backend-api/codex`에 연결합니다. OpenAI API Key가 아니라 ChatGPT Codex backend를 사용하므로, 연결 확인과 모델 조회는 Codex backend probe로 처리됩니다.",
                "This mode reads the token saved by `codex login` in `~/.codex/auth.json` and connects to `https://chatgpt.com/backend-api/codex`. It uses the ChatGPT Codex backend instead of the OpenAI API key path, so connection checks and model loading are handled through a Codex backend probe.",
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

        {isPrimaryBuiltin ? (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="text-sm font-semibold text-stone-900">{text("기본 카드 동기화", "Sync Built-in Cards")}</div>
            <div className="mt-2 text-xs leading-5 text-stone-600">{text("지금 카드의 AI 종류, 인증 정보, 주소, 모델 정보를 다른 기본 카드에 함께 적용합니다.", "Apply this card's AI type, credentials, endpoint, and model information to the other built-in cards.")}</div>
            <div className="mt-4">
              <button
                onClick={() => onSyncBuiltinBackends()}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700"
              >
                {text("전체 적용", "Apply to All")}
              </button>
            </div>
          </div>
        ) : null}

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
