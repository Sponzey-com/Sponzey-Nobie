import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api, type MqttRuntimeResponse } from "../api/client"
import { ActiveInstructionsPanel } from "../components/ActiveInstructionsPanel"
import { McpServersPanel } from "../components/McpServersPanel"
import { CapabilityBadge } from "../components/CapabilityBadge"
import { PlannedState } from "../components/PlannedState"
import { AuthTokenPanel } from "../components/setup/AuthTokenPanel"
import { BackendComposer } from "../components/setup/BackendComposer"
import { BackendHealthCard } from "../components/setup/BackendHealthCard"
import { MqttRuntimePanel } from "../components/setup/MqttRuntimePanel"
import { MqttSettingsForm } from "../components/setup/MqttSettingsForm"
import { RemoteAccessForm } from "../components/setup/RemoteAccessForm"
import { RoutingPriorityEditor } from "../components/setup/RoutingPriorityEditor"
import { SecuritySettingsForm } from "../components/setup/SecuritySettingsForm"
import { SetupChecksPanel } from "../components/setup/SetupChecksPanel"
import { SetupSyncStatus } from "../components/setup/SetupSyncStatus"
import { TelegramSettingsForm } from "../components/setup/TelegramSettingsForm"
import { TelegramCheckPanel } from "../components/setup/TelegramCheckPanel"
import { UpdatePanel } from "../components/UpdatePanel"
import { UiLanguageSwitcher } from "../components/UiLanguageSwitcher"
import { BUILTIN_BACKEND_IDS, isBuiltinBackendId, type AIBackendCard, type NewAIBackendInput, type RoutingProfile } from "../contracts/ai"
import type { SetupDraft } from "../contracts/setup"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useSetupStore } from "../stores/setup"
import { useUiI18n } from "../lib/ui-i18n"
import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"

type TabId = "backends" | "routing" | "security" | "channels" | "mqtt" | "remote" | "advanced"

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
  const [editorVersion, setEditorVersion] = useState(0)
  const [mqttRuntime, setMqttRuntime] = useState<MqttRuntimeResponse | null>(null)
  const [mqttRuntimeLoading, setMqttRuntimeLoading] = useState(false)
  const [mqttRuntimeError, setMqttRuntimeError] = useState("")
  const [disconnectingExtensionId, setDisconnectingExtensionId] = useState<string | null>(null)
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

  useEffect(() => {
    if (tab !== "mqtt") return
    void loadMqttRuntime()
    const timer = window.setInterval(() => {
      void loadMqttRuntime()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [tab, editorVersion, loadMqttRuntime])

  const tabs = useMemo(
    () => [
      { id: "backends" as const, label: pickUiText(uiLanguage, "AI 연결", "AI Backends"), capabilityKey: "ai.backends" },
      { id: "routing" as const, label: pickUiText(uiLanguage, "AI 순서", "AI Routing"), capabilityKey: "ai.routing" },
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
    await saveDraftSnapshot(activeDraft, { syncTelegramRuntime: channelsDirty })
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
    if (isBuiltinBackendId(backendId)) return
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

  function moveRoutingTarget(profileId: RoutingProfile["id"], from: number, to: number) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        routingProfiles: base.routingProfiles.map((profile) => {
          if (profile.id !== profileId) return profile
          const nextTargets = [...profile.targets]
          const source = nextTargets[from]
          if (source === undefined || to < 0 || to >= nextTargets.length) return profile
          nextTargets.splice(from, 1)
          nextTargets.splice(to, 0, source)
          return { ...profile, targets: nextTargets }
        }),
      }
    })
  }

  function setRoutingTargetEnabled(profileId: RoutingProfile["id"], backendId: string, enabled: boolean) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        routingProfiles: base.routingProfiles.map((profile) => {
          if (profile.id !== profileId) return profile
          const hasTarget = profile.targets.includes(backendId)
          if (enabled && !hasTarget) {
            return { ...profile, targets: [...profile.targets, backendId] }
          }
          if (!enabled && hasTarget) {
            return { ...profile, targets: profile.targets.filter((target) => target !== backendId) }
          }
          return profile
        }),
      }
    })
  }

  function syncPrimaryBackendToBuiltinBackends() {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      const source = base.aiBackends.find((backend) => backend.id === "provider:openai")
      if (!source) return base
      return {
        ...base,
        aiBackends: base.aiBackends.map((backend) => {
          if (backend.id === source.id) return backend
          if (!(BUILTIN_BACKEND_IDS as readonly string[]).includes(backend.id)) return backend
          return {
            ...backend,
            providerType: source.providerType,
            authMode: source.authMode,
            credentials: { ...source.credentials },
            local: source.local,
            endpoint: source.endpoint,
            availableModels: [...source.availableModels],
            defaultModel: source.defaultModel,
          }
        }),
      }
    })
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
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pickUiText(uiLanguage, "저장", "Save")}
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
            <BackendComposer onAdd={addBackend} />
            <div className="grid gap-4 xl:grid-cols-2">
              {activeDraft.aiBackends.map((backend) => (
                <BackendHealthCard
                  key={backend.id}
                  backend={backend}
                  routingProfiles={activeDraft.routingProfiles}
                  onChange={updateBackend}
                  onToggle={(backendId, enabled) => updateBackend(backendId, { enabled })}
                  onRemove={removeBackend}
                  onSetRoutingTargetEnabled={setRoutingTargetEnabled}
                  onSyncBuiltinBackends={syncPrimaryBackendToBuiltinBackends}
                />
              ))}
            </div>
          </div>
        )

      case "routing":
        return (
          <div key={`routing-${editorVersion}`} className="grid gap-4 xl:grid-cols-2">
            {activeDraft.routingProfiles.map((profile) => (
              <RoutingPriorityEditor
                key={profile.id}
                profile={profile}
                backends={activeDraft.aiBackends}
                onMove={(from, to) => moveRoutingTarget(profile.id, from, to)}
              />
            ))}
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
              <RuntimeNotice title={text("Telegram 런타임 오류", "Telegram Runtime Error")} message={activeCapability.reason} tone="error" />
            ) : activeCapability?.reason ? (
              <RuntimeNotice title={text("Telegram 상태", "Telegram Status")} message={activeCapability.reason} tone="info" />
            ) : null}
            <TelegramSettingsForm
              value={activeDraft.channels}
              onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
            />
            <TelegramCheckPanel botToken={activeDraft.channels.botToken} />
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
            <UpdatePanel />
            <McpServersPanel />
            <ActiveInstructionsPanel />
            <PlannedState
              title={text("고급 제어", "Advanced Controls")}
              description={text("고급 메모리와 시맨틱 검색 제어면은 이후 단계에서 연결합니다.", "Advanced memory and semantic search controls will be connected in a later phase.")}
            />
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
                    {capability?.reason ? displayText(capability.reason) : capability?.label ?? "Phase 0002"}
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
    if (capability.status === "error") return capability
    const hasTelegramConfig = Boolean(draft.channels.botToken.trim())
    return {
      ...capability,
      status: "ready" as const,
      reason: hasTelegramConfig && draft.channels.telegramEnabled && capability.reason?.includes("런타임이 시작되지 않았습니다.")
        ? "Telegram 정보는 저장되었습니다. 런타임 시작 상태는 채널 상세에서 확인할 수 있습니다."
        : undefined,
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
