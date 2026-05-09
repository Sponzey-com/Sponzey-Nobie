import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  api,
  type ChannelApprovalItem,
  type ChannelConnectionDetail,
  type ChannelConnectionSummary,
  type ChannelMessageItem,
  type MemoryQualitySnapshot,
  type MemoryWritebackReviewAction,
  type MemoryWritebackReviewItem,
  type MqttRuntimeResponse,
  type StatusResponse,
} from "../api/client"
import { ActiveInstructionsPanel } from "../components/ActiveInstructionsPanel"
import { McpServersPanel } from "../components/McpServersPanel"
import { CollapsibleText } from "../components/runs/CollapsibleText"
import { AuthTokenPanel } from "../components/setup/AuthTokenPanel"
import { MqttRuntimePanel } from "../components/setup/MqttRuntimePanel"
import { MqttSettingsForm } from "../components/setup/MqttSettingsForm"
import { RemoteAccessForm } from "../components/setup/RemoteAccessForm"
import { SecuritySettingsForm } from "../components/setup/SecuritySettingsForm"
import { SlackCheckPanel } from "../components/setup/SlackCheckPanel"
import { SlackSettingsForm } from "../components/setup/SlackSettingsForm"
import { DiscordSettingsForm } from "../components/setup/DiscordSettingsForm"
import { GoogleChatSettingsForm } from "../components/setup/GoogleChatSettingsForm"
import { IMessageLocalBridgeSettingsForm, KakaoTalkSettingsForm } from "../components/setup/LocalBridgeSettingsForm"
import { SingleAIConnectionPanel } from "../components/setup/SingleAIConnectionPanel"
import { SetupChecksPanel } from "../components/setup/SetupChecksPanel"
import { SetupSyncStatus } from "../components/setup/SetupSyncStatus"
import { TelegramSettingsForm } from "../components/setup/TelegramSettingsForm"
import { TelegramCheckPanel } from "../components/setup/TelegramCheckPanel"
import { UpdatePanel } from "../components/UpdatePanel"
import { UiLanguageSwitcher } from "../components/UiLanguageSwitcher"
import { type AIBackendCard, type NewAIBackendInput } from "../contracts/ai"
import type { ConfigurationOperationsSnapshot, MigrationDryRunResult } from "../contracts/config-operations"
import type { SetupChannelDraft, SetupDraft } from "../contracts/setup"
import {
  buildAdvancedSettingsTabs,
  isDraftSavingAdvancedSettingsTab,
  resolveAdvancedSettingsTabFromPath,
  type AdvancedSettingsTabId,
} from "../lib/advanced-settings"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "../lib/single-ai"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useSetupStore } from "../stores/setup"
import { useUiI18n } from "../lib/ui-i18n"
import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"

type TabId = AdvancedSettingsTabId

interface OperationsDiagnosticsSnapshot {
  memorySearchMode: string
  vectorAvailable: boolean
  vectorBackend: string
  vectorReason: string
  schedulerRunning: boolean
  activeJobs: number
  nextRuns: Array<{ scheduleId: string; name: string; nextRunAt: number }>
}

type OrchestrationMode = "single_nobie" | "orchestration"

interface OrchestrationSettingsDraft {
  mode: OrchestrationMode
  featureFlagEnabled: boolean
}

const DEFAULT_ORCHESTRATION_SETTINGS: OrchestrationSettingsDraft = {
  mode: "single_nobie",
  featureFlagEnabled: false,
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function normalizeOrchestrationSettings(settings: Record<string, unknown>): OrchestrationSettingsDraft {
  const legacy = readRecord(settings.legacy)
  const orchestration = readRecord(settings.orchestration ?? legacy.orchestration)
  const rawMode = orchestration.mode

  return {
    mode: rawMode === "orchestration" ? "orchestration" : "single_nobie",
    featureFlagEnabled: orchestration.featureFlagEnabled === true,
  }
}

function sameOrchestrationSettings(left: OrchestrationSettingsDraft | null, right: OrchestrationSettingsDraft | null): boolean {
  return Boolean(left && right)
    && left.mode === right.mode
    && left.featureFlagEnabled === right.featureFlagEnabled
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
  const location = useLocation()
  const tab = resolveAdvancedSettingsTabFromPath(location.pathname)
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
  const [orchestrationDraft, setOrchestrationDraft] = useState<OrchestrationSettingsDraft | null>(null)
  const [orchestrationSaved, setOrchestrationSaved] = useState<OrchestrationSettingsDraft | null>(null)
  const [orchestrationRuntime, setOrchestrationRuntime] = useState<StatusResponse["orchestration"] | null>(null)
  const [orchestrationLoading, setOrchestrationLoading] = useState(false)
  const [orchestrationSaving, setOrchestrationSaving] = useState(false)
  const [orchestrationError, setOrchestrationError] = useState("")
  const [orchestrationMessage, setOrchestrationMessage] = useState("")
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
  const [memoryQuality, setMemoryQuality] = useState<MemoryQualitySnapshot | null>(null)
  const [memoryQualityLoading, setMemoryQualityLoading] = useState(false)
  const [memoryQualityError, setMemoryQualityError] = useState("")
  const [channelRows, setChannelRows] = useState<ChannelConnectionSummary[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState("telegram:primary")
  const [channelDetail, setChannelDetail] = useState<ChannelConnectionDetail | null>(null)
  const [channelMessages, setChannelMessages] = useState<ChannelMessageItem[]>([])
  const [channelApprovals, setChannelApprovals] = useState<ChannelApprovalItem[]>([])
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelDetailLoading, setChannelDetailLoading] = useState(false)
  const [channelError, setChannelError] = useState("")
  const [channelActionMessage, setChannelActionMessage] = useState("")
  const [channelActionId, setChannelActionId] = useState<string | null>(null)
  const [localBridgeConsent, setLocalBridgeConsent] = useState(false)
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
    initialize,
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

  const loadOrchestrationSettings = useCallback(async () => {
    setOrchestrationLoading(true)
    try {
      const [settings, status] = await Promise.all([api.settings(), api.status()])
      const normalized = normalizeOrchestrationSettings(settings)
      setOrchestrationDraft(normalized)
      setOrchestrationSaved(normalized)
      setOrchestrationRuntime(status.orchestration ?? null)
      setOrchestrationError("")
      setOrchestrationMessage("")
    } catch (error) {
      setOrchestrationError(error instanceof Error ? error.message : String(error))
    } finally {
      setOrchestrationLoading(false)
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

  const loadMemoryQuality = useCallback(async () => {
    setMemoryQualityLoading(true)
    try {
      const result = await api.memoryQuality()
      setMemoryQuality(result.snapshot)
      setMemoryQualityError("")
    } catch (error) {
      setMemoryQualityError(error instanceof Error ? error.message : String(error))
    } finally {
      setMemoryQualityLoading(false)
    }
  }, [])

  const loadChannelOverview = useCallback(async () => {
    setChannelLoading(true)
    try {
      const [channels, messages, approvals] = await Promise.all([
        api.channels(),
        api.channelMessages({ limit: 25 }),
        api.channelApprovals({ limit: 25 }),
      ])
      setChannelRows(channels.channels)
      setChannelMessages(messages.messages)
      setChannelApprovals(approvals.approvals)
      setSelectedChannelId((current) =>
        channels.channels.some((channel) => channel.channelId === current)
          ? current
          : channels.channels[0]?.channelId ?? current,
      )
      setChannelError("")
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : String(error))
    } finally {
      setChannelLoading(false)
    }
  }, [])

  const loadSelectedChannelDetail = useCallback(async () => {
    setChannelDetailLoading(true)
    try {
      const detail = await api.channel(selectedChannelId)
      setChannelDetail(detail.channel)
      setChannelError("")
    } catch (error) {
      setChannelDetail(null)
      setChannelError(error instanceof Error ? error.message : String(error))
    } finally {
      setChannelDetailLoading(false)
    }
  }, [selectedChannelId])

  useEffect(() => {
    if (tab !== "yeonjang") return
    void loadMqttRuntime()
    const timer = window.setInterval(() => {
      void loadMqttRuntime()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [tab, editorVersion, loadMqttRuntime])

  useEffect(() => {
    if (tab !== "memory" && tab !== "schedules" && tab !== "release") return
    if (tab === "memory" || tab === "schedules") void loadOperationsDiagnostics()
    if (tab === "memory") {
      void loadMemoryQuality()
      void loadMemoryWritebackReview()
    }
    if (tab === "release") void loadConfigOperations()
  }, [tab, editorVersion, loadConfigOperations, loadMemoryQuality, loadMemoryWritebackReview, loadOperationsDiagnostics])

  useEffect(() => {
    if (tab !== "orchestration") return
    void loadOrchestrationSettings()
  }, [tab, editorVersion, loadOrchestrationSettings])

  useEffect(() => {
    if (tab !== "channels") return
    void loadChannelOverview()
  }, [tab, editorVersion, loadChannelOverview])

  useEffect(() => {
    if (tab !== "channels") return
    void loadSelectedChannelDetail()
  }, [tab, selectedChannelId, loadSelectedChannelDetail])

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

  const handleOrchestrationSave = useCallback(async () => {
    if (!orchestrationDraft) return
    setOrchestrationSaving(true)
    setOrchestrationError("")
    setOrchestrationMessage("")
    try {
      await api.saveSettings({
        orchestration: {
          mode: orchestrationDraft.mode,
          featureFlagEnabled: orchestrationDraft.featureFlagEnabled,
        },
      })
      await loadOrchestrationSettings()
      void useCapabilitiesStore.getState().refresh()
      setOrchestrationMessage(text("오케스트레이션 설정을 저장했습니다.", "Orchestration settings saved."))
    } catch (error) {
      setOrchestrationError(error instanceof Error ? error.message : String(error))
    } finally {
      setOrchestrationSaving(false)
    }
  }, [loadOrchestrationSettings, orchestrationDraft, text])

  const handleMemoryReviewAction = useCallback(async (candidateId: string, action: MemoryWritebackReviewAction) => {
    setMemoryReviewActionId(candidateId)
    try {
      const editedContent = action === "approve_edited" ? memoryReviewEdits[candidateId] : undefined
      await api.reviewMemoryWriteback(candidateId, { action, ...(editedContent ? { editedContent } : {}) })
      await loadMemoryQuality()
      await loadMemoryWritebackReview()
      setMemoryReviewError("")
    } catch (error) {
      setMemoryReviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setMemoryReviewActionId(null)
    }
  }, [loadMemoryQuality, loadMemoryWritebackReview, memoryReviewEdits])

  const refreshChannelUi = useCallback(async () => {
    await Promise.all([
      loadChannelOverview(),
      loadSelectedChannelDetail(),
      refreshChecks(true),
      initialize(true),
    ])
    void useCapabilitiesStore.getState().refresh()
  }, [initialize, loadChannelOverview, loadSelectedChannelDetail, refreshChecks])

  const handleChannelAction = useCallback(async (action: "enable" | "disable" | "restart" | "test") => {
    setChannelActionId(`${selectedChannelId}:${action}`)
    setChannelError("")
    setChannelActionMessage("")
    try {
      const result = action === "enable"
        ? await api.enableChannel(selectedChannelId, { acknowledgeRisk: localBridgeConsent })
        : action === "disable"
          ? await api.disableChannel(selectedChannelId)
          : action === "restart"
            ? await api.restartChannel(selectedChannelId)
            : await api.testChannel(selectedChannelId)
      if (result.ok === false) throw new Error(result.error || "Channel action failed")
      setChannelActionMessage(`${action}: ${result.status ?? result.mode ?? "ok"}`)
      await refreshChannelUi()
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : String(error))
    } finally {
      setChannelActionId(null)
    }
  }, [localBridgeConsent, refreshChannelUi, selectedChannelId])

  const handleChannelApprovalResponse = useCallback(async (approvalId: string, decision: "allow_once" | "allow_run" | "deny") => {
    setChannelActionId(`approval:${approvalId}:${decision}`)
    setChannelError("")
    try {
      const result = await api.respondChannelApproval(approvalId, { decision, decisionBy: "webui" })
      setChannelActionMessage(`approval: ${result.status}`)
      await loadChannelOverview()
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : String(error))
    } finally {
      setChannelActionId(null)
    }
  }, [loadChannelOverview])

  const handleChannelDeliveryRetry = useCallback(async (deliveryId: string) => {
    setChannelActionId(`delivery:${deliveryId}`)
    setChannelError("")
    try {
      const result = await api.retryChannelDelivery(deliveryId)
      setChannelActionMessage(`delivery retry: ${result.status}${result.reason ? ` / ${result.reason}` : ""}`)
      await loadChannelOverview()
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : String(error))
    } finally {
      setChannelActionId(null)
    }
  }, [loadChannelOverview])

  const tabs = useMemo(() => buildAdvancedSettingsTabs(uiLanguage), [uiLanguage])

  const activeDraft = localDraft ?? draft
  const isDirty = useMemo(() => JSON.stringify(activeDraft) !== JSON.stringify(draft), [activeDraft, draft])
  const orchestrationDirty = Boolean(orchestrationDraft && orchestrationSaved) && !sameOrchestrationSettings(orchestrationDraft, orchestrationSaved)
  const channelsDirty = useMemo(
    () => JSON.stringify(activeDraft.channels) !== JSON.stringify(draft.channels),
    [activeDraft.channels, draft.channels],
  )

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0]
  const pageTitle = activeTab.label
  const pageDescription = activeTab.description
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
    if (!isDraftSavingAdvancedSettingsTab(tab)) return null
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
      case "ai":
        return (
          <div key={`ai-${editorVersion}`} className="space-y-4">
            <CompactSection
              title={text("AI 연결", "AI connection")}
              description={text("현재 사용하는 연결 하나를 관리하고 상태와 기본 모델을 바로 조정합니다.", "Manage the active connection, its state, and the default model in one place.")}
            >
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
            </CompactSection>
          </div>
        )

      case "orchestration":
        return (
          <div className="space-y-4">
            <CompactSection
              title={text("토폴로지 실행 모드", "Topology execution mode")}
              description={text("저장된 토폴로지 노드를 실행자로 보고 채널 요청을 노드 흐름으로 위임할지 정합니다.", "Use saved topology nodes as executors and decide whether channel requests are delegated through the node flow.")}
            >
              <OrchestrationSettingsPanel
                value={orchestrationDraft}
                runtime={orchestrationRuntime}
                loading={orchestrationLoading}
                saving={orchestrationSaving}
                dirty={orchestrationDirty}
                error={orchestrationError}
                message={orchestrationMessage}
                onChange={(patch) => setOrchestrationDraft((current) => ({ ...(current ?? DEFAULT_ORCHESTRATION_SETTINGS), ...patch }))}
                onSave={() => void handleOrchestrationSave()}
                onCancel={() => {
                  setOrchestrationDraft(orchestrationSaved)
                  setOrchestrationError("")
                  setOrchestrationMessage("")
                }}
                onRefresh={() => void loadOrchestrationSettings()}
              />
            </CompactSection>
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
            <ChannelManagementPanel
              channels={channelRows}
              selectedChannelId={selectedChannelId}
              detail={channelDetail}
              messages={channelMessages}
              approvals={channelApprovals}
              loading={channelLoading}
              detailLoading={channelDetailLoading}
              error={channelError}
              actionMessage={channelActionMessage}
              actionId={channelActionId}
              localBridgeConsent={localBridgeConsent}
              draftChannels={activeDraft.channels}
              onSelect={(channelId) => {
                setSelectedChannelId(channelId)
                setLocalBridgeConsent(false)
                setChannelActionMessage("")
              }}
              onRefresh={() => void refreshChannelUi()}
              onAction={(action) => void handleChannelAction(action)}
              onConsentChange={setLocalBridgeConsent}
              onDraftChannelsChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
              onApprovalRespond={(approvalId, decision) => void handleChannelApprovalResponse(approvalId, decision)}
              onRetryDelivery={(deliveryId) => void handleChannelDeliveryRetry(deliveryId)}
            />
          </div>
        )

      case "yeonjang":
        return (
          <div key={`yeonjang-${editorVersion}`} className="space-y-4">
            {activeCapability?.reason ? (
              <RuntimeNotice
                title={text("연장/MQTT 상태", "Yeonjang/MQTT Status")}
                message={activeCapability.reason}
                tone={activeCapability.status === "error" ? "error" : "info"}
              />
            ) : null}
            <CompactSection
              title={text("브로커와 연결 상태", "Broker and runtime")}
              description={text("브로커 설정과 현재 연결된 연장 상태를 같은 묶음으로 봅니다.", "Broker settings and connected extension state are shown together.")}
            >
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
            </CompactSection>
          </div>
        )

      case "memory":
        return (
          <div className="space-y-4">
            <CompactSection
              title={text("메모리 운영", "Memory operations")}
              description={text("정책, 품질, writeback 검토를 한 흐름으로 묶었습니다.", "Policy, quality, and writeback review are grouped into one flow.")}
            >
              <OperationsDiagnosticsPanel
                snapshot={operationsDiagnostics}
                loading={operationsDiagnosticsLoading}
                error={operationsDiagnosticsError}
                onRefresh={() => void loadOperationsDiagnostics()}
              />
              <MemoryQualityDashboardPanel
                snapshot={memoryQuality}
                loading={memoryQualityLoading}
                error={memoryQualityError}
                onRefresh={() => void loadMemoryQuality()}
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
            </CompactSection>
          </div>
        )

      case "schedules":
        return (
          <div className="space-y-4">
            <AdvancedScheduleStatusPanel
              snapshot={operationsDiagnostics}
              loading={operationsDiagnosticsLoading}
              error={operationsDiagnosticsError}
              onRefresh={() => void loadOperationsDiagnostics()}
            />
          </div>
        )

      case "tool_permissions":
        return (
          <div key={`tool-permissions-${editorVersion}`} className="space-y-4">
            <CompactSection
              title={text("승인과 보안", "Approvals and security")}
              description={text("승인 정책과 외부 도구 실행 경계를 관리합니다.", "Manage approval policy and external tool execution boundaries.")}
            >
              <SecuritySettingsForm
                value={activeDraft.security}
                onChange={(patch) => patchDraft("security", { ...activeDraft.security, ...patch })}
              />
            </CompactSection>
            <CompactSection
              title={text("도구 연결과 지침", "Tool connections and instructions")}
              description={text("외부 도구 연결과 활성 지침을 한 묶음으로 관리합니다.", "External tool connections and active instructions are managed together.")}
            >
              <McpServersPanel />
              <ActiveInstructionsPanel />
            </CompactSection>
          </div>
        )

      case "release":
        return (
          <div className="space-y-4">
            <CompactSection
              title={text("백업과 배포", "Backup and release")}
              description={text("백업, 마이그레이션, 업데이트 점검을 한 묶음으로 정리했습니다.", "Backup, migration, and update checks are grouped together.")}
            >
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
              <UpdatePanel />
            </CompactSection>
            <CompactSection
              title={text("원격 접근", "Remote access")}
              description={text("접속 토큰과 호스트/포트 설정을 한 묶음으로 관리합니다.", "Token plus host/port settings are grouped together.")}
            >
              <RemoteAccessForm
                value={activeDraft.remoteAccess}
                onChange={(patch) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, ...patch })}
              />
              <AuthTokenPanel
                authEnabled={activeDraft.remoteAccess.authEnabled}
                authToken={activeDraft.remoteAccess.authToken}
                onGenerated={(token) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, authToken: token })}
              />
            </CompactSection>
          </div>
        )
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{pickUiText(uiLanguage, "설정", "Settings")}</div>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">{pageTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
            {pageDescription}
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

      <div className="mt-6">
        <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5">
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

  if (tabId === "yeonjang") {
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

function CompactSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-stone-900">{title}</div>
        {description ? <div className="mt-1 text-xs leading-5 text-stone-500">{description}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

const CHANNEL_PROVIDER_CATALOG = [
  { channelId: "telegram:primary", provider: "telegram", label: "Telegram", connectionMode: "bot_api", riskLevel: "low" },
  { channelId: "slack:primary", provider: "slack", label: "Slack", connectionMode: "socket", riskLevel: "low" },
  { channelId: "discord:primary", provider: "discord", label: "Discord", connectionMode: "socket", riskLevel: "medium" },
  { channelId: "google_chat:primary", provider: "google_chat", label: "Google Chat", connectionMode: "webhook", riskLevel: "medium" },
  { channelId: "imessage:local", provider: "imessage", label: "iMessage Local Bridge", connectionMode: "local_bridge", riskLevel: "experimental" },
  { channelId: "kakaotalk:official", provider: "kakaotalk", label: "KakaoTalk Business", connectionMode: "webhook", riskLevel: "medium" },
  { channelId: "kakaotalk:local", provider: "kakaotalk", label: "KakaoTalk Local Bridge", connectionMode: "local_bridge", riskLevel: "experimental" },
] as const

function buildCatalogChannel(item: typeof CHANNEL_PROVIDER_CATALOG[number]): ChannelConnectionSummary {
  const isLocalBridge = item.connectionMode === "local_bridge"
  const isWebhook = item.connectionMode === "webhook"
  return {
    channelId: item.channelId,
    connectionId: item.channelId,
    provider: item.provider,
    displayName: item.label,
    enabled: false,
    configured: false,
    connectionMode: item.connectionMode,
    health: {
      status: "stopped",
      message: isLocalBridge ? "Local bridge consent required." : isWebhook ? "Provider adapter is not configured yet." : null,
      checkedAt: Date.now(),
    },
    runtime: {
      isRunning: false,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastError: null,
      lastErrorAt: null,
    },
    riskLevel: item.riskLevel,
    capabilitySummary: {
      supportsThreads: isWebhook,
      supportsReplies: true,
      supportsButtons: isWebhook,
      supportsFiles: true,
      supportsTypingIndicator: false,
      maxMessageLength: 4000,
      requiresWebhook: isWebhook,
      requiresLocalBridge: isLocalBridge,
      requiresUserSession: isLocalBridge,
      manualConfirmationRequired: isLocalBridge,
    },
    validation: {
      ok: !isLocalBridge,
      issues: isLocalBridge
        ? [{
          code: "local_bridge_risk_ack_required",
          severity: "warning",
          message: "Local bridge providers require explicit user consent before enablement.",
        }]
        : isWebhook
          ? [{
            code: "webhook_boundary_adapter_required",
            severity: "warning",
            message: "Webhook providers require adapter-side request verification.",
          }]
          : [],
    },
  }
}

function channelStatusClass(status: string): string {
  switch (status) {
    case "healthy":
    case "delivered":
    case "succeeded":
    case "approved_once":
    case "approved_run":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "failed":
    case "denied":
      return "border-red-200 bg-red-50 text-red-700"
    case "degraded":
    case "pending":
    case "requested":
    case "stopped":
      return "border-amber-200 bg-amber-50 text-amber-800"
    case "suppressed":
    case "consumed":
    case "expired":
      return "border-stone-200 bg-stone-100 text-stone-600"
    default:
      return "border-blue-200 bg-blue-50 text-blue-700"
  }
}

function riskClass(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "medium":
      return "border-blue-200 bg-blue-50 text-blue-700"
    case "high":
    case "experimental":
      return "border-amber-200 bg-amber-50 text-amber-800"
    default:
      return "border-stone-200 bg-stone-100 text-stone-600"
  }
}

function formatChannelTimestamp(value: number | null | undefined): string {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

function stringifyCompact(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isRetryableChannelMessage(message: ChannelMessageItem): boolean {
  if (!message.deliveryKey) return false
  if (message.status === "delivered" || message.status === "succeeded" || message.status === "suppressed") return false
  if (message.eventKind === "delivery_finalized" || message.eventKind === "final_answer_delivered") return false
  return true
}

function ChannelManagementPanel({
  channels,
  selectedChannelId,
  detail,
  messages,
  approvals,
  loading,
  detailLoading,
  error,
  actionMessage,
  actionId,
  localBridgeConsent,
  draftChannels,
  onSelect,
  onRefresh,
  onAction,
  onConsentChange,
  onDraftChannelsChange,
  onApprovalRespond,
  onRetryDelivery,
}: {
  channels: ChannelConnectionSummary[]
  selectedChannelId: string
  detail: ChannelConnectionDetail | null
  messages: ChannelMessageItem[]
  approvals: ChannelApprovalItem[]
  loading: boolean
  detailLoading: boolean
  error: string
  actionMessage: string
  actionId: string | null
  localBridgeConsent: boolean
  draftChannels: SetupChannelDraft
  onSelect: (channelId: string) => void
  onRefresh: () => void
  onAction: (action: "enable" | "disable" | "restart" | "test") => void
  onConsentChange: (value: boolean) => void
  onDraftChannelsChange: (patch: Partial<SetupChannelDraft>) => void
  onApprovalRespond: (approvalId: string, decision: "allow_once" | "allow_run" | "deny") => void
  onRetryDelivery: (deliveryId: string) => void
}) {
  const { text, displayText } = useUiI18n()
  const channelById = useMemo(() => new Map(channels.map((channel) => [channel.channelId, channel])), [channels])
  const rows = useMemo(
    () => CHANNEL_PROVIDER_CATALOG.map((item) => channelById.get(item.channelId) ?? buildCatalogChannel(item)),
    [channelById],
  )
  const selected = detail ?? rows.find((channel) => channel.channelId === selectedChannelId) ?? rows[0]
  const provider = selected?.provider ?? "telegram"
  const providerMessages = messages
    .filter((message) => message.channel === provider || message.source === provider)
    .slice(0, 8)
  const visibleMessages = providerMessages.length ? providerMessages : messages.slice(0, 8)
  const visibleApprovals = approvals.slice(0, 8)
  const lastInbound = messages.find((message) => (message.channel === provider || message.source === provider) && message.eventKind === "ingress_received")
  const lastOutbound = messages.find((message) =>
    (message.channel === provider || message.source === provider)
    && Boolean(message.eventKind && /(delivered|delivery|sent|final)/i.test(message.eventKind)),
  )
  const unsupportedIssues = selected?.validation.issues.filter((issue) => /unsupported|missing|duplicate|webhook|local_bridge|runtime/i.test(issue.code)) ?? []
  const isTelegram = selected?.provider === "telegram"
  const isSlack = selected?.provider === "slack"
  const isDiscord = selected?.provider === "discord"
  const isGoogleChat = selected?.provider === "google_chat"
  const requiresLocalBridge = selected?.capabilitySummary.requiresLocalBridge === true
  const canEnable = Boolean(selected) && (isTelegram || isSlack || isDiscord || isGoogleChat || requiresLocalBridge)
  const selectedActionPrefix = selected ? `${selected.channelId}:` : ""

  return (
    <div className="space-y-4">
      <CompactSection
        title={text("채널 연결", "Channel connections")}
        description={text("모든 provider를 같은 목록에서 보고, 선택한 provider만 편집합니다.", "Review every provider in one list and edit only the selected provider.")}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <div className="grid gap-2 sm:grid-cols-2 xl:w-[420px] xl:grid-cols-1">
            {rows.map((channel) => (
              <button
                key={channel.channelId}
                type="button"
                onClick={() => onSelect(channel.channelId)}
                className={`rounded-xl border px-4 py-3 text-left transition ${channel.channelId === selectedChannelId ? "border-stone-900 bg-white shadow-sm" : "border-stone-200 bg-stone-50 hover:bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-stone-900">{channel.displayName}</div>
                    <div className="mt-1 truncate text-xs text-stone-500">{channel.provider} · {channel.connectionMode}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${riskClass(channel.riskLevel)}`}>
                    {channel.riskLevel}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${channelStatusClass(channel.health.status)}`}>
                    {channel.health.status}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${channel.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-white text-stone-600"}`}>
                    {channel.enabled ? text("활성", "Enabled") : text("비활성", "Disabled")}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${channel.configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    {channel.configured ? text("설정됨", "Configured") : text("미설정", "Unconfigured")}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 space-y-3 rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-stone-900">{selected?.displayName ?? "-"}</div>
                <div className="mt-1 text-xs text-stone-500">{selected?.channelId ?? selectedChannelId}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={loading || detailLoading}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading || detailLoading ? text("불러오는 중", "Loading") : text("새로고침", "Refresh")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction(selected?.enabled ? "disable" : "enable")}
                  disabled={!selected || (!selected.enabled && !canEnable) || Boolean(actionId)}
                  className="rounded-xl border border-stone-200 bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionId === `${selectedActionPrefix}${selected?.enabled ? "disable" : "enable"}`
                    ? text("처리 중", "Working")
                    : selected?.enabled ? text("비활성화", "Disable") : text("활성화", "Enable")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction("restart")}
                  disabled={!selected?.enabled || Boolean(actionId)}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("재시작", "Restart")}
                </button>
                <button
                  type="button"
                  onClick={() => onAction("test")}
                  disabled={!selected?.enabled || Boolean(actionId)}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {text("테스트", "Test")}
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {displayText(error)}
              </div>
            ) : null}
            {actionMessage ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                {displayText(actionMessage)}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-4">
              <MetricTile label={text("런타임", "Runtime")} value={selected?.runtime.isRunning ? text("연결", "Connected") : text("중지", "Stopped")} />
              <MetricTile label={text("Health", "Health")} value={selected?.health.status ?? "-"} />
              <MetricTile label={text("마지막 수신", "Last inbound")} value={formatChannelTimestamp(lastInbound?.createdAt)} />
              <MetricTile label={text("마지막 발신", "Last outbound")} value={formatChannelTimestamp(lastOutbound?.createdAt)} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="text-xs font-semibold text-stone-500">{text("Capability", "Capability")}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    ["threads", selected?.capabilitySummary.supportsThreads],
                    ["replies", selected?.capabilitySummary.supportsReplies],
                    ["buttons", selected?.capabilitySummary.supportsButtons],
                    ["files", selected?.capabilitySummary.supportsFiles],
                    ["typing", selected?.capabilitySummary.supportsTypingIndicator],
                    ["local", selected?.capabilitySummary.requiresLocalBridge],
                    ["manual", selected?.capabilitySummary.manualConfirmationRequired],
                  ].map(([label, active]) => (
                    <span key={String(label)} className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-white text-stone-500"}`}>
                      {String(label)}
                    </span>
                  ))}
                  <span className="rounded-full border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-500">
                    max {selected?.capabilitySummary.maxMessageLength ?? "-"}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="text-xs font-semibold text-stone-500">{text("진단", "Diagnostics")}</div>
                <div className="mt-2 space-y-2">
                  {unsupportedIssues.length === 0 ? (
                    <div className="text-xs text-stone-500">{text("표시할 운영 이슈가 없습니다.", "No operational issues to show.")}</div>
                  ) : unsupportedIssues.map((issue) => (
                    <div key={issue.code} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${issue.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      <span className="font-semibold">{issue.code}</span>: {displayText(issue.message)}
                    </div>
                  ))}
                  {selected?.runtime.lastError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                      {displayText(selected.runtime.lastError)}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <ProviderCredentialSection
              selected={selected}
              draftChannels={draftChannels}
              localBridgeConsent={localBridgeConsent}
              onConsentChange={onConsentChange}
              onDraftChannelsChange={onDraftChannelsChange}
            />
          </div>
        </div>
      </CompactSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <CompactSection
          title={text("메시지 Ledger", "Message ledger")}
          description={text("채널 메시지와 delivery receipt를 같은 목록으로 봅니다.", "Channel messages and delivery receipts are shown together.")}
        >
          <div className="space-y-2">
            {visibleMessages.length === 0 ? (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-sm text-stone-500">
                {text("표시할 채널 메시지가 없습니다.", "No channel messages to show.")}
              </div>
            ) : visibleMessages.map((message) => (
              <div key={`${message.type}:${message.id}`} className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${channelStatusClass(message.status ?? message.role ?? "unknown")}`}>
                        {message.status ?? message.role ?? message.type}
                      </span>
                      <span className="text-xs font-semibold text-stone-700">{message.channel ?? message.source ?? "-"}</span>
                    </div>
                    <div className="mt-2 text-xs text-stone-500">{formatChannelTimestamp(message.createdAt)}</div>
                  </div>
                  {isRetryableChannelMessage(message) ? (
                    <button
                      type="button"
                      onClick={() => message.deliveryKey ? onRetryDelivery(message.deliveryKey) : undefined}
                      disabled={Boolean(actionId)}
                      className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {text("재시도", "Retry")}
                    </button>
                  ) : null}
                </div>
                <CollapsibleText
                  value={message.summary || `${message.eventKind ?? message.type} ${message.id}`}
                  showMoreLabel={text("전체 보기", "Show all")}
                  showLessLabel={text("줄이기", "Collapse")}
                  threshold={140}
                  clampLines={2}
                  className="mt-3 text-sm leading-6 text-stone-700"
                />
                {message.detail ? (
                  <CollapsibleText
                    value={stringifyCompact(message.detail)}
                    showMoreLabel={text("상세 보기", "Show detail")}
                    showLessLabel={text("상세 줄이기", "Collapse detail")}
                    threshold={180}
                    clampLines={3}
                    className="mt-2 rounded-xl bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-600"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </CompactSection>

        <CompactSection
          title={text("Approval Center", "Approval center")}
          description={text("채널 action과 WebUI action을 같은 approval 상태로 확인합니다.", "Channel actions and WebUI actions share the same approval state.")}
        >
          <div className="space-y-2">
            {visibleApprovals.length === 0 ? (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-sm text-stone-500">
                {text("표시할 approval이 없습니다.", "No approvals to show.")}
              </div>
            ) : visibleApprovals.map((approval) => (
              <div key={approval.id} className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${channelStatusClass(approval.status)}`}>
                        {approval.status}
                      </span>
                      <span className="text-xs font-semibold text-stone-700">{approval.channel}</span>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${riskClass(approval.riskLevel)}`}>
                        {approval.riskLevel}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-stone-900">{approval.toolName}</div>
                    <div className="mt-1 text-xs text-stone-500">{formatChannelTimestamp(approval.requestedAt)}</div>
                  </div>
                  {approval.status === "requested" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onApprovalRespond(approval.id, "allow_once")}
                        disabled={Boolean(actionId)}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {text("1회 승인", "Allow once")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onApprovalRespond(approval.id, "deny")}
                        disabled={Boolean(actionId)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {text("거부", "Deny")}
                      </button>
                    </div>
                  ) : null}
                </div>
                <CollapsibleText
                  value={stringifyCompact(approval.paramsPreview)}
                  showMoreLabel={text("파라미터 보기", "Show params")}
                  showLessLabel={text("파라미터 줄이기", "Collapse params")}
                  threshold={160}
                  clampLines={3}
                  className="mt-3 rounded-xl bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-600"
                />
              </div>
            ))}
          </div>
        </CompactSection>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className="mt-2 truncate text-sm font-semibold text-stone-900" title={value}>{value}</div>
    </div>
  )
}

function ProviderCredentialSection({
  selected,
  draftChannels,
  localBridgeConsent,
  onConsentChange,
  onDraftChannelsChange,
}: {
  selected: ChannelConnectionSummary | ChannelConnectionDetail | undefined
  draftChannels: SetupChannelDraft
  localBridgeConsent: boolean
  onConsentChange: (value: boolean) => void
  onDraftChannelsChange: (patch: Partial<SetupChannelDraft>) => void
}) {
  const { text } = useUiI18n()
  if (!selected) return null

  if (selected.provider === "telegram") {
    return (
      <div className="space-y-3">
        <TelegramSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <TelegramCheckPanel botToken={draftChannels.botToken} />
      </div>
    )
  }

  if (selected.provider === "slack") {
    return (
      <div className="space-y-3">
        <SlackSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <SlackCheckPanel botToken={draftChannels.slackBotToken} appToken={draftChannels.slackAppToken} />
      </div>
    )
  }

  if (selected.provider === "discord") {
    return (
      <div className="space-y-3">
        <DiscordSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600">
          {text("Discord 진단은 저장 후 채널 상세의 Diagnostics 영역에서 bot token, application id, public key, intent, permission, guild install 상태로 표시됩니다.", "After saving, Discord diagnostics appear above as bot token, application id, public key, intent, permission, and guild install checks.")}
        </div>
      </div>
    )
  }

  if (selected.provider === "google_chat") {
    return (
      <div className="space-y-3">
        <GoogleChatSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600">
          {text("Google Chat 진단은 저장 후 채널 상세의 Diagnostics 영역에서 credential, request verification, Workspace 배포, scope, space 접근 상태로 표시됩니다.", "After saving, Google Chat diagnostics appear above as credential, request verification, Workspace deployment, scope, and space access checks.")}
        </div>
      </div>
    )
  }

  if (selected.provider === "imessage") {
    return (
      <div className="space-y-3">
        <IMessageLocalBridgeSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <div className="rounded-xl border border-amber-200 bg-white p-4 text-sm leading-6 text-amber-900">
          {text("iMessage는 서버 bot 채널이 아니라 macOS 사용자 세션의 Messages.app 자동화 경로입니다. 저장 후 Diagnostics에서 앱 접근, 세션, 자동화 권한, 허용 수신자 상태를 확인합니다.", "iMessage is a macOS user-session automation path, not a server bot channel. After saving, diagnostics show app access, session, automation permission, and allowed recipient status.")}
          <label className="mt-3 flex items-center gap-3 font-medium">
            <input
              type="checkbox"
              checked={localBridgeConsent}
              onChange={(event) => onConsentChange(event.target.checked)}
            />
            {text("활성화 버튼에 사용할 위험 확인 동의", "Risk acknowledgement for the enable button")}
          </label>
        </div>
      </div>
    )
  }

  if (selected.provider === "kakaotalk") {
    const isLocalBridge = selected.capabilitySummary.requiresLocalBridge
    return (
      <div className="space-y-3">
        <KakaoTalkSettingsForm value={draftChannels} onChange={onDraftChannelsChange} />
        <div className="rounded-xl border border-amber-200 bg-white p-4 text-sm leading-6 text-amber-900">
          {isLocalBridge
            ? text("KakaoTalk local bridge는 개인/데스크톱 앱 자동화 경로이며 experimental로 취급합니다. 허용 사용자/방, 수동 확인, rate limit, 감사 로그를 함께 적용해야 합니다.", "KakaoTalk local bridge is a personal desktop app automation path and is treated as experimental. Allowed users/rooms, manual confirmation, rate limits, and audit must stay enabled together.")
            : text("KakaoTalk Business는 공식 API 경로입니다. local bridge 권한과 별개로 business API 사용, 채널 ID, API key가 필요합니다.", "KakaoTalk Business is the official API path. It requires business API enablement, a channel ID, and an API key separate from local bridge permissions.")}
          {isLocalBridge ? (
            <label className="mt-3 flex items-center gap-3 font-medium">
              <input
                type="checkbox"
                checked={localBridgeConsent}
                onChange={(event) => onConsentChange(event.target.checked)}
              />
              {text("활성화 버튼에 사용할 위험 확인 동의", "Risk acknowledgement for the enable button")}
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  if (selected.capabilitySummary.requiresLocalBridge) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="text-sm font-semibold text-amber-900">{selected.displayName}</div>
        <div className="mt-2 text-sm leading-6 text-amber-800">
          {text("로컬 브리지 채널은 사용자 세션과 명시적 동의가 필요합니다.", "Local bridge channels require a user session and explicit consent.")}
        </div>
        <label className="mt-3 flex items-center gap-3 text-sm font-medium text-amber-900">
          <input
            type="checkbox"
            checked={localBridgeConsent}
            onChange={(event) => onConsentChange(event.target.checked)}
          />
          {text("위험을 확인하고 활성화 요청을 허용합니다.", "I acknowledge the risk and allow enablement.")}
        </label>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Provider", "Provider")}</label>
        <input className="input" value={selected.provider} readOnly />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("연결 방식", "Connection mode")}</label>
        <input className="input" value={selected.connectionMode} readOnly />
      </div>
      <div className="md:col-span-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
        {text("이 provider는 credential section이 아직 연결되지 않았습니다. API/adapter 구현 후 같은 shell 안에서 편집됩니다.", "This provider does not have a connected credential section yet. It will be edited in this same shell after the API/adapter is implemented.")}
      </div>
    </div>
  )
}

function OrchestrationSettingsPanel({
  value,
  runtime,
  loading,
  saving,
  dirty,
  error,
  message,
  onChange,
  onSave,
  onCancel,
  onRefresh,
}: {
  value: OrchestrationSettingsDraft | null
  runtime: StatusResponse["orchestration"] | null
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string
  message: string
  onChange: (patch: Partial<OrchestrationSettingsDraft>) => void
  onSave: () => void
  onCancel: () => void
  onRefresh: () => void
}) {
  const { text, displayText } = useUiI18n()
  const draft = value ?? DEFAULT_ORCHESTRATION_SETTINGS
  const canSave = Boolean(value) && dirty && !loading && !saving
  const runtimeTone = runtime?.mode === "orchestration"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : runtime?.status === "degraded"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-stone-200 bg-white text-stone-700"
  const requestedButBlocked = draft.mode === "orchestration" && !draft.featureFlagEnabled

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className={`rounded-2xl border px-4 py-3 ${runtimeTone}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{text("현재 모드", "Current mode")}</div>
          <div className="mt-2 text-sm font-semibold">{runtime?.mode ?? "-"}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("요청 모드", "Requested")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{runtime?.requestedMode ?? draft.mode}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("실행자 노드", "Executor nodes")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{runtime?.activeSubAgentCount ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Feature flag</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{draft.featureFlagEnabled ? "on" : "off"}</div>
        </div>
      </div>

      {runtime?.reason ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
          {displayText(runtime.reason)}
        </div>
      ) : null}
      {requestedButBlocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {text("오케스트레이션 모드를 선택했지만 feature flag가 꺼져 있으면 단일 노비로 동작합니다.", "Orchestration mode falls back to single Nobie while the feature flag is off.")}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
          {message}
        </div>
      ) : null}
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
        {text("위임 작업 수와 대상 실행자는 요청 내용, 저장된 토폴로지 연결, 각 노드의 이름과 성격을 기준으로 자동 결정됩니다.", "Delegated task count and target executors are decided automatically from the request, saved topology connections, and each node's name and definition.")}
      </div>
      {runtime?.reasonCode === "no_active_sub_agents" ? (
        <div
          className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800"
          data-testid="orchestration-topology-guidance"
        >
          {text(
            "토폴로지 화면에서 노드를 추가한 뒤 저장하면 이 화면의 활성 에이전트에 바로 반영됩니다. 저장하지 않은 캔버스 변경은 런타임 실행자 목록에 포함되지 않습니다.",
            "Add nodes in the topology screen and save; they will be reflected here as active agents. Unsaved canvas changes are not included in the runtime executor list.",
          )}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("실행 모드", "Execution mode")}</label>
          <select
            className="input"
            value={draft.mode}
            disabled={loading || saving}
            onChange={(event) => onChange({ mode: event.target.value as OrchestrationMode })}
          >
            <option value="single_nobie">{text("단일 노비", "Single Nobie")}</option>
            <option value="orchestration">{text("토폴로지 노드 사용", "Use topology nodes")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">Feature flag</label>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => onChange({ featureFlagEnabled: !draft.featureFlagEnabled })}
            className={`flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${draft.featureFlagEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-stone-50 text-stone-600"}`}
          >
            <span>{draft.featureFlagEnabled ? "enabled" : "disabled"}</span>
            <span className={`h-5 w-9 rounded-full p-0.5 ${draft.featureFlagEnabled ? "bg-emerald-500" : "bg-stone-300"}`}>
              <span className={`block h-4 w-4 rounded-full bg-white transition ${draft.featureFlagEnabled ? "translate-x-4" : ""}`} />
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || saving}
          className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("불러오는 중...", "Loading...") : text("새로고침", "Refresh")}
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={!dirty || loading || saving}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {text("취소", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${dirty ? "bg-stone-900 text-white" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}
          >
            {saving ? text("저장 중...", "Saving...") : dirty ? text("저장", "Save") : text("저장됨", "Saved")}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatMetric(value: number | null): string {
  return value == null ? "-" : String(value)
}

function MemoryQualityDashboardPanel({
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  snapshot: MemoryQualitySnapshot | null
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  const { text, displayText } = useUiI18n()
  const visibleScopes = snapshot?.scopes.filter((scope) => scope.documents > 0 || scope.chunks > 0 || scope.accessCount > 0 || scope.lastFailure) ?? []
  const statusClass = snapshot?.status === "degraded"
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700"

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("메모리 품질 대시보드", "Memory quality dashboard")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text(
              "scope별 저장량, 임베딩 누락, 오래된 항목, 검색 지연, writeback 실패를 한 번에 확인합니다.",
              "Inspect scope counts, missing embeddings, stale items, retrieval latency, and writeback failures in one place.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {snapshot ? (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
              {snapshot.status}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? text("불러오는 중", "Loading") : text("새로고침", "Refresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("문서", "Documents")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.totals.documents ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">chunks {snapshot?.totals.chunks ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("임베딩 누락", "Missing embeddings")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.totals.missingEmbeddings ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">stale {snapshot?.totals.staleEmbeddings ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Flash Feedback</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.flashFeedback.active ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">high {snapshot?.flashFeedback.highSeverityActive ?? 0} · expired {snapshot?.flashFeedback.expired ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Writeback</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">pending {snapshot?.writeback.pending ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">failed {snapshot?.writeback.failed ?? 0} · completed {snapshot?.writeback.completed ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("학습/복원", "Learning/restore")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">pending {snapshot?.learningHistory.pendingReview ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">
            auto {snapshot?.learningHistory.autoApplied ?? 0} · history {snapshot?.learningHistory.historyVersions ?? 0} · restore {snapshot?.learningHistory.restoreEvents ?? 0}
          </div>
        </div>
      </div>

      {snapshot?.lastFailure ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {text("최근 실패", "Last failure")}: {displayText(snapshot.lastFailure)}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-stone-500">{text("검색 정책", "Retrieval policy")}</div>
          <div className="text-xs text-stone-500">
            {text("fast path는 장기/벡터 조회를 막고 즉시 응답을 우선합니다.", "Fast path blocks long-term/vector retrieval and prioritizes immediate response.")}
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {text("fast path budget", "Fast path budget")}: {snapshot?.retrievalPolicy.fastPathBudget.maxChunks ?? 0} chunks / {snapshot?.retrievalPolicy.fastPathBudget.maxChars ?? 0} chars
          </div>
          <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {text("normal budget", "Normal budget")}: {snapshot?.retrievalPolicy.normalBudget.maxChunks ?? 4} chunks / {snapshot?.retrievalPolicy.normalBudget.maxChars ?? 2200} chars
          </div>
          <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
            schedule default: {snapshot?.retrievalPolicy.scheduleMemoryDefaultInjection ? "on" : "off"}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.9fr_0.9fr_0.9fr] gap-2 border-b border-stone-200 bg-stone-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          <span>scope</span>
          <span>docs</span>
          <span>chunks</span>
          <span>missing</span>
          <span>p95 ms</span>
          <span>failure</span>
        </div>
        {(visibleScopes.length ? visibleScopes : snapshot?.scopes.slice(0, 7) ?? []).map((scope) => (
          <div key={scope.scope} className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.9fr_0.9fr_0.9fr] gap-2 border-b border-stone-100 px-4 py-2 text-xs text-stone-600 last:border-b-0">
            <span className="font-semibold text-stone-900">{scope.scope}</span>
            <span>{scope.documents}</span>
            <span>{scope.chunks}</span>
            <span className={scope.missingEmbeddings > 0 ? "font-semibold text-amber-700" : ""}>{scope.missingEmbeddings}</span>
            <span>{formatMetric(scope.p95RetrievalLatencyMs)}</span>
            <span className="truncate" title={scope.lastFailure ?? ""}>{scope.lastFailure ? displayText(scope.lastFailure) : "-"}</span>
          </div>
        ))}
      </div>
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
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
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
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
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
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
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

function AdvancedScheduleStatusPanel({
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
  const nextRuns = snapshot?.nextRuns ?? []

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("스케줄 상태", "Schedule status")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text("예약 실행 상태, 활성 예약 수, 다음 실행 예정 작업을 확인합니다.", "Inspect scheduler health, active job count, and upcoming scheduled runs.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? text("확인 중", "Checking") : text("새로고침", "Refresh")}
          </button>
          <Link to="/advanced/schedules" className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700">
            {text("스케줄 화면 열기", "Open schedules")}
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("상태", "Status")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.schedulerRunning ? text("실행 중", "Running") : text("중지됨", "Stopped")}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("활성 예약", "Active jobs")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.activeJobs ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("다음 실행", "Upcoming")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{nextRuns.length}</div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="grid grid-cols-[1fr_1fr] gap-2 border-b border-stone-200 bg-stone-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          <span>{text("이름", "Name")}</span>
          <span>{text("다음 실행", "Next run")}</span>
        </div>
        {nextRuns.length ? nextRuns.slice(0, 8).map((item) => (
          <div key={`${item.scheduleId}-${item.nextRunAt}`} className="grid grid-cols-[1fr_1fr] gap-2 border-b border-stone-100 px-4 py-2 text-xs text-stone-600 last:border-b-0">
            <span className="truncate font-semibold text-stone-900" title={displayText(item.name)}>{displayText(item.name)}</span>
            <span>{new Date(item.nextRunAt).toLocaleString()}</span>
          </div>
        )) : (
          <div className="px-4 py-6 text-sm text-stone-500">{text("예정된 실행이 없습니다.", "There are no upcoming scheduled runs.")}</div>
        )}
      </div>
    </div>
  )
}
