import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { DisabledPanel } from "../components/DisabledPanel"
import { PlannedState } from "../components/PlannedState"
import { AuthTokenPanel } from "../components/setup/AuthTokenPanel"
import { McpSetupForm } from "../components/setup/McpSetupForm"
import { MqttSettingsForm } from "../components/setup/MqttSettingsForm"
import { PersonalSettingsForm } from "../components/setup/PersonalSettingsForm"
import { RemoteAccessForm } from "../components/setup/RemoteAccessForm"
import { ReviewSummaryPanel } from "../components/setup/ReviewSummaryPanel"
import { SecuritySettingsForm } from "../components/setup/SecuritySettingsForm"
import { SkillSetupForm } from "../components/setup/SkillSetupForm"
import { SingleAIConnectionPanel } from "../components/setup/SingleAIConnectionPanel"
import { SetupAssistPanel } from "../components/setup/SetupAssistPanel"
import { SetupExpandableSection } from "../components/setup/SetupExpandableSection"
import { SetupChecksPanel } from "../components/setup/SetupChecksPanel"
import { SetupStepShell } from "../components/setup/SetupStepShell"
import { SetupSyncStatus } from "../components/setup/SetupSyncStatus"
import { TelegramSettingsForm } from "../components/setup/TelegramSettingsForm"
import { TelegramCheckPanel } from "../components/setup/TelegramCheckPanel"
import { type AIBackendCard, type NewAIBackendInput, type RoutingProfile } from "../contracts/ai"
import type { FeatureCapability } from "../contracts/capabilities"
import type { SetupDraft, SetupState, SetupStepMeta } from "../contracts/setup"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "../lib/single-ai"
import {
  canSkipSetupStep,
  hasEditableSetupStep,
  isSetupStepDirty,
  mergeSetupStepDraft,
  revertSetupStepDraft,
  validateSetupStep,
} from "../lib/setupFlow"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useSetupStore } from "../stores/setup"
import { pickUiText, useUiLanguageStore, type UiLanguage } from "../stores/uiLanguage"

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

function createDraftId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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

export function SetupPage() {
  const [localDraft, setLocalDraft] = useState<SetupDraft | null>(null)
  const [selectedAiBackendId, setSelectedAiBackendId] = useState<string | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  const uiLanguage = useUiLanguageStore((state) => state.language)
  const [testingMcpServerId, setTestingMcpServerId] = useState<string | null>(null)
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null)
  const capabilities = useCapabilitiesStore((state) => state.items)
  const capabilityCounts = useCapabilitiesStore((state) => state.counts)
  const {
    state,
    draft,
    checks,
    checksLoading,
    saving,
    lastSavedAt,
    lastError,
    setStep,
    completeSetup,
    refreshChecks,
    resetSetup,
    saveDraftSnapshot,
  } = useSetupStore()

  useEffect(() => {
    setLocalDraft(cloneDraft(draft))
  }, [draft])

  const activeDraft = localDraft ?? draft

  useEffect(() => {
    setSelectedAiBackendId((current) => getPreferredSingleAiBackendId(activeDraft.aiBackends, current))
  }, [activeDraft])

  const steps = useMemo(() => createSetupSteps(capabilities, activeDraft, state, uiLanguage), [capabilities, activeDraft, state, uiLanguage])
  const currentStep = steps.find((step) => step.id === state.currentStep) ?? steps[0]!
  const currentIndex = steps.findIndex((step) => step.id === state.currentStep)
  const nextStepMeta = currentIndex >= 0 ? steps[Math.min(currentIndex + 1, steps.length - 1)] ?? null : null
  const prevStepMeta = currentIndex > 0 ? steps[currentIndex - 1] ?? null : null
  const enabledBackends = activeDraft.aiBackends.filter((backend) => backend.enabled)
  const configuredBackends = activeDraft.aiBackends.filter((backend) => backend.endpoint?.trim() || backend.defaultModel.trim())
  const currentValidation = useMemo(() => validateSetupStep(state.currentStep, activeDraft), [state.currentStep, activeDraft])
  const mcpEnabledCount = activeDraft.mcp.servers.filter((server) => server.enabled).length
  const mcpRequiredCount = activeDraft.mcp.servers.filter((server) => server.required).length
  const mcpReadyCount = activeDraft.mcp.servers.filter((server) => server.status === "ready").length
  const skillEnabledCount = activeDraft.skills.items.filter((item) => item.enabled).length
  const skillRequiredCount = activeDraft.skills.items.filter((item) => item.required).length
  const skillReadyCount = activeDraft.skills.items.filter((item) => item.status === "ready").length
  const hasEditableCurrentStep = hasEditableSetupStep(state.currentStep)
  const currentStepDirty = hasEditableCurrentStep && isSetupStepDirty(draft, activeDraft, state.currentStep)
  const canSkipCurrentStep = canSkipSetupStep(state.currentStep) && !currentStep.required && !saving
  const isReview = state.currentStep === "review"
  const isDone = state.currentStep === "done"
  const canSaveCurrentStep = hasEditableCurrentStep && currentStepDirty && currentValidation.valid && !saving
  const canGoNext = !isDone && !nextStepMeta?.locked && currentValidation.valid && !saving
  const canComplete = isReview && currentValidation.valid && !saving
  const completionErrorMessage = isReview && !saving ? formatSetupCompletionError(lastError) : ""
  const shouldShowValidation = showValidation || currentStepDirty

  function patchDraft<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
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
        status: input.availableModels.length > 0 && input.defaultModel.trim() ? "ready" : "disabled",
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

  function setRoutingTargetEnabled(profileId: RoutingProfile["id"], backendId: string, enabled: boolean) {
    void profileId
    setLocalDraft((current) => setSingleAiBackendEnabled(cloneDraft(current ?? draft), backendId, enabled))
  }

  function updateMcpServer(serverId: string, patch: Partial<SetupDraft["mcp"]["servers"][number]>) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        mcp: {
          servers: base.mcp.servers.map((server) => (server.id === serverId ? { ...server, ...patch } : server)),
        },
      }
    })
  }

  function addMcpServer() {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        mcp: {
          servers: [
            ...base.mcp.servers,
            {
              id: createDraftId("mcp"),
              name: "",
              transport: "stdio",
              command: "",
              argsText: "",
              cwd: "",
              url: "",
              required: false,
              enabled: true,
              status: "disabled",
              tools: [],
            },
          ],
        },
      }
    })
  }

  function removeMcpServer(serverId: string) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        mcp: {
          servers: base.mcp.servers.filter((server) => server.id !== serverId),
        },
      }
    })
  }

  async function handleTestMcpServer(serverId: string) {
    const server = activeDraft.mcp.servers.find((item) => item.id === serverId)
    if (!server) return
    setTestingMcpServerId(serverId)
    try {
      const result = await api.testMcpServer(server)
      updateMcpServer(serverId, {
        status: "ready",
        reason: result.message,
        tools: result.tools,
      })
    } catch (error) {
      updateMcpServer(serverId, {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        tools: [],
      })
    } finally {
      setTestingMcpServerId(null)
    }
  }

  function updateSkillItem(skillId: string, patch: Partial<SetupDraft["skills"]["items"][number]>) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        skills: {
          items: base.skills.items.map((item) => (item.id === skillId ? { ...item, ...patch } : item)),
        },
      }
    })
  }

  function addSkillItem() {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        skills: {
          items: [
            ...base.skills.items,
            {
              id: createDraftId("skill"),
              label: "",
              description: "",
              source: "local",
              path: "",
              enabled: true,
              required: false,
              status: "disabled",
            },
          ],
        },
      }
    })
  }

  function removeSkillItem(skillId: string) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        skills: {
          items: base.skills.items.filter((item) => item.id !== skillId),
        },
      }
    })
  }

  async function handleTestSkillItem(skillId: string) {
    const item = activeDraft.skills.items.find((entry) => entry.id === skillId)
    if (!item || item.source !== "local") return
    setTestingSkillId(skillId)
    try {
      const result = await api.testSkillPath(item.path)
      updateSkillItem(skillId, {
        path: result.resolvedPath ?? item.path,
        status: "ready",
        reason: result.message,
      })
    } catch (error) {
      updateSkillItem(skillId, {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTestingSkillId(null)
    }
  }

  async function handleReset() {
    const confirmed = window.confirm("로컬 config와 setup 상태를 기본값으로 복원합니다. 계속할까요?")
    if (!confirmed) return
    await resetSetup()
    setShowValidation(false)
  }

  async function persistCurrentStep(): Promise<boolean> {
    if (!hasEditableCurrentStep || !currentStepDirty) {
      return true
    }

    if (!currentValidation.valid) {
      setShowValidation(true)
      return false
    }

    const nextDraft = mergeSetupStepDraft(draft, activeDraft, state.currentStep)
    const success = await saveDraftSnapshot(nextDraft, {
      syncTelegramRuntime: state.currentStep === "channels",
    })

    if (success) {
      setLocalDraft(nextDraft)
      setShowValidation(false)
    }

    return success
  }

  function handleCancelCurrentStep() {
    if (!hasEditableCurrentStep) return
    setLocalDraft(revertSetupStepDraft(activeDraft, draft, state.currentStep))
    setShowValidation(false)
  }

  async function moveToStep(stepId: SetupState["currentStep"]) {
    if (stepId === state.currentStep) return
    const success = await persistCurrentStep()
    if (!success) return
    setShowValidation(false)
    setStep(stepId)
  }

  async function handleNext() {
    if (isReview) {
      setShowValidation(true)
      if (!currentValidation.valid) return
      await completeSetup()
      return
    }

    if (!nextStepMeta || nextStepMeta.locked) {
      setShowValidation(true)
      return
    }

    const success = await persistCurrentStep()
    if (!success) return
    setShowValidation(false)
    setStep(nextStepMeta.id)
  }

  async function handlePrevious() {
    if (!prevStepMeta) return
    const success = await persistCurrentStep()
    if (!success) return
    setShowValidation(false)
    setStep(prevStepMeta.id)
  }

  function handleSkip() {
    if (!canSkipCurrentStep || !nextStepMeta) return
    setLocalDraft(revertSetupStepDraft(activeDraft, draft, state.currentStep))
    setShowValidation(false)
    setStep(nextStepMeta.id)
  }

  function renderBody() {
    switch (state.currentStep) {
      case "welcome":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="처음 설정을 시작합니다"
              description="왼쪽 단계 목록을 따라가며 필수 항목부터 채우면 Nobie를 바로 사용할 수 있습니다. 이 화면에서는 저장 위치와 현재 연결 상태를 먼저 확인합니다."
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="현재 단계" value={state.completed ? "설정 완료" : "환영"} />
              <StatCard label="설정된 AI" value={String(configuredBackends.length)} />
              <StatCard label="사용 중 AI" value={String(enabledBackends.length)} />
              <StatCard label="채널 준비" value={activeDraft.channels.botToken.trim() ? "입력됨" : "미입력"} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl border border-stone-200 bg-white p-6">
                <div className="text-sm font-semibold text-stone-900">시작 전에 확인할 점</div>
                <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                  <ChecklistItem text="AI 연결은 필수입니다. 연결 주소와 기본 모델을 정해야 실제 응답 테스트가 가능합니다." />
                  <ChecklistItem text="대화 채널은 마지막에 연결합니다. 앞 단계에서 저장된 값을 바탕으로 연결 확인을 진행합니다." />
                  <ChecklistItem text="오른쪽 상태 패널에서 현재 저장 상태와 연결 상태를 함께 확인할 수 있습니다." />
                </div>
              </div>
              <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
            </div>
            <SetupExpandableSection
              title="고급 상태 보기"
              description="처음 사용하는 경우에는 펼치지 않아도 됩니다. 현재 시스템 기능 준비 상태를 보고 싶을 때만 확인하세요."
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Ready" value={String(capabilityCounts.ready)} />
                <StatCard label="Disabled" value={String(capabilityCounts.disabled)} />
                <StatCard label="Planned" value={String(capabilityCounts.planned)} />
                <StatCard label="Error" value={String(capabilityCounts.error)} />
              </div>
            </SetupExpandableSection>
          </div>
        )

      case "personal":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="사용자 기본 정보를 적습니다"
              description="Nobie가 누구를 도와야 하는지, 어떤 언어와 시간대를 기준으로 움직여야 하는지 먼저 정합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="이름" value={activeDraft.personal.profileName.trim() || "미입력"} />
              <StatCard label="표시 이름" value={activeDraft.personal.displayName.trim() || "미입력"} />
              <StatCard label="기본 언어" value={activeDraft.personal.language.trim() || "미선택"} />
              <StatCard label="시간대" value={activeDraft.personal.timezone.trim() || "미선택"} />
            </div>
            <PersonalSettingsForm
              value={activeDraft.personal}
              onChange={(patch) => patchDraft("personal", { ...activeDraft.personal, ...patch })}
              errors={shouldShowValidation ? {
                profileName: currentValidation.fieldErrors.profileName,
                displayName: currentValidation.fieldErrors.displayName,
                language: currentValidation.fieldErrors.language,
                timezone: currentValidation.fieldErrors.timezone,
                workspace: currentValidation.fieldErrors.workspace,
              } : undefined}
            />
          </div>
        )

      case "ai_backends":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="AI 연결을 준비합니다"
              description="여기서는 AI 하나만 연결하면 됩니다. 연결할 공급자를 고르고, 인증과 기본 모델만 확인하면 나머지는 같은 연결을 계속 사용합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="활성 AI" value={enabledBackends[0]?.label ?? "없음"} compact />
              <StatCard label="활성 모델" value={enabledBackends[0]?.defaultModel || "미설정"} compact />
              <StatCard label="주소 입력됨" value={String(activeDraft.aiBackends.filter((backend) => backend.endpoint?.trim()).length)} />
              <StatCard label="준비 상태" value={enabledBackends.length === 1 ? "ready" : "select 1"} compact />
            </div>
            <SingleAIConnectionPanel
              backends={activeDraft.aiBackends}
              routingProfiles={activeDraft.routingProfiles}
              activeBackendId={selectedAiBackendId}
              onSelectBackend={setSelectedAiBackendId}
              onUpdateBackend={updateBackend}
              onToggleBackend={(backendId, enabled) => setRoutingTargetEnabled("default", backendId, enabled)}
              onRemoveBackend={removeBackend}
              onSetRoutingTargetEnabled={setRoutingTargetEnabled}
              backendErrors={shouldShowValidation ? currentValidation.backendErrors : undefined}
            />
          </div>
        )

      case "mcp":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="외부 기능 연결을 준비합니다"
              description="Nobie가 외부 프로그램의 도구를 쓰려면 MCP 서버를 연결해야 합니다. 먼저 서버를 추가하고 연결 확인을 진행합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="등록된 MCP" value={String(activeDraft.mcp.servers.length)} />
              <StatCard label="사용 중" value={String(mcpEnabledCount)} />
              <StatCard label="필수 서버" value={String(mcpRequiredCount)} />
              <StatCard label="연결 확인 완료" value={String(mcpReadyCount)} />
            </div>
            {currentStep.reason ? <RuntimeNotice tone={currentStep.status === "error" ? "error" : "info"} title="MCP 상태" message={currentStep.reason} /> : null}
            <RuntimeNotice
              tone={currentValidation.valid ? "info" : "error"}
              title="필수 확장 안내"
              message={currentValidation.valid
                ? "필수로 표시한 MCP 서버는 연결 확인까지 끝나야 다음 단계로 이동할 수 있습니다."
                : currentValidation.summary[0] ?? "MCP 연결 상태를 다시 확인해 주세요."}
            />
            <McpSetupForm
              value={activeDraft.mcp}
              onChange={(next) => patchDraft("mcp", next)}
              onTest={(serverId) => void handleTestMcpServer(serverId)}
              testingServerId={testingMcpServerId}
              errors={shouldShowValidation ? currentValidation.mcpErrors : undefined}
            />
            <SetupExpandableSection
              title="고급 MCP 안내"
              description="처음 사용하는 경우에는 펼치지 않아도 됩니다. 연결 방식과 필수 서버 동작을 더 자세히 보고 싶을 때만 확인하세요."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                  <div className="font-semibold text-stone-900">연결 방식</div>
                  <div className="mt-2">지금은 <span className="font-medium">stdio</span> 방식만 바로 사용할 수 있습니다. HTTP 방식은 준비 상태로만 보이며 저장은 가능하지만 연결 확인은 통과하지 않습니다.</div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                  <div className="font-semibold text-stone-900">필수 서버 규칙</div>
                  <div className="mt-2">필수로 표시한 서버는 끌 수 없고, 연결 확인이 끝나기 전에는 다음 단계로 넘어갈 수 없습니다.</div>
                </div>
              </div>
            </SetupExpandableSection>
          </div>
        )

      case "skills":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="작업 능력을 확장합니다"
              description="반복적으로 필요한 지침이나 로컬 Skill을 연결해 Nobie가 더 잘 일하도록 준비하는 단계입니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="등록된 Skill" value={String(activeDraft.skills.items.length)} />
              <StatCard label="사용 중" value={String(skillEnabledCount)} />
              <StatCard label="필수 Skill" value={String(skillRequiredCount)} />
              <StatCard label="확인 완료" value={String(skillReadyCount)} />
            </div>
            <RuntimeNotice
              tone={currentValidation.valid ? "info" : "error"}
              title="필수 확장 안내"
              message={currentValidation.valid
                ? "필수로 표시한 Skill은 활성화 상태여야 하고, 로컬 Skill은 경로 확인까지 끝나야 다음 단계로 이동할 수 있습니다."
                : currentValidation.summary[0] ?? "Skill 설정을 다시 확인해 주세요."}
            />
            <SkillSetupForm
              value={activeDraft.skills}
              onChange={(next) => patchDraft("skills", next)}
              onTest={(skillId) => void handleTestSkillItem(skillId)}
              testingSkillId={testingSkillId}
              errors={shouldShowValidation ? currentValidation.skillErrors : undefined}
            />
            <SetupExpandableSection
              title="고급 Skill 안내"
              description="처음 사용하는 경우에는 펼치지 않아도 됩니다. Skill 종류와 필수 Skill 규칙을 더 자세히 보고 싶을 때만 확인하세요."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                  <div className="font-semibold text-stone-900">로컬 Skill</div>
                  <div className="mt-2">내 컴퓨터에 있는 Skill 폴더나 파일을 연결하는 방식입니다. 경로 확인이 끝나야 준비 완료로 바뀝니다.</div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                  <div className="font-semibold text-stone-900">필수 Skill 규칙</div>
                  <div className="mt-2">필수 Skill은 꺼둘 수 없고, 필요한 상태 확인이 끝나지 않으면 다음 단계로 넘어갈 수 없습니다.</div>
                </div>
              </div>
            </SetupExpandableSection>
          </div>
        )

      case "security":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="안전 규칙을 정합니다"
              description="Nobie가 파일을 읽거나 실행할 때 얼마나 자주 확인을 받을지 정합니다. 기본값으로 시작해도 됩니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <SecuritySettingsForm
              value={activeDraft.security}
              onChange={(patch) => patchDraft("security", { ...activeDraft.security, ...patch })}
              errors={shouldShowValidation ? {
                approvalTimeout: currentValidation.fieldErrors.approvalTimeout,
                maxDelegationTurns: currentValidation.fieldErrors.maxDelegationTurns,
              } : undefined}
            />
          </div>
        )

      case "channels":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="대화 채널을 연결합니다"
              description="메신저에서 Nobie와 대화하려면 채널 정보를 입력하고 연결 확인을 해야 합니다. 현재는 Telegram을 우선 지원합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="준비된 채널" value={activeDraft.channels.botToken.trim() ? "1" : "0"} />
              <StatCard label="사용 중 채널" value={activeDraft.channels.telegramEnabled ? "1" : "0"} />
              <StatCard label="지금 연결 가능" value="Telegram" />
              <StatCard label="추가 예정" value="Slack" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-stone-900">Telegram</div>
                    <div className="mt-1 text-sm leading-6 text-stone-600">지금 바로 연결해서 Nobie와 대화할 수 있는 메신저 채널입니다.</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${currentStep.status === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : activeDraft.channels.telegramEnabled && activeDraft.channels.botToken.trim()
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-stone-200 bg-stone-100 text-stone-700"}`}>
                    {currentStep.status === "error"
                      ? "오류"
                      : activeDraft.channels.telegramEnabled && activeDraft.channels.botToken.trim()
                        ? "준비됨"
                        : "미설정"}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-stone-900">Slack</div>
                    <div className="mt-1 text-sm leading-6 text-stone-600">회사나 팀용 메신저 연결을 위한 준비 영역입니다. 이번 단계에서는 입력 구조만 먼저 보여줍니다.</div>
                  </div>
                  <div className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                    예정
                  </div>
                </div>
              </div>
            </div>
            {currentStep.status === "error" && currentStep.reason ? (
              <RuntimeNotice tone="error" title="Telegram 런타임 오류" message={currentStep.reason} />
            ) : currentStep.reason ? (
              <RuntimeNotice tone="info" title="Telegram 상태" message={currentStep.reason} />
            ) : null}
            <TelegramSettingsForm
              value={activeDraft.channels}
              onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
              errors={shouldShowValidation ? {
                telegramEnabled: currentValidation.fieldErrors.telegramEnabled,
                botToken: currentValidation.fieldErrors.botToken,
              } : undefined}
            />
            <TelegramCheckPanel botToken={activeDraft.channels.botToken} />
            <SetupExpandableSection
              title="Slack 준비 보기"
              description="아직 실제 연결은 준비 중입니다. 나중에 어떤 정보를 입력하게 될지 먼저 확인할 수 있습니다."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">봇 토큰 (Bot Token)</label>
                  <input className="input" disabled placeholder="Slack 연결 단계에서 입력합니다" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">앱 토큰 (App Token)</label>
                  <input className="input" disabled placeholder="Slack 연결 단계에서 입력합니다" />
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
                Slack은 입력 구조와 설명만 먼저 보여주고, 실제 연결과 런타임 시작은 다음 단계에서 구현합니다.
              </div>
            </SetupExpandableSection>
          </div>
        )

      case "remote_access":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="원격 접근을 선택합니다"
              description="다른 기기에서 Nobie 설정 화면에 들어올 수 있게 하는 기능입니다. 지금 꼭 필요하지 않다면 나중에 설정해도 됩니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            {currentStep.status === "planned" ? (
              <PlannedState
                title="Remote Access"
                description={currentStep.reason ?? "이 단계는 아직 계획 단계입니다."}
              />
            ) : currentStep.reason ? (
              <DisabledPanel title="Remote Access" reason={currentStep.reason} />
            ) : null}
            <SetupExpandableSection
              title="고급 원격 접근 설정"
              description="다른 기기에서 접속해야 할 때만 펼쳐서 설정하세요. 대부분의 사용자는 나중에 설정해도 됩니다."
              defaultOpen
            >
              <div className="space-y-6">
                <RemoteAccessForm
                  value={activeDraft.remoteAccess}
                  onChange={(patch) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, ...patch })}
                  errors={shouldShowValidation ? {
                    authToken: currentValidation.fieldErrors.authToken,
                    host: currentValidation.fieldErrors.host,
                    port: currentValidation.fieldErrors.port,
                  } : undefined}
                />
                <MqttSettingsForm
                  value={activeDraft.mqtt}
                  onChange={(patch) => patchDraft("mqtt", { ...activeDraft.mqtt, ...patch })}
                  errors={shouldShowValidation ? {
                    enabled: currentValidation.fieldErrors.mqttEnabled,
                    host: currentValidation.fieldErrors.mqttHost,
                    port: currentValidation.fieldErrors.mqttPort,
                    username: currentValidation.fieldErrors.mqttUsername,
                    password: currentValidation.fieldErrors.mqttPassword,
                  } : undefined}
                />
                <AuthTokenPanel
                  authEnabled={activeDraft.remoteAccess.authEnabled}
                  authToken={activeDraft.remoteAccess.authToken}
                  onGenerated={(token) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, authToken: token })}
                />
              </div>
            </SetupExpandableSection>
          </div>
        )

      case "review":
        return (
          <div className="space-y-6">
            <SectionIntro
              title="입력한 내용을 한 번 더 확인합니다"
              description="필수 항목이 모두 채워졌는지 확인하고, 잘못된 값이 있으면 해당 단계로 돌아가 수정합니다."
            />
            {showValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            {completionErrorMessage ? (
              <RuntimeNotice tone="error" title="설정 완료에 실패했습니다" message={completionErrorMessage} />
            ) : null}
            <ReviewSummaryPanel
              draft={activeDraft}
              reviewMessages={currentValidation.summary}
              onSelectStep={(stepId) => {
                void moveToStep(stepId)
              }}
            />
            <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
          </div>
        )

      case "done":
        return (
          <div className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white p-8">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Completed</div>
            <h2 className="mt-3 text-3xl font-semibold text-stone-900">설정이 끝났습니다</h2>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              이제 Nobie를 사용할 준비가 끝났습니다. 대시보드로 이동하거나 Run Monitor에서 현재 상태를 바로 확인할 수 있습니다.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <StatCard label="완료 상태" value={state.completed ? "completed" : state.currentStep} />
              <StatCard label="완료 시각" value={formatCompletedAt(state.completedAt)} />
              <StatCard label="사용 중 AI" value={String(enabledBackends.length)} />
              <StatCard label="설정된 AI" value={String(configuredBackends.length)} />
              <StatCard label="Config File" value={checks?.configFile ?? ""} compact />
              <StatCard label="Setup State" value={checks?.setupStateFile ?? ""} compact />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              {state.completed ? (
                <Link
                  to="/dashboard"
                  className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  대시보드로 이동
                </Link>
              ) : (
                <button
                  onClick={() => void completeSetup()}
                  className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  {pickUiText(uiLanguage, "설정 완료", "Finish Setup")}
                </button>
              )}
              <Link
                to="/runs"
                className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700"
              >
                Run Monitor 보기
              </Link>
            </div>
          </div>
        )
    }
  }

  return (
    <SetupStepShell
      title={pickUiText(uiLanguage, "처음 설정", "Initial Setup")}
      description={pickUiText(uiLanguage, "필수 단계부터 차례대로 입력하면 Nobie를 바로 사용할 수 있습니다.", "Complete the required steps in order to start using Nobie quickly.")}
      steps={steps}
      currentStep={state.currentStep}
      onSelectStep={(stepId) => {
        const targetStep = steps.find((step) => step.id === stepId)
        if (!targetStep || targetStep.locked) return
        void moveToStep(stepId as typeof state.currentStep)
      }}
      language={uiLanguage}
      assistPanel={(
        <SetupAssistPanel
          currentStep={currentStep}
          currentIndex={Math.max(currentIndex, 0)}
          totalSteps={steps.length}
          checks={checks}
          lastSavedAt={lastSavedAt}
          lastError={lastError}
        />
      )}
      footer={(
        <div className="space-y-4">
          <SetupSyncStatus saving={saving} lastSavedAt={lastSavedAt} lastError={lastError} />
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-1 text-xs text-stone-500">
              <div>
                Step {String(currentIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
              </div>
              {currentStepDirty ? <div className="text-blue-700">{pickUiText(uiLanguage, "현재 단계에 저장되지 않은 변경사항이 있습니다.", "There are unsaved changes in this step.")}</div> : null}
              {nextStepMeta && nextStepMeta.locked && !isReview && !isDone ? (
                <div className="text-amber-700">{nextStepMeta.lockReason ?? pickUiText(uiLanguage, "필수 단계를 먼저 완료해야 합니다.", "Complete the required step first.")}</div>
              ) : null}
              {showValidation && currentValidation.summary.length > 0 ? (
                <div className="text-red-600">{currentValidation.summary[0]}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              {!isDone ? (
                <button
                  onClick={() => void handleReset()}
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700"
                >
                  {pickUiText(uiLanguage, "기본값 복원", "Reset")}
                </button>
              ) : null}
              {currentIndex > 0 && !isDone ? (
                <button
                  onClick={() => void handlePrevious()}
                  disabled={saving}
                  className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pickUiText(uiLanguage, "이전", "Back")}
                </button>
              ) : null}
              {hasEditableCurrentStep && !isDone ? (
                <button
                  onClick={handleCancelCurrentStep}
                  disabled={!currentStepDirty || saving}
                  className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pickUiText(uiLanguage, "취소", "Cancel")}
                </button>
              ) : null}
              {canSkipCurrentStep ? (
                <button
                  onClick={handleSkip}
                  disabled={saving}
                  className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pickUiText(uiLanguage, "건너뛰기", "Skip")}
                </button>
              ) : null}
              {hasEditableCurrentStep && !isDone ? (
                <button
                  onClick={() => void persistCurrentStep()}
                  disabled={!canSaveCurrentStep}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pickUiText(uiLanguage, "저장", "Save")}
                </button>
              ) : null}
              {isReview ? (
                <button
                  onClick={() => void handleNext()}
                  disabled={!canComplete}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                    canComplete ? "bg-stone-900 text-white" : "cursor-not-allowed bg-stone-200 text-stone-500"
                  }`}
                >
                  설정 완료
                </button>
              ) : !isDone ? (
                <button
                  onClick={() => void handleNext()}
                  disabled={!canGoNext}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                    canGoNext
                      ? "bg-stone-900 text-white"
                      : "cursor-not-allowed bg-stone-200 text-stone-500"
                  }`}
                >
                  {pickUiText(uiLanguage, "다음", "Next")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    >
      {renderBody()}
    </SetupStepShell>
  )
}

function StatCard({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-2 font-semibold text-stone-900 ${compact ? "break-all text-sm leading-6" : "text-2xl"}`}>{value}</div>
    </div>
  )
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-stone-900" />
      <div>{text}</div>
    </div>
  )
}

function SectionIntro({ title, description = "" }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold text-stone-900">{title}</h2>
      {description.trim() ? <p className="mt-2 text-sm leading-7 text-stone-600">{description}</p> : null}
    </div>
  )
}

function ValidationNotice({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
      <div className="font-semibold">필수 입력을 먼저 확인해 주세요</div>
      <ul className="mt-2 space-y-1 leading-6">
        {messages.map((message) => (
          <li key={message}>- {message}</li>
        ))}
      </ul>
    </div>
  )
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
  const toneClass = tone === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-blue-200 bg-blue-50 text-blue-700"

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm leading-6">{message}</div>
    </div>
  )
}

function createSetupSteps(
  capabilities: FeatureCapability[],
  draft: SetupDraft,
  state: SetupState,
  language: UiLanguage,
): SetupStepMeta[] {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const telegramCapability = capabilities.find((item) => item.key === "telegram.channel")
  const hasPersonalInfo = validateSetupStep("personal", draft).valid
  const hasConfiguredBackend = validateSetupStep("ai_backends", draft).valid
  const hasConfiguredMcpServers = draft.mcp.servers.length > 0
  const hasMcpReady = validateSetupStep("mcp", draft).valid
  const hasConfiguredSkills = draft.skills.items.length > 0
  const hasSkillsReady = validateSetupStep("skills", draft).valid
  const hasSecurityDefaults = validateSetupStep("security", draft).valid
  const hasTelegramChannel = validateSetupStep("channels", draft).valid
  const hasRemoteAccess = validateSetupStep("remote_access", draft).valid

  const steps: SetupStepMeta[] = [
    {
      id: "welcome",
      label: t("환영", "Welcome"),
      description: t("설정 흐름과 현재 상태를 먼저 확인합니다.", "Review the setup flow and current status first."),
      status: "ready",
      required: false,
      highlights: [
        t("설정 전체 흐름을 한 번에 확인합니다.", "Review the full setup flow at a glance."),
        t("로컬 저장 위치와 연결 상태를 먼저 살펴봅니다.", "Check the local storage path and connection status first."),
        t("필수 단계가 무엇인지 확인한 뒤 다음으로 이동합니다.", "Confirm which steps are required before moving on."),
      ],
      completed: state.currentStep !== "welcome" || state.completed,
      locked: false,
    },
    {
      id: "personal",
      label: t("개인 정보", "Personal"),
      description: t("사용자 이름과 기본 작업 환경을 먼저 정합니다.", "Set the user name and default working environment first."),
      status: "ready",
      required: true,
      highlights: [
        t("이름과 표시 이름을 입력합니다.", "Enter the profile name and display name."),
        t("기본 언어와 시간대를 고릅니다.", "Choose the default language and timezone."),
        t("기본 작업 폴더를 지정해 이후 파일 작업 기준값으로 사용합니다.", "Set the default workspace for later file tasks."),
      ],
      completed: hasPersonalInfo,
      locked: false,
    },
    withCapability(
      "ai_backends",
      t("AI 연결", "AI Connection"),
      t("응답과 계획, 검토에 사용할 AI 연결 하나를 정합니다.", "Choose the single AI connection used for responses, planning, and review."),
      capabilities.find((item) => item.key === "ai.backends"),
      true,
      [
        t("사용할 AI 공급자 하나를 고릅니다.", "Choose one AI provider."),
        t("인증, 연결 주소, 기본 모델을 확인합니다.", "Confirm the credentials, endpoint, and default model."),
        t("연결 확인으로 실제 동작 여부를 검증합니다.", "Verify that the connection really works."),
      ],
      hasConfiguredBackend,
    ),
    withCapability(
      "mcp",
      t("외부 기능 연결 (MCP)", "External Tools (MCP)"),
      t("외부 도구와 기능을 Nobie에 연결합니다.", "Connect external tools and capabilities to Nobie."),
      capabilities.find((item) => item.key === "mcp.client"),
      false,
      [
        t("연결할 MCP 서버를 추가합니다.", "Add the MCP servers to connect."),
        t("실행 명령과 연결 방식을 입력합니다.", "Enter the launch command and transport."),
        t("연결 확인 후 도구 목록을 확인합니다.", "Verify the connection and review the tool list."),
      ],
      hasConfiguredMcpServers ? hasMcpReady : true,
    ),
    {
      id: "skills",
      label: t("작업 능력 확장 (Skill)", "Skills"),
      description: t("작업 지침과 보조 능력을 등록합니다.", "Register helper instructions and extra abilities."),
      status: hasConfiguredSkills ? (hasSkillsReady ? "ready" : "disabled") : "ready",
      reason: hasConfiguredSkills && !hasSkillsReady ? t("등록한 Skill의 상태를 다시 확인해야 합니다.", "Check the registered skill status again.") : undefined,
      required: false,
      highlights: [
        t("로컬 Skill 또는 기본 Skill을 등록합니다.", "Add local or built-in skills."),
        t("필요한 Skill만 켜고 설명을 정리합니다.", "Enable only the needed skills and keep descriptions clear."),
        t("로컬 Skill은 경로 확인을 통해 준비 상태를 확인합니다.", "Verify local skill paths before using them."),
      ],
      completed: hasConfiguredSkills ? hasSkillsReady : true,
      locked: false,
    },
    withCapability(
      "security",
      t("보안", "Security"),
      t("실행 전 확인 방식과 안전 규칙을 정합니다.", "Set approval and safety rules before execution."),
      capabilities.find((item) => item.key === "settings.control"),
      false,
      [
        t("파일 실행이나 도구 사용 전에 얼마나 자주 확인받을지 정합니다.", "Set how often Nobie should ask before using tools or files."),
        t("자동 후속 처리 횟수 같은 기본 안전값을 확인합니다.", "Review safety defaults like the auto follow-up limit."),
        t("처음에는 기본값을 유지해도 됩니다.", "Keeping the defaults is fine at first."),
      ],
      hasSecurityDefaults,
    ),
    withSetupChannelCapability(
      "channels",
      t("대화 채널 (Communication)", "Communication"),
      t("메신저에서 Nobie와 대화할 채널을 연결합니다.", "Connect the messaging channels used to talk with Nobie."),
      telegramCapability,
      draft.channels,
      true,
      [
        t("Telegram 같은 메신저 연결 정보를 입력합니다.", "Enter channel details such as Telegram."),
        t("연결 확인으로 실제 동작 여부를 검사합니다.", "Verify that the channel really works."),
        t("메신저에서 Nobie와 대화할 준비를 마칩니다.", "Finish preparing the chat channel."),
      ],
      hasTelegramChannel,
      language,
    ),
    withCapability(
      "remote_access",
      t("원격 접근", "Remote Access"),
      t("다른 기기에서 설정 화면에 들어오게 할지 선택합니다.", "Choose whether other devices can open the setup screen."),
      capabilities.find((item) => item.key === "settings.control"),
      false,
      [
        t("다른 기기에서 접속해야 할 때만 설정합니다.", "Configure this only if you need access from another device."),
        t("인증 토큰과 MQTT 접속 정보를 확인합니다.", "Review the auth token and MQTT access details."),
        t("지금 필요 없다면 나중에 설정해도 됩니다.", "You can skip it for now and configure it later."),
      ],
      hasRemoteAccess,
    ),
    {
      id: "review",
      label: t("검토", "Review"),
      description: t("입력한 값을 한 번 더 확인합니다.", "Review the entered values once more."),
      status: "ready",
      required: false,
      highlights: [
        t("입력한 값이 맞는지 한 번 더 확인합니다.", "Confirm that the entered values look correct."),
        t("빠진 필수 항목이 있으면 해당 단계로 돌아갑니다.", "Return to the matching step if a required field is missing."),
        t("이상이 없으면 설정 완료를 진행합니다.", "Finish setup if everything looks good."),
      ],
      completed: state.completed,
      locked: false,
    },
    {
      id: "done",
      label: t("완료", "Done"),
      description: t("설정을 끝내고 Nobie를 사용합니다.", "Finish setup and start using Nobie."),
      status: "ready",
      required: false,
      highlights: [
        t("최종 저장 결과를 확인합니다.", "Review the final saved result."),
        t("대시보드로 이동해 현재 상태를 봅니다.", "Open the dashboard to check the current status."),
        t("이후 채팅과 자동화 기능을 시작할 수 있습니다.", "Start using chat and automation afterwards."),
      ],
      completed: state.completed,
      locked: !state.completed,
      lockReason: state.completed ? undefined : t("먼저 검토 단계를 마치고 설정 완료를 진행해야 합니다.", "Finish the review step before completing setup."),
    },
  ]

  return applyStepLocks(steps, language)
}

function withCapability(
  id: SetupStepMeta["id"],
  label: string,
  description: string,
  capability: FeatureCapability | undefined,
  required: boolean,
  highlights: string[],
  completed: boolean,
): SetupStepMeta {
  return {
    id,
    label,
    description,
    status: capability?.status ?? "planned",
    reason: capability?.reason,
    required,
    highlights,
    completed,
    locked: false,
  }
}

function withSetupChannelCapability(
  id: SetupStepMeta["id"],
  label: string,
  description: string,
  capability: FeatureCapability | undefined,
  channels: { telegramEnabled: boolean; botToken: string },
  required: boolean,
  highlights: string[],
  completed: boolean,
  language: UiLanguage,
): SetupStepMeta {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)

  if (!capability) {
    return {
      id,
      label,
      description,
      status: "ready",
      required,
      highlights,
      completed,
      locked: false,
    }
  }

  if (capability.status === "error") {
    return {
      id,
      label,
      description,
      status: "error",
      reason: capability.reason,
      required,
      highlights,
      completed,
      locked: false,
    }
  }

  const hasTelegramConfig = Boolean(channels.botToken.trim())
  const reason = hasTelegramConfig && channels.telegramEnabled && capability.reason?.includes("런타임이 시작되지 않았습니다.")
    ? t("Telegram 정보는 저장되었습니다. 런타임 시작 상태는 채널 상세에서 확인할 수 있습니다.", "Telegram details are saved. Check the channel details for runtime status.")
    : undefined

  return {
    id,
    label,
    description,
    status: "ready",
    reason,
    required,
    highlights,
    completed,
    locked: false,
  }
}

function applyStepLocks(steps: SetupStepMeta[], language: UiLanguage): SetupStepMeta[] {
  let firstRequiredGap: SetupStepMeta | null = null

  return steps.map((step) => {
    if (!firstRequiredGap && step.required && !step.completed) {
      firstRequiredGap = step
    }

    if (!firstRequiredGap || step.id === firstRequiredGap.id || step.id === "welcome") {
      return step
    }

    return {
      ...step,
      locked: true,
      lockReason: pickUiText(language, `먼저 '${firstRequiredGap.label}' 단계를 완료해야 합니다.`, `Complete the '${firstRequiredGap.label}' step first.`),
    }
  })
}

function formatSetupCompletionError(value: string): string {
  const message = value.trim()
  if (!message) return ""

  const lower = message.toLowerCase()
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("auth")) {
    return "권한 또는 인증 정보가 맞지 않아 설정 완료를 마치지 못했습니다. 입력한 토큰과 로그인 정보를 다시 확인해 주세요."
  }
  if (lower.includes("telegram") || lower.includes("token")) {
    return "채널 연결 정보에 문제가 있어 설정 완료를 마치지 못했습니다. Telegram 토큰과 연결 상태를 다시 확인해 주세요."
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused") || lower.includes("connect")) {
    return "로컬 서비스 연결에 실패했습니다. Nobie gateway가 실행 중인지 확인한 뒤 다시 시도해 주세요."
  }
  return "설정을 완료하지 못했습니다. " + message
}

function formatCompletedAt(value?: number): string {
  if (!value) return ""
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
}
