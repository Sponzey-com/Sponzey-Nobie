import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api, type MemoryWritebackReviewAction, type MemoryWritebackReviewItem, type MqttRuntimeResponse } from "../api/client"
import { ActiveInstructionsPanel } from "../components/ActiveInstructionsPanel"
import { McpServersPanel } from "../components/McpServersPanel"
import { CapabilityBadge } from "../components/CapabilityBadge"
import { AuthTokenPanel } from "../components/setup/AuthTokenPanel"
import { MqttRuntimePanel } from "../components/setup/MqttRuntimePanel"
import { MqttSettingsForm } from "../components/setup/MqttSettingsForm"
import { RemoteAccessForm } from "../components/setup/RemoteAccessForm"
import { SecuritySettingsForm } from "../components/setup/SecuritySettingsForm"
import { SlackCheckPanel } from "../components/setup/SlackCheckPanel"
import { SlackSettingsForm } from "../components/setup/SlackSettingsForm"
import { SingleAIConnectionPanel } from "../components/setup/SingleAIConnectionPanel"
import { SetupChecksPanel } from "../components/setup/SetupChecksPanel"
import { SetupSyncStatus } from "../components/setup/SetupSyncStatus"
import { TelegramSettingsForm } from "../components/setup/TelegramSettingsForm"
import { TelegramCheckPanel } from "../components/setup/TelegramCheckPanel"
import { UpdatePanel } from "../components/UpdatePanel"
import { UiLanguageSwitcher } from "../components/UiLanguageSwitcher"
import { type AIBackendCard, type NewAIBackendInput } from "../contracts/ai"
import type { ConfigurationOperationsSnapshot, MigrationDryRunResult } from "../contracts/config-operations"
import type { SetupDraft } from "../contracts/setup"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "../lib/single-ai"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useSetupStore } from "../stores/setup"
import { useUiI18n } from "../lib/ui-i18n"
import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"

type TabId = "backends" | "security" | "channels" | "mqtt" | "remote" | "advanced"

interface OperationsDiagnosticsSnapshot {
  memorySearchMode: string
  vectorAvailable: boolean
  vectorBackend: string
  vectorReason: string
  schedulerRunning: boolean
  activeJobs: number
  nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }>
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function normalizeOperationsDiagnostics(settings: Record<string, unknown>, schedulerHealth: {
  running?: boolean
  activeJobs?: number
  nextRuns?: Array<{ scheduleId: string; name: string; nextRunAt: number }>
}): OperationsDiagnosticsSnapshot {
  const legacy = readRecord(settings.legacy)
  const memory = readRecord(settings.memory ?? legacy.memory)
  const vectorBackend = readRecord(memory.vectorBackend)

  return {
    memorySearchMode: typeof memory.searchMode === "string" ? memory.searchMode : "fts",
    vectorAvailable: vectorBackend.available === true,
    vectorBackend: typeof vectorBackend.backend === "string" ? vectorBackend.backend : "none",
    vectorReason: typeof vectorBackend.reason === "string" ? vectorBackend.reason : "",
    schedulerRunning: schedulerHealth.running === true,
    activeJobs: typeof schedulerHealth.activeJobs === "number" ? schedulerHealth.activeJobs : 0,
    nextRuns: Array.isArray(schedulerHealth.nextRuns) ? schedulerHealth.nextRuns : [],
  }
}

function cloneDraft(draft: SetupDraft): SetupDraft {
  return JSON.parse(JSON.stringify(draft)) as SetupDraft
}

function toBackendSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "custom_backend"
}

function createBackendId(kind: AIBackendCard["kind"], label: string, existingIds: string[]) {
  const base = `${kind}:${toBackendSlug(label)}`
  if (!existingIds.includes(base)) return base

  let index = 2
  while (existingIds.includes(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>("backends")
  const [localDraft, setLocalDraft] = useState<SetupDraft | null>(null)
  const [selectedAiBackendId, setSelectedAiBackendId] = useState<string | null>(null)
  const [editorVersion, setEditorVersion] = useState(0)
  const [mqttRuntime, setMqttRuntime] = useState<MqttRuntimeResponse | null>(null)
  const [mqttRuntimeLoading, setMqttRuntimeLoading] = useState(false)
  const [mqttRuntimeError, setMqttRuntimeError] = useState("")
  const [disconnectingExtensionId, setDisconnectingExtensionId] = useState<string | null>(null)
  const [operationsDiagnostics, setOperationsDiagnostics] = useState<OperationsDiagnosticsSnapshot | null>(null)
  const [operationsDiagnosticsLoading, setOperationsDiagnosticsLoading] = useState(false)
  const [operationsDiagnosticsError, setOperationsDiagnosticsError] = useState("")
  const [configOperationsSnapshot, setConfigOperationsSnapshot] = useState<ConfigurationOperationsSnapshot | null>(null)
  const [configOperationsLoading, setConfigOperationsLoading] = useState(false)
  const [configOperationsError, setConfigOperationsError] = useState("")
  const [configMigrationDryRun, setConfigMigrationDryRun] = useState<MigrationDryRunResult | null>(null)
  const [configOperationResult, setConfigOperationResult] = useState("")
  const [promptImportPath, setPromptImportPath] = useState("")
  const [dbImportPath, setDbImportPath] = useState("")
  const [memoryReviewItems, setMemoryReviewItems] = useState<MemoryWritebackReviewItem[]>([])
  const [memoryReviewLoading, setMemoryReviewLoading] = useState(false)
  const [memoryReviewError, setMemoryReviewError] = useState("")
  const [memoryReviewActionId, setMemoryReviewActionId] = useState<string | null>(null)
  const [memoryReviewEdits, setMemoryReviewEdits] = useState<Record<string, string>>({})
  const uiLanguage = useUiLanguageStore((state) => state.language)
  const { text, displayText } = useUiI18n()
  const capabilities = useCapabilitiesStore((state) => state.items)
  const {
    draft,
    state,
    checks,
    checksLoading,
    saving,
    lastSavedAt,
    lastError,
    refreshChecks,
    resetSetup,
    saveDraftSnapshot,
  } = useSetupStore()

  useEffect(() => {
    setLocalDraft(cloneDraft(draft))
  }, [draft])

  useEffect(() => {
    setSelectedAiBackendId((current) => getPreferredSingleAiBackendId((localDraft ?? draft).aiBackends, current))
  }, [draft, localDraft])

  const loadMqttRuntime = useCallback(async () => {
    setMqttRuntimeLoading(true)
    try {
      const runtime = await api.mqttRuntime()
      setMqttRuntime(runtime)
      setMqttRuntimeError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMqttRuntimeError(message)
    } finally {
      setMqttRuntimeLoading(false)
    }
  }, [])

  const loadOperationsDiagnostics = useCallback(async () => {
    setOperationsDiagnosticsLoading(true)
    try {
      const [settings, schedulerHealth] = await Promise.all([api.settings(), api.schedulerHealth()])
      setOperationsDiagnostics(normalizeOperationsDiagnostics(settings, schedulerHealth))
      setOperationsDiagnosticsError("")
    } catch (error) {
      setOperationsDiagnosticsError(error instanceof Error ? error.message : String(error))
    } finally {
      setOperationsDiagnosticsLoading(false)
    }
  }, [])

  const loadConfigOperations = useCallback(async () => {
    setConfigOperationsLoading(true)
    try {
      const result = await api.configOperations()
      setConfigOperationsSnapshot(result.snapshot)
      setConfigOperationsError("")
    } catch (error) {
      setConfigOperationsError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfigOperationsLoading(false)
    }
  }, [])

  const loadMemoryWritebackReview = useCallback(async () => {
    setMemoryReviewLoading(true)
    try {
      const result = await api.memoryWritebackReview("pending")
      setMemoryReviewItems(result.candidates)
      setMemoryReviewEdits(Object.fromEntries(result.candidates.map((candidate) => [candidate.id, candidate.proposedText])))
      setMemoryReviewError("")
    } catch (error) {
      setMemoryReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setMemoryReviewLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== "mqtt") return
    void loadMqttRuntime()
    const timer = window.setInterval(() => {
      void loadMqttRuntime()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [tab, editorVersion, loadMqttRuntime])

  useEffect(() => {
    if (tab !== "advanced") return
    void loadOperationsDiagnostics()
    void loadConfigOperations()
    void loadMemoryWritebackReview()
  }, [tab, editorVersion, loadConfigOperations, loadMemoryWritebackReview, loadOperationsDiagnostics])

  const handleConfigAction = useCallback(async (action: "dryRun" | "dbBackup" | "dbExport" | "configExport" | "promptExport" | "promptRecover" | "promptImport" | "dbImport") => {
    setConfigOperationsLoading(true)
    setConfigOperationsError("")
    try {
      if (action === "dryRun") {
        const result = await api.configMigrationDryRun()
        setConfigMigrationDryRun(result.dryRun)
        setConfigOperationResult(result.dryRun.userMessage)
        return
      }
      if (action === "dbBackup") {
        const result = await api.backupDatabase()
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`DB backup: ${result.backup.backupPath}`)
        return
      }
      if (action === "dbExport") {
        const result = await api.exportDatabase()
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`DB export: ${result.export.backupPath}`)
        return
      }
      if (action === "configExport") {
        const result = await api.exportMaskedConfig()
        setConfigOperationResult(`Masked config export: ${result.export.exportPath}`)
        return
      }
      if (action === "promptExport") {
        const result = await api.exportPromptSourcesOps()
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`Prompt source export: ${result.export.exportPath}`)
        return
      }
      if (action === "promptRecover") {
        const result = await api.recoverPromptSourcesOps()
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`Prompt source recovery: ${result.recovery.created.length} created, ${result.recovery.existing.length} existing`)
        return
      }
      if (action === "promptImport") {
        if (!promptImportPath.trim()) throw new Error("prompt source export 경로를 입력해 주세요.")
        const confirmed = window.confirm("기존 prompt source를 덮어쓰지 않고 누락된 항목만 가져옵니다. 계속할까요?")
        if (!confirmed) return
        const result = await api.importPromptSourcesOps({ exportPath: promptImportPath.trim(), overwrite: false })
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`Prompt source import: ${result.import.imported.length} imported, ${result.import.skipped.length} skipped`)
        return
      }
      if (action === "dbImport") {
        if (!dbImportPath.trim()) throw new Error("DB backup 경로를 입력해 주세요.")
        const confirmed = window.confirm("현재 DB를 rollback backup으로 남긴 뒤 가져온 DB로 교체합니다. 계속할까요?")
        if (!confirmed) return
        const result = await api.importDatabase(dbImportPath.trim())
        setConfigOperationsSnapshot(result.snapshot)
        setConfigOperationResult(`DB import complete. Rollback backup: ${result.import.rollbackBackup.backupPath}`)
      }
    } catch (error) {
      setConfigOperationsError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfigOperationsLoading(false)
    }
  }, [dbImportPath, promptImportPath])

  const handleMemoryReviewAction = useCallback(async (candidateId: string, action: MemoryWritebackReviewAction) => {
    setMemoryReviewActionId(candidateId)
    try {
      const editedContent = action === "approve_edited" ? memoryReviewEdits[candidateId] : undefined
      await api.reviewMemoryWriteback(candidateId, { action, ...(editedContent ? { editedContent } : {}) })
      await loadMemoryWritebackReview()
      setMemoryReviewError("")
    } catch (error) {
      setMemoryReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setMemoryReviewActionId(null)
    }
  }, [loadMemoryWritebackReview, memoryReviewEdits])

  const tabs = useMemo(
    () => [
      { id: "backends" as const, label: pickUiText(uiLanguage, "AI 연결", "AI Connection"), capabilityKey: "ai.backends" },
      { id: "security" as const, label: pickUiText(uiLanguage, "보안", "Security"), capabilityKey: "settings.control" },
      { id: "channels" as const, label: pickUiText(uiLanguage, "채널", "Channels"), capabilityKey: "telegram.channel" },
      { id: "mqtt" as const, label: pickUiText(uiLanguage, "MQTT", "MQTT"), capabilityKey: "mqtt.broker" },
      { id: "remote" as const, label: pickUiText(uiLanguage, "원격 접근", "Remote Access"), capabilityKey: "settings.control" },
      { id: "advanced" as const, label: pickUiText(uiLanguage, "고급", "Advanced"), capabilityKey: "mcp.client" },
    ],
    [uiLanguage],
  )

  const activeDraft = localDraft ?? draft
  const isDirty = useMemo(() => JSON.stringify(activeDraft) !== JSON.stringify(draft), [activeDraft, draft])
  const channelsDirty = useMemo(
    () => JSON.stringify(activeDraft.channels) !== JSON.stringify(draft.channels),
    [activeDraft.channels, draft.channels],
  )

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0]
  const activeCapability = resolveSettingsCapability(
    activeTab.id,
    capabilities.find((item) => item.key === activeTab.capabilityKey),
    activeDraft,
    isDirty,
  )

  async function handleReset() {
    const confirmed = window.confirm("로컬 config와 setup 상태를 기본값으로 복원합니다. 계속할까요?")
    if (!confirmed) return
    await resetSetup()
    setEditorVersion((current) => current + 1)
  }

  async function handleSave() {
    await saveDraftSnapshot(activeDraft, { syncChannelRuntime: channelsDirty })
    setEditorVersion((current) => current + 1)
  }

  function handleCancel() {
    setLocalDraft(cloneDraft(draft))
    setEditorVersion((current) => current + 1)
  }

  const handleDisconnectMqttExtension = useCallback(async (extensionId: string) => {
    setDisconnectingExtensionId(extensionId)
    try {
      const result = await api.disconnectMqttExtension(extensionId)
      setMqttRuntimeError(result.ok ? "" : result.message)
      await loadMqttRuntime()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMqttRuntimeError(message)
    } finally {
      setDisconnectingExtensionId(null)
    }
  }, [loadMqttRuntime])

  function patchDraft<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setLocalDraft((current) => {
      const base = current ?? cloneDraft(draft)
      return { ...base, [key]: value }
    })
  }

  function addBackend(input: NewAIBackendInput) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      const backendId = createBackendId(
        input.kind,
        input.label,
        base.aiBackends.map((backend) => backend.id),
      )
      const backend: AIBackendCard = {
        id: backendId,
        label: input.label.trim(),
        kind: input.kind,
        providerType: input.providerType,
        authMode: input.authMode ?? "api_key",
        credentials: { ...input.credentials },
        local: input.local,
        enabled: false,
        availableModels: input.availableModels,
        defaultModel: input.defaultModel.trim(),
        status: "disabled",
        summary: input.summary.trim(),
        tags: input.tags,
        endpoint: input.endpoint?.trim() || undefined,
      }
      return {
        ...base,
        aiBackends: [...base.aiBackends, backend],
        routingProfiles: base.routingProfiles.map((profile) =>
          profile.id === "default"
            ? { ...profile, targets: [...profile.targets, backendId] }
            : profile,
        ),
      }
    })
  }

  function removeBackend(backendId: string) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        aiBackends: base.aiBackends.filter((backend) => backend.id !== backendId),
        routingProfiles: base.routingProfiles.map((profile) => ({
          ...profile,
          targets: profile.targets.filter((target) => target !== backendId),
        })),
      }
    })
  }

  function updateBackend(backendId: string, patch: Partial<AIBackendCard>) {
    if (patch.enabled === true) {
      setLocalDraft((current) => setSingleAiBackendEnabled(cloneDraft(current ?? draft), backendId, true))
      return
    }
    if (patch.enabled === false) {
      setLocalDraft((current) => setSingleAiBackendEnabled(cloneDraft(current ?? draft), backendId, false))
      return
    }
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        aiBackends: base.aiBackends.map((backend) =>
          backend.id === backendId ? { ...backend, ...patch } : backend,
        ),
      }
    })
  }

  function setRoutingTargetEnabled(_profileId: string, backendId: string, enabled: boolean) {
    setLocalDraft((current) => setSingleAiBackendEnabled(cloneDraft(current ?? draft), backendId, enabled))
  }

  function renderActions() {
    if (tab === "advanced") return null
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5">
        <div className="text-sm text-stone-500">{pickUiText(uiLanguage, "변경사항은 저장 버튼을 눌러야 반영됩니다.", "Changes are applied only after you press Save.")}</div>
        <div className="flex gap-3">
          <button
            onClick={handleCancel}
            disabled={!isDirty || saving}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pickUiText(uiLanguage, "취소", "Cancel")}
          </button>
          <button
            onClick={() => { if (!isDirty || saving) return; void handleSave() }}
            disabled={saving}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${isDirty ? "bg-stone-900 text-white" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}
          >
            {saving
              ? pickUiText(uiLanguage, "저장 중...", "Saving...")
              : isDirty
                ? pickUiText(uiLanguage, "저장", "Save")
                : pickUiText(uiLanguage, "저장됨", "Saved")}
          </button>
        </div>
      </div>
    )
  }

  function renderContent() {
    switch (tab) {
      case "backends":
        return (
          <div key={`backends-${editorVersion}`} className="space-y-4">
            <SingleAIConnectionPanel
              backends={activeDraft.aiBackends}
              routingProfiles={activeDraft.routingProfiles}
              activeBackendId={selectedAiBackendId}
              onSelectBackend={setSelectedAiBackendId}
              onUpdateBackend={updateBackend}
              onToggleBackend={(backendId, enabled) => setRoutingTargetEnabled("default", backendId, enabled)}
              onRemoveBackend={removeBackend}
              onSetRoutingTargetEnabled={setRoutingTargetEnabled}
            />
          </div>
        )

      case "security":
        return (
          <div key={`security-${editorVersion}`}>
            <SecuritySettingsForm
              value={activeDraft.security}
              onChange={(patch) => patchDraft("security", { ...activeDraft.security, ...patch })}
            />
          </div>
        )

      case "channels":
        return (
          <div key={`channels-${editorVersion}`} className="space-y-4">
            {activeCapability?.status === "error" && activeCapability.reason ? (
              <RuntimeNotice title={text("채널 런타임 오류", "Channel Runtime Error")} message={activeCapability.reason} tone="error" />
            ) : activeCapability?.reason ? (
              <RuntimeNotice title={text("채널 상태", "Channel Status")} message={activeCapability.reason} tone="info" />
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <TelegramSettingsForm
                  value={activeDraft.channels}
                  onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
                />
                <TelegramCheckPanel botToken={activeDraft.channels.botToken} />
              </div>
              <div className="space-y-4">
                <SlackSettingsForm
                  value={activeDraft.channels}
                  onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
                />
                <SlackCheckPanel
                  botToken={activeDraft.channels.slackBotToken}
                  appToken={activeDraft.channels.slackAppToken}
                />
              </div>
            </div>
          </div>
        )

      case "mqtt":
        return (
          <div key={`mqtt-${editorVersion}`} className="space-y-4">
            {activeCapability?.reason ? (
              <RuntimeNotice
                title={text("MQTT 상태", "MQTT Status")}
                message={activeCapability.reason}
                tone={activeCapability.status === "error" ? "error" : "info"}
              />
            ) : null}
            <MqttSettingsForm
              value={activeDraft.mqtt}
              onChange={(patch) => patchDraft("mqtt", { ...activeDraft.mqtt, ...patch })}
            />
            <MqttRuntimePanel
              runtime={mqttRuntime}
              loading={mqttRuntimeLoading}
              error={mqttRuntimeError}
              disconnectingExtensionId={disconnectingExtensionId}
              onRefresh={() => void loadMqttRuntime()}
              onDisconnect={(extensionId) => void handleDisconnectMqttExtension(extensionId)}
            />
          </div>
        )

      case "remote":
        return (
          <div key={`remote-${editorVersion}`} className="space-y-4">
            <RemoteAccessForm
              value={activeDraft.remoteAccess}
              onChange={(patch) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, ...patch })}
            />
            <AuthTokenPanel
              authEnabled={activeDraft.remoteAccess.authEnabled}
              authToken={activeDraft.remoteAccess.authToken}
              onGenerated={(token) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, authToken: token })}
            />
          </div>
        )

      case "advanced":
        return (
          <div className="space-y-4">
            <OperationsDiagnosticsPanel
              snapshot={operationsDiagnostics}
              loading={operationsDiagnosticsLoading}
              error={operationsDiagnosticsError}
              onRefresh={() => void loadOperationsDiagnostics()}
            />
            <ConfigMigrationPanel
              snapshot={configOperationsSnapshot}
              dryRun={configMigrationDryRun}
              loading={configOperationsLoading}
              error={configOperationsError}
              result={configOperationResult}
              promptImportPath={promptImportPath}
              dbImportPath={dbImportPath}
              onPromptImportPathChange={setPromptImportPath}
              onDbImportPathChange={setDbImportPath}
              onRefresh={() => void loadConfigOperations()}
              onAction={(action) => void handleConfigAction(action)}
            />
            <MemoryWritebackReviewPanel
              candidates={memoryReviewItems}
              edits={memoryReviewEdits}
              loading={memoryReviewLoading}
              error={memoryReviewError}
              actionId={memoryReviewActionId}
              onRefresh={() => void loadMemoryWritebackReview()}
              onEdit={(candidateId, value) => setMemoryReviewEdits((current) => ({ ...current, [candidateId]: value }))}
              onAction={(candidateId, action) => void handleMemoryReviewAction(candidateId, action)}
            />
            <UpdatePanel />
            <McpServersPanel />
            <ActiveInstructionsPanel />
          </div>
        )
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{pickUiText(uiLanguage, "설정", "Settings")}</div>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">{pickUiText(uiLanguage, "WebUI 제어 설정", "WebUI Control Settings")}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
            {pickUiText(uiLanguage, "Settings 화면에서는 변경사항을 즉시 저장하지 않습니다. 각 설정 화면에서 저장 버튼을 눌러야 실제 로컬 설정에 반영됩니다.", "Changes are not saved immediately in Settings. Press Save on each settings page to apply them locally.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UiLanguageSwitcher />
          <div className="rounded-xl bg-white px-4 py-3 text-sm text-stone-600 shadow-sm ring-1 ring-stone-200">
            {pickUiText(uiLanguage, "setup 상태", "setup status")}: <span className="font-semibold text-stone-900">{state.completed ? "completed" : state.currentStep}</span>
          </div>
          <Link
            to="/setup"
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(uiLanguage, "설정 위저드 다시 열기", "Open Setup Wizard")}
          </Link>
          <button
            onClick={() => void handleReset()}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(uiLanguage, "로컬 설정 기본값 복원", "Reset Local Settings")}
          </button>
          <button
            onClick={() => void refreshChecks(true)}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(uiLanguage, "로컬 체크 새로고침", "Refresh Local Checks")}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <SetupSyncStatus saving={saving} lastSavedAt={lastSavedAt} lastError={lastError} />
        <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[18rem_1fr]">
        <aside className="rounded-[1.75rem] border border-stone-200 bg-white p-4">
          <div className="space-y-2">
            {tabs.map((item) => {
              const capability = resolveSettingsCapability(
                item.id,
                capabilities.find((candidate) => candidate.key === item.capabilityKey),
                activeDraft,
                isDirty,
              )
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    tab === item.id
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-stone-50 text-stone-700 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{item.label}</span>
                    {capability ? <CapabilityBadge status={capability.status} /> : null}
                  </div>
                  <div className={`mt-2 text-xs leading-5 ${tab === item.id ? "text-stone-300" : "text-stone-500"}`}>
                    {capability?.reason ? displayText(capability.reason) : capability?.label ?? text("준비 중", "Coming soon")}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stone-900">{activeTab.label}</div>
              <div className="mt-1 text-xs text-stone-500">{activeCapability?.key}</div>
            </div>
            <div className="flex items-center gap-3">
              {isDirty && tab !== "advanced" ? <span className="text-xs font-semibold text-amber-700">{pickUiText(uiLanguage, "저장되지 않은 변경사항", "Unsaved changes")}</span> : null}
              {activeCapability ? <CapabilityBadge status={activeCapability.status} /> : null}
            </div>
          </div>
          {renderContent()}
          {renderActions()}
        </section>
      </div>
    </div>
  )
}

function resolveSettingsCapability(
  tabId: TabId,
  capability: ReturnType<typeof useCapabilitiesStore.getState>["items"][number] | undefined,
  draft: SetupDraft,
  isDirty: boolean,
) {
  if (!capability) return capability

  if (tabId === "channels") {
    const hasTelegramConfig = Boolean(draft.channels.botToken.trim())
    const hasSlackConfig = Boolean(draft.channels.slackBotToken.trim() && draft.channels.slackAppToken.trim())
    if (capability.status === "error" && !hasSlackConfig) return capability
    return {
      ...capability,
      status: "ready" as const,
      reason: hasTelegramConfig || hasSlackConfig
        ? "채널 정보는 저장되었습니다. 런타임 시작 상태는 채널 상세에서 확인할 수 있습니다."
        : "Telegram 또는 Slack 중 하나를 연결할 수 있습니다.",
    }
  }

  if (tabId === "mqtt") {
    const wantsEnabled = draft.mqtt.enabled
    const hasCredentials = Boolean(draft.mqtt.username.trim()) && Boolean(draft.mqtt.password.trim())
    if (wantsEnabled && !hasCredentials) {
      return {
        ...capability,
        status: "error" as const,
        reason: "MQTT 브로커를 켜려면 아이디와 비밀번호를 모두 입력해야 합니다.",
      }
    }
    if (wantsEnabled && isDirty) {
      return {
        ...capability,
        status: "ready" as const,
        reason: "MQTT 활성화가 체크되어 있습니다. 저장하면 브로커를 다시 시작합니다.",
      }
    }
    if (!wantsEnabled && isDirty) {
      return {
        ...capability,
        status: "disabled" as const,
        reason: "MQTT 비활성화가 체크되어 있습니다. 저장하면 브로커를 중지합니다.",
      }
    }
  }

  return capability
}

function RuntimeNotice({
  title,
  message,
  tone,
}: {
  title: string
  message: string
  tone: "info" | "error"
}) {
  const { displayText } = useUiI18n()
  const toneClass = tone === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-blue-200 bg-blue-50 text-blue-700"

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm leading-6">{displayText(message)}</div>
    </div>
  )
}

function MemoryWritebackReviewPanel({
  candidates,
  edits,
  loading,
  error,
  actionId,
  onRefresh,
  onEdit,
  onAction,
}: {
  candidates: MemoryWritebackReviewItem[]
  edits: Record<string, string>
  loading: boolean
  error: string
  actionId: string | null
  onRefresh: () => void
  onEdit: (candidateId: string, value: string) => void
  onAction: (candidateId: string, action: MemoryWritebackReviewAction) => void
}) {
  const { text, displayText } = useUiI18n()

  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("장기 기억 검토", "Long-term memory review")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text(
              "승인한 후보만 장기 기억 검색에 들어갑니다. raw 오류와 민감 정보는 차단 또는 마스킹됩니다.",
              "Only approved candidates enter long-term memory retrieval. Raw errors and sensitive data are blocked or masked.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("불러오는 중", "Loading") : text("새로고침", "Refresh")}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {candidates.length === 0 && !loading ? (
          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-6 text-sm text-stone-500">
            {text("검토 대기 중인 기억 후보가 없습니다.", "There are no memory candidates waiting for review.")}
          </div>
        ) : null}
        {candidates.map((candidate) => {
          const blocked = candidate.blockReasons.length > 0
          const busy = actionId === candidate.id
          return (
            <div key={candidate.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span className="rounded-full bg-stone-100 px-2 py-1 font-semibold text-stone-700">{candidate.sourceType}</span>
                    <span>{candidate.scope}</span>
                    {candidate.confidence ? <span>{text("신뢰도", "confidence")}: {candidate.confidence}</span> : null}
                    {candidate.ttl ? <span>TTL: {candidate.ttl}</span> : null}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-stone-500">
                    {candidate.sourceRunId ? <span>run: {candidate.sourceRunId} </span> : null}
                    {candidate.sourceChannel ? <span>channel: {displayText(candidate.sourceChannel)} </span> : null}
                    {candidate.sessionId ? <span>session: {candidate.sessionId} </span> : null}
                    {candidate.requestGroupId ? <span>request: {candidate.requestGroupId}</span> : null}
                  </div>
                </div>
                {blocked ? (
                  <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                    {text("차단됨", "Blocked")}: {candidate.blockReasons.join(", ")}
                  </div>
                ) : null}
              </div>

              <textarea
                value={edits[candidate.id] ?? candidate.proposedText}
                onChange={(event) => onEdit(candidate.id, event.target.value)}
                className="mt-4 min-h-28 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-800 outline-none focus:border-stone-400"
              />

              {candidate.repeatExamples.length ? (
                <div className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500">
                  {text("반복 사례", "Repeat examples")}: {displayText(candidate.repeatExamples.join(" / "))}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onAction(candidate.id, "approve_long_term")}
                  disabled={busy || blocked}
                  className="rounded-xl bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("장기 기억으로 저장", "Save as long-term")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction(candidate.id, "approve_edited")}
                  disabled={busy || blocked || !(edits[candidate.id] ?? candidate.proposedText).trim()}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("수정 후 저장", "Save edited")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction(candidate.id, "keep_session")}
                  disabled={busy}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("이번 세션만 유지", "Keep for this session")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction(candidate.id, "discard")}
                  disabled={busy}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("삭제", "Delete")}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ConfigOperationAction = "dryRun" | "dbBackup" | "dbExport" | "configExport" | "promptExport" | "promptRecover" | "promptImport" | "dbImport"

function ConfigMigrationPanel({
  snapshot,
  dryRun,
  loading,
  error,
  result,
  promptImportPath,
  dbImportPath,
  onPromptImportPathChange,
  onDbImportPathChange,
  onRefresh,
  onAction,
}: {
  snapshot: ConfigurationOperationsSnapshot | null
  dryRun: MigrationDryRunResult | null
  loading: boolean
  error: string
  result: string
  promptImportPath: string
  dbImportPath: string
  onPromptImportPathChange: (value: string) => void
  onDbImportPathChange: (value: string) => void
  onRefresh: () => void
  onAction: (action: ConfigOperationAction) => void
}) {
  const { text, displayText } = useUiI18n()
  const database = snapshot?.database
  const pendingVersions = dryRun?.willApply.map((migration) => migration.version) ?? database?.pendingVersions ?? []

  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("설정/마이그레이션 백업", "Config, migration, backup")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text(
              "DB migration version, prompt source checksum, secret masking export, backup/import를 운영 화면에서 확인합니다.",
              "Inspect DB migration version, prompt source checksums, masked exports, backup, and import from the operations screen.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("확인 중", "Checking") : text("새로고침", "Refresh")}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}
      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
          {displayText(result)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("DB 버전", "DB version")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{database ? `${database.currentVersion} / ${database.latestVersion}` : "-"}</div>
          <div className={`mt-1 text-xs ${database?.upToDate ? "text-emerald-700" : "text-amber-700"}`}>
            {database?.upToDate ? text("최신", "Up to date") : text("확인 필요", "Needs check")}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("적용 대기", "Pending")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{pendingVersions.length}</div>
          <div className="mt-1 break-all text-xs text-stone-500">{pendingVersions.length ? pendingVersions.join(", ") : text("없음", "none")}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("프롬프트 소스", "Prompt sources")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.promptSources.count ?? 0}</div>
          <div className="mt-1 break-all text-xs text-stone-500">{snapshot?.promptSources.workDir ?? "-"}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("설정 파일", "Config file")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.config.exists ? text("있음", "exists") : text("없음", "missing")}</div>
          <div className="mt-1 break-all text-xs text-stone-500">{snapshot?.config.configPath ?? "-"}</div>
        </div>
      </div>

      {dryRun ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("Migration dry-run", "Migration dry-run")}</div>
          <div className="mt-2 text-sm leading-6 text-stone-700">{displayText(dryRun.userMessage)}</div>
          {dryRun.warnings.length ? <div className="mt-2 text-xs leading-5 text-amber-700">{displayText(dryRun.warnings.join(" / "))}</div> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          ["dryRun", text("Migration dry-run", "Migration dry-run")],
          ["dbBackup", text("DB 백업", "Back up DB")],
          ["dbExport", text("DB 내보내기", "Export DB")],
          ["configExport", text("설정 내보내기", "Export config")],
          ["promptExport", text("프롬프트 내보내기", "Export prompts")],
          ["promptRecover", text("프롬프트 복구", "Recover prompts")],
        ].map(([action, label]) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(action as ConfigOperationAction)}
            disabled={loading}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="text-xs font-semibold text-stone-500">{text("Prompt source export 경로", "Prompt source export path")}</label>
          <div className="mt-2 flex gap-2">
            <input
              value={promptImportPath}
              onChange={(event) => onPromptImportPathChange(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
              placeholder="/path/to/prompt-sources-export.json"
            />
            <button
              type="button"
              onClick={() => onAction("promptImport")}
              disabled={loading}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {text("가져오기", "Import")}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="text-xs font-semibold text-stone-500">{text("DB backup 경로", "DB backup path")}</label>
          <div className="mt-2 flex gap-2">
            <input
              value={dbImportPath}
              onChange={(event) => onDbImportPathChange(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
              placeholder="/path/to/db-backup.sqlite3"
            />
            <button
              type="button"
              onClick={() => onAction("dbImport")}
              disabled={loading}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {text("DB 가져오기", "Import DB")}
            </button>
          </div>
        </div>
      </div>

      {snapshot?.promptSources.versions.length ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("Prompt source versions", "Prompt source versions")}</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.promptSources.versions.slice(0, 12).map((source) => (
              <div key={`${source.sourceId}-${source.locale}`} className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <div className="font-semibold text-stone-900">{source.sourceId}:{source.locale}</div>
                <div className="mt-1 break-all">{source.version}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OperationsDiagnosticsPanel({
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  snapshot: OperationsDiagnosticsSnapshot | null
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  const { text, displayText } = useUiI18n()

  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("운영 진단", "Operational diagnostics")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text(
              "메모리 검색, 벡터 백엔드, 예약 작업 상태를 일반 설정과 분리해 확인합니다.",
              "Inspect memory search, vector backend, and schedule status separately from general settings.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("확인 중", "Checking") : text("새로고침", "Refresh")}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("메모리 검색", "Memory search")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.memorySearchMode ?? "fts"}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("벡터 백엔드", "Vector backend")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.vectorBackend ?? "none"}</div>
          <div className={`mt-1 text-xs ${snapshot?.vectorAvailable ? "text-emerald-700" : "text-amber-700"}`}>
            {snapshot?.vectorAvailable ? text("사용 가능", "Available") : displayText(snapshot?.vectorReason || text("FTS로 폴백", "Falling back to FTS"))}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("스케줄러", "Scheduler")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.schedulerRunning ? text("실행 중", "Running") : text("중지됨", "Stopped")}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("활성 예약", "Active jobs")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.activeJobs ?? 0}</div>
        </div>
      </div>

      {snapshot?.nextRuns.length ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("예약된 다음 실행", "Upcoming schedule runs")}</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {snapshot.nextRuns.slice(0, 6).map((item) => (
              <div key={`${item.scheduleId}-${item.nextRunAt}`} className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <div className="font-semibold text-stone-900">{displayText(item.name)}</div>
                <div className="mt-1">{new Date(item.nextRunAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
