import { useState } from "react"
import { discoverModelsFromEndpoint } from "../../api/modelDiscovery"
import {
  AI_PROVIDER_OPTIONS,
  getAIProviderDefaultEndpoint,
  getAIProviderEndpointPlaceholder,
  getAIProviderCredentialFields,
  hasRequiredProviderCredentials,
  isLocalProviderType,
  type AIBackendKind,
  type AIBackendCredentialKey,
  type AIProviderType,
  type NewAIBackendInput,
} from "../../contracts/ai"
import { getAIProviderDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"
import { SetupExpandableSection } from "./SetupExpandableSection"

const INITIAL_FORM: NewAIBackendInput = {
  label: "",
  kind: "provider",
  providerType: "openai",
  credentials: {},
  local: false,
  availableModels: [],
  defaultModel: "",
  summary: "",
  endpoint: getAIProviderDefaultEndpoint("openai"),
  tags: [],
}

function getKindLabel(kind: AIBackendKind, text: (ko: string, en: string) => string): string {
  return kind === "worker" ? text("작업 워커 (Worker)", "Task Worker") : text("직접 연결 (Provider)", "Direct Provider")
}

export function BackendComposer({
  onAdd,
}: {
  onAdd: (input: NewAIBackendInput) => void
}) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [tagsInput, setTagsInput] = useState("")
  const [loadingModels, setLoadingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [discoveryError, setDiscoveryError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const { text, displayText, language } = useUiI18n()

  function patch<K extends keyof NewAIBackendInput>(key: K, value: NewAIBackendInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function clearDiscoveryState() {
    setDiscoveryError("")
    setSuccessMessage("")
    setSourceUrl("")
  }

  async function runDiscovery(mode: "test" | "models") {
    if (!form.endpoint?.trim()) return
    if (mode === "test") {
      setTestingConnection(true)
    } else {
      setLoadingModels(true)
    }
    clearDiscoveryState()

    try {
      const result = await discoverModelsFromEndpoint(form.endpoint ?? "", form.providerType, form.credentials)
      setForm((current) => ({
        ...current,
        availableModels: result.models,
        defaultModel: result.models.includes(current.defaultModel) ? current.defaultModel : result.models[0] ?? "",
      }))
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
      setForm((current) => ({ ...current, availableModels: [], defaultModel: "" }))
      setDiscoveryError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingModels(false)
      setTestingConnection(false)
    }
  }

  function handleProviderTypeChange(providerType: AIProviderType) {
    setForm((current) => ({
      ...current,
      providerType,
      credentials: {},
      local: isLocalProviderType(providerType),
      endpoint: getAIProviderDefaultEndpoint(providerType),
      availableModels: [],
      defaultModel: "",
    }))
    clearDiscoveryState()
  }

  function patchCredential(key: AIBackendCredentialKey, value: string) {
    setForm((current) => ({
      ...current,
      credentials: {
        ...current.credentials,
        [key]: value,
      },
    }))
  }

  const credentialFields = getAIProviderCredentialFields(form.providerType)
  const canLoadModels = Boolean(form.endpoint?.trim()) && hasRequiredProviderCredentials(form.providerType, form.credentials)

  function submit() {
    const label = form.label.trim()
    if (!label || !form.endpoint?.trim() || form.availableModels.length === 0 || !form.defaultModel) return

    onAdd({
      ...form,
      label,
      summary: form.summary.trim(),
      endpoint: form.endpoint?.trim() || undefined,
      tags: tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    })

    setForm(INITIAL_FORM)
    setTagsInput("")
    clearDiscoveryState()
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-stone-900">{text("새 AI 연결 추가 (AI Backend)", "Add New AI Backend")}</div>
        <div className="mt-1 text-sm leading-6 text-stone-600">{text("이름을 정하고, AI 종류와 연결 주소를 입력한 뒤 연결 확인과 모델 조회를 진행합니다.", "Set a name, choose the AI type, enter the endpoint, then check the connection and load models.")}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("보여줄 이름 (Label)", "Display Label")}</label>
          <input
            className="input"
            value={form.label}
            onChange={(event) => patch("label", event.target.value)}
            placeholder={text("예: 우리 회사 OpenAI", "Example: Company OpenAI")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("연결 방식 (Runtime Type)", "Runtime Type")}</label>
          <select
            className="input"
            value={form.kind}
            onChange={(event) => patch("kind", event.target.value as AIBackendKind)}
          >
            <option value="provider">{getKindLabel("provider", text)}</option>
            <option value="worker">{getKindLabel("worker", text)}</option>
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("AI 종류 (Provider Type)", "AI Type (Provider Type)")}</label>
        <select
          className="input"
          value={form.providerType}
          onChange={(event) => handleProviderTypeChange(event.target.value as AIProviderType)}
        >
          {AI_PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {getAIProviderDisplayLabel(option.value, language)}
            </option>
          ))}
        </select>
      </div>

      {credentialFields.length > 0 ? (
        <div className="mt-4">
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
                  value={form.credentials[field.key] ?? ""}
                  onChange={(event) => patchCredential(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("연결 주소 (Endpoint) *", "Endpoint *")}</label>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            className="input font-mono"
            value={form.endpoint ?? ""}
            onChange={(event) => {
              patch("endpoint", event.target.value)
              patch("availableModels", [])
              patch("defaultModel", "")
              clearDiscoveryState()
            }}
            placeholder={getAIProviderEndpointPlaceholder(form.providerType)}
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
        {successMessage ? <p className="mt-2 text-xs leading-5 text-emerald-700">{successMessage}</p> : null}
        {sourceUrl ? <p className="mt-1 text-xs text-emerald-700">{text("조회 경로", "Source URL")}: {sourceUrl}</p> : null}
        {discoveryError ? <p className="mt-2 text-xs leading-5 text-red-600">{displayText(discoveryError)}</p> : null}
        {!hasRequiredProviderCredentials(form.providerType, form.credentials) ? (
          <p className="mt-2 text-xs leading-5 text-amber-700">{text("필수 인증 정보를 입력해야 연결 확인과 모델 조회를 진행할 수 있습니다.", "Enter the required credentials before checking the connection and loading models.")}</p>
        ) : null}
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("기본 모델 (Default Model) *", "Default Model *")}</label>
        <select
          className="input font-mono"
          value={form.defaultModel}
          onChange={(event) => patch("defaultModel", event.target.value)}
          disabled={form.availableModels.length === 0}
        >
          {form.availableModels.length === 0 ? <option value="">{text("연결 확인 뒤 모델을 먼저 조회해 주세요", "Check the connection and load models first")}</option> : null}
          {form.availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      <SetupExpandableSection
        title={text("고급 옵션 (Optional)", "Advanced Options")}
        description={text("처음 사용하는 경우에는 비워도 됩니다. 요약, 태그, 로컬 여부처럼 추가 정보가 필요할 때만 펼쳐 주세요.", "You can leave this empty at first. Expand it only when you need extra information such as summary, tags, or local mode.")}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">{text("설명 메모 (Summary)", "Summary")}</label>
            <textarea
              className="input min-h-[88px] text-sm"
              value={form.summary}
              onChange={(event) => patch("summary", event.target.value)}
              placeholder={text("이 AI를 어떤 용도로 쓸지 간단히 적어둘 수 있습니다", "Add a short note about what this AI is for")}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">{text("분류 태그 (Tags)", "Tags")}</label>
              <input
                className="input"
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder={text("예: local, coding, private_local", "Example: local, coding, private_local")}
              />
            </div>
            <label className="flex items-end gap-3 pb-2 text-sm font-medium text-stone-700">
              <input
                type="checkbox"
                checked={form.local}
                onChange={(event) => patch("local", event.target.checked)}
              />
              {text("로컬 연결 (Local)", "Local Connection")}
            </label>
          </div>
        </div>
      </SetupExpandableSection>

      <div className="mt-5 flex justify-end">
        <button
          onClick={submit}
          disabled={!form.label.trim() || !form.endpoint?.trim() || form.availableModels.length === 0 || !form.defaultModel}
          className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {text("AI 연결 추가", "Add AI Backend")}
        </button>
      </div>
    </div>
  )
}
