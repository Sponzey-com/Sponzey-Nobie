import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { DisabledPanel } from "../components/DisabledPanel"
import { PlannedState } from "../components/PlannedState"
import { AuthTokenPanel } from "../components/setup/AuthTokenPanel"
import { BeginnerVisualizationDeck } from "../components/setup/BeginnerVisualizationDeck"
import { McpServerEditorCard, McpSetupForm } from "../components/setup/McpSetupForm"
import { MqttSettingsForm } from "../components/setup/MqttSettingsForm"
import { PersonalSettingsForm } from "../components/setup/PersonalSettingsForm"
import { RemoteAccessForm } from "../components/setup/RemoteAccessForm"
import { ReviewSummaryPanel } from "../components/setup/ReviewSummaryPanel"
import { RoutingPriorityEditor } from "../components/setup/RoutingPriorityEditor"
import { SecuritySettingsForm } from "../components/setup/SecuritySettingsForm"
import { SkillItemEditorCard, SkillSetupForm } from "../components/setup/SkillSetupForm"
import { SlackCheckPanel } from "../components/setup/SlackCheckPanel"
import { SlackSettingsForm } from "../components/setup/SlackSettingsForm"
import { SingleAIConnectionPanel } from "../components/setup/SingleAIConnectionPanel"
import { SetupAssistPanel } from "../components/setup/SetupAssistPanel"
import { SetupExpandableSection } from "../components/setup/SetupExpandableSection"
import { SetupChecksPanel } from "../components/setup/SetupChecksPanel"
import { SetupStepShell } from "../components/setup/SetupStepShell"
import { SetupSyncStatus } from "../components/setup/SetupSyncStatus"
import { SetupVisualizationCanvas, SetupVisualizationLegend } from "../components/setup/SetupVisualizationCanvas"
import { TelegramSettingsForm } from "../components/setup/TelegramSettingsForm"
import { TelegramCheckPanel } from "../components/setup/TelegramCheckPanel"
import { AI_PROVIDER_OPTIONS, getAIProviderDefaultEndpoint, type AIBackendCard, type AIProviderType, type NewAIBackendInput, type RoutingProfile } from "../contracts/ai"
import type { SetupDraft, SetupState } from "../contracts/setup"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "../lib/single-ai"
import {
  buildBeginnerConnectionCards,
  buildBeginnerSetupSmokeResult,
  buildBeginnerSetupSteps,
  getBeginnerActiveAiBackend,
  markBeginnerAiTestResult,
  sanitizeBeginnerSetupError,
  upsertBeginnerAiBackend,
  type BeginnerConnectionStatus,
  type BeginnerSetupStepId,
} from "../lib/beginner-setup"
import { uiCatalogText } from "../lib/message-catalog"
import {
  canSkipSetupStep,
  hasEditableSetupStep,
  isSetupStepDirty,
  mergeSetupStepDraft,
  revertSetupStepDraft,
  validateSetupStep,
  type BackendCardErrors,
} from "../lib/setupFlow"
import { buildDoneRuntimeSummary, buildReviewReadinessBoard } from "../lib/setup-readiness"
import { createSetupSteps } from "../lib/setup-step-meta"
import {
  buildAdvancedVisualizationState,
  mapAdvancedStepToBeginnerStep,
  resolveAdvancedStepForBeginnerSelection,
} from "../lib/setup-visualization-advanced"
import { applyValidationOverlaysToScene, type VisualizationScene } from "../lib/setup-visualization"
import { buildBeginnerVisualizationDeck } from "../lib/setup-visualization-beginner"
import { buildSetupVisualizationRegistry } from "../lib/setup-visualization-scenes"
import { useCapabilitiesStore } from "../stores/capabilities"
import { useConnectionStore } from "../stores/connection"
import { useSetupStore } from "../stores/setup"
import { pickUiText, useUiLanguageStore, type UiLanguage } from "../stores/uiLanguage"
import { useUiModeStore } from "../stores/uiMode"

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

type SetupChannelId = "webui" | "telegram" | "slack"
type ChannelCheckResult = { ok: boolean; message: string } | null

export function SetupPage() {
  const [localDraft, setLocalDraft] = useState<SetupDraft | null>(null)
  const [selectedAiBackendId, setSelectedAiBackendId] = useState<string | null>(null)
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<SetupChannelId | null>(null)
  const [selectedVisualizationNodeId, setSelectedVisualizationNodeId] = useState<string | null>(null)
  const [aiVisualizationMode, setAiVisualizationMode] = useState<"connections" | "routing">("connections")
  const [responsiveInspectorOpen, setResponsiveInspectorOpen] = useState(false)
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false)
  const [telegramCheckResult, setTelegramCheckResult] = useState<ChannelCheckResult>(null)
  const [slackCheckResult, setSlackCheckResult] = useState<ChannelCheckResult>(null)
  const [showValidation, setShowValidation] = useState(false)
  const uiLanguage = useUiLanguageStore((state) => state.language)
  const uiMode = useUiModeStore((state) => state.mode)
  const uiShell = useUiModeStore((state) => state.shell)
  const [beginnerStepId, setBeginnerStepId] = useState<BeginnerSetupStepId>(() => mapAdvancedStepToBeginnerStep(useSetupStore.getState().state.currentStep))
  const [beginnerAiInput, setBeginnerAiInput] = useState<{
    providerType: AIProviderType
    authMode: "api_key" | "chatgpt_oauth"
    endpoint: string
    defaultModel: string
    apiKey: string
    oauthAuthFilePath: string
  }>({
    providerType: "ollama" as AIProviderType,
    authMode: "api_key",
    endpoint: getAIProviderDefaultEndpoint("ollama"),
    defaultModel: "",
    apiKey: "",
    oauthAuthFilePath: "",
  })
  const [beginnerAiTestOk, setBeginnerAiTestOk] = useState<boolean | null>(null)
  const [beginnerTestingAi, setBeginnerTestingAi] = useState(false)
  const [beginnerNotice, setBeginnerNotice] = useState("")
  const [testingMcpServerId, setTestingMcpServerId] = useState<string | null>(null)
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null)
  const capabilities = useCapabilitiesStore((state) => state.items)
  const capabilityCounts = useCapabilitiesStore((state) => state.counts)
  const runtimeStatus = useConnectionStore((state) => state.status)
  const previousUiModeRef = useRef(uiMode)
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null)
  const navigatorReturnFocusRef = useRef<HTMLElement | null>(null)
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

  useEffect(() => {
    setSelectedMcpServerId((current) => {
      if (current && activeDraft.mcp.servers.some((server) => server.id === current)) return current
      return activeDraft.mcp.servers.find((server) => server.enabled)?.id
        ?? activeDraft.mcp.servers[0]?.id
        ?? null
    })
  }, [activeDraft.mcp.servers])

  useEffect(() => {
    setSelectedSkillId((current) => {
      if (current && activeDraft.skills.items.some((item) => item.id === current)) return current
      return activeDraft.skills.items.find((item) => item.enabled)?.id
        ?? activeDraft.skills.items[0]?.id
        ?? null
    })
  }, [activeDraft.skills.items])

  useEffect(() => {
    setSelectedChannelId((current) => {
      if (current) return current
      if (activeDraft.channels.telegramEnabled || activeDraft.channels.botToken.trim()) return "telegram"
      if (activeDraft.channels.slackEnabled || activeDraft.channels.slackBotToken.trim() || activeDraft.channels.slackAppToken.trim()) return "slack"
      return "webui"
    })
  }, [activeDraft.channels])

  useEffect(() => {
    setTelegramCheckResult(null)
  }, [activeDraft.channels.botToken])

  useEffect(() => {
    setSlackCheckResult(null)
  }, [activeDraft.channels.slackBotToken, activeDraft.channels.slackAppToken])

  useEffect(() => {
    const backend = getBeginnerActiveAiBackend(activeDraft)
    if (!backend) return
    setBeginnerAiInput({
      providerType: backend.providerType,
      authMode: backend.authMode,
      endpoint: backend.endpoint ?? getAIProviderDefaultEndpoint(backend.providerType),
      defaultModel: backend.defaultModel,
      apiKey: backend.credentials.apiKey ?? "",
      oauthAuthFilePath: backend.credentials.oauthAuthFilePath ?? "",
    })
  }, [activeDraft])

  useEffect(() => {
    const previousMode = previousUiModeRef.current
    if (previousMode === uiMode) return
    previousUiModeRef.current = uiMode

    if (uiMode === "beginner") {
      setBeginnerStepId(mapAdvancedStepToBeginnerStep(state.currentStep))
      return
    }

    const nextStep = resolveAdvancedStepForBeginnerSelection(beginnerStepId, state.currentStep)
    if (nextStep !== state.currentStep) {
      setStep(nextStep)
    }
  }, [beginnerStepId, setStep, state.currentStep, uiMode])

  const steps = useMemo(() => createSetupSteps(capabilities, activeDraft, state, uiLanguage), [capabilities, activeDraft, state, uiLanguage])
  const visualizationRegistry = useMemo(
    () => buildSetupVisualizationRegistry({
      draft: activeDraft,
      checks,
      shell: uiShell,
      status: runtimeStatus,
      capabilities,
      state,
      language: uiLanguage,
      includeAdvancedOptionalScenes: uiMode === "advanced",
    }),
    [activeDraft, checks, uiShell, runtimeStatus, capabilities, state, uiLanguage, uiMode],
  )
  const beginnerSteps = useMemo(
    () => buildBeginnerSetupSteps({ draft: activeDraft, checks, shell: uiShell, language: uiLanguage, aiTestOk: beginnerAiTestOk }),
    [activeDraft, checks, uiShell, uiLanguage, beginnerAiTestOk],
  )
  const beginnerConnections = useMemo(
    () => buildBeginnerConnectionCards({ draft: activeDraft, checks, shell: uiShell, language: uiLanguage }),
    [activeDraft, checks, uiShell, uiLanguage],
  )
  const beginnerSmoke = useMemo(
    () => buildBeginnerSetupSmokeResult({ draft: activeDraft, checks, shell: uiShell, language: uiLanguage }),
    [activeDraft, checks, uiShell, uiLanguage],
  )
  const beginnerVisualizationDeck = useMemo(
    () => buildBeginnerVisualizationDeck({
      steps: beginnerSteps,
      connections: beginnerConnections,
      registry: visualizationRegistry,
      selectedStepId: beginnerStepId,
    }),
    [beginnerConnections, beginnerStepId, beginnerSteps, visualizationRegistry],
  )
  const stepContextId: SetupState["currentStep"] = state.currentStep === "ai_routing" ? "ai_backends" : state.currentStep
  const advancedVisualizationState = useMemo(
    () => buildAdvancedVisualizationState({
      registry: visualizationRegistry,
      currentStep: state.currentStep,
    }),
    [state.currentStep, visualizationRegistry],
  )
  const aiRoutingScene = visualizationRegistry.scenesById["scene:ai_routing"] ?? null
  const currentStep = steps.find((step) => step.id === stepContextId) ?? steps[0]!
  const baseCurrentScene = useMemo(() => {
    if (uiMode !== "advanced") {
      const sceneId = visualizationRegistry.sceneIdByStepId[stepContextId]
      return sceneId ? visualizationRegistry.scenesById[sceneId] ?? null : null
    }

    if (stepContextId === "ai_backends" && aiVisualizationMode === "routing" && aiRoutingScene) {
      return aiRoutingScene
    }

    return advancedVisualizationState.scene
  }, [advancedVisualizationState.scene, aiRoutingScene, aiVisualizationMode, stepContextId, uiMode, visualizationRegistry])
  const transportDecoratedScene = useMemo(
    () => decorateSetupScene(baseCurrentScene, {
      stepContextId,
      saving,
      lastError,
      language: uiLanguage,
      telegramCheckResult,
      slackCheckResult,
    }),
    [baseCurrentScene, lastError, saving, slackCheckResult, stepContextId, telegramCheckResult, uiLanguage],
  )
  const currentIndex = steps.findIndex((step) => step.id === stepContextId)
  const nextStepMeta = currentIndex >= 0 ? steps[Math.min(currentIndex + 1, steps.length - 1)] ?? null : null
  const prevStepMeta = currentIndex > 0 ? steps[currentIndex - 1] ?? null : null
  const enabledBackends = activeDraft.aiBackends.filter((backend) => backend.enabled)
  const configuredBackends = activeDraft.aiBackends.filter((backend) => backend.endpoint?.trim() || backend.defaultModel.trim())
  const selectedBackend = activeDraft.aiBackends.find((backend) => backend.id === selectedAiBackendId) ?? enabledBackends[0] ?? activeDraft.aiBackends[0] ?? null
  const selectedMcpServer = activeDraft.mcp.servers.find((server) => server.id === selectedMcpServerId) ?? activeDraft.mcp.servers[0] ?? null
  const selectedSkill = activeDraft.skills.items.find((item) => item.id === selectedSkillId) ?? activeDraft.skills.items[0] ?? null
  const selectedChannel = selectedChannelId ?? "webui"
  const reviewBoard = useMemo(
    () => buildReviewReadinessBoard({
      draft: activeDraft,
      steps,
      checks,
      shell: uiShell,
      capabilityCounts,
      language: uiLanguage,
    }),
    [activeDraft, capabilityCounts, checks, steps, uiLanguage, uiShell],
  )
  const doneSummary = useMemo(
    () => buildDoneRuntimeSummary({
      draft: activeDraft,
      checks,
      shell: uiShell,
      status: runtimeStatus,
      capabilityCounts,
      state,
      language: uiLanguage,
    }),
    [activeDraft, capabilityCounts, checks, runtimeStatus, state, uiLanguage, uiShell],
  )
  const currentValidation = useMemo(() => validateSetupStep(stepContextId, activeDraft), [stepContextId, activeDraft])
  const mcpEnabledCount = activeDraft.mcp.servers.filter((server) => server.enabled).length
  const mcpRequiredCount = activeDraft.mcp.servers.filter((server) => server.required).length
  const mcpReadyCount = activeDraft.mcp.servers.filter((server) => server.status === "ready").length
  const skillEnabledCount = activeDraft.skills.items.filter((item) => item.enabled).length
  const skillRequiredCount = activeDraft.skills.items.filter((item) => item.required).length
  const skillReadyCount = activeDraft.skills.items.filter((item) => item.status === "ready").length
  const channelEnabledCount = Number(activeDraft.channels.telegramEnabled) + Number(activeDraft.channels.slackEnabled)
  const channelPolicyScopedCount = Number(Boolean(activeDraft.channels.allowedUserIds.trim() || activeDraft.channels.allowedGroupIds.trim()))
    + Number(Boolean(activeDraft.channels.slackAllowedUserIds.trim() || activeDraft.channels.slackAllowedChannelIds.trim()))
  const channelRuntimeCount = Number(uiShell?.runtimeHealth.channels.telegramEnabled ?? false)
    + Number(uiShell?.runtimeHealth.channels.slackEnabled ?? false)
  const hasEditableCurrentStep = hasEditableSetupStep(stepContextId)
  const currentStepDirty = hasEditableCurrentStep && isSetupStepDirty(draft, activeDraft, stepContextId)
  const canSkipCurrentStep = canSkipSetupStep(stepContextId) && !currentStep.required && !saving
  const isReview = stepContextId === "review"
  const isDone = stepContextId === "done"
  const canSaveCurrentStep = hasEditableCurrentStep && currentStepDirty && currentValidation.valid && !saving
  const canGoNext = !isDone && !nextStepMeta?.locked && currentValidation.valid && !saving
  const canComplete = isReview && currentValidation.valid && !saving
  const completionErrorMessage = isReview && !saving ? formatSetupCompletionError(lastError) : ""
  const shouldShowValidation = showValidation || currentStepDirty
  const currentScene = useMemo(
    () => applyValidationOverlaysToScene(transportDecoratedScene, {
      stepId: stepContextId,
      validation: currentValidation,
      showValidation: shouldShowValidation,
      isDraftDirty: currentStepDirty,
      nextStepBlocked: (!isReview && !isDone && !currentValidation.valid) || Boolean(nextStepMeta?.locked && !isReview && !isDone),
      language: uiLanguage,
    }),
    [currentStepDirty, currentValidation, isDone, isReview, nextStepMeta?.locked, shouldShowValidation, stepContextId, transportDecoratedScene, uiLanguage],
  )
  const usesVisualizationShell = uiMode === "advanced"
    && (stepContextId === "welcome"
      || stepContextId === "personal"
      || stepContextId === "ai_backends"
      || stepContextId === "mcp"
      || stepContextId === "skills"
      || stepContextId === "security"
      || stepContextId === "channels"
      || stepContextId === "remote_access"
      || stepContextId === "review"
      || stepContextId === "done")
    && currentScene !== null

  function captureFocusedElement(target: "inspector" | "navigator") {
    if (typeof document === "undefined" || !(document.activeElement instanceof HTMLElement)) return
    if (target === "inspector") {
      inspectorReturnFocusRef.current = document.activeElement
      return
    }
    navigatorReturnFocusRef.current = document.activeElement
  }

  function restoreFocusedElement(target: "inspector" | "navigator") {
    const candidate = target === "inspector" ? inspectorReturnFocusRef.current : navigatorReturnFocusRef.current
    if (!candidate) return
    window.setTimeout(() => candidate.focus(), 0)
  }

  function openResponsiveInspector() {
    captureFocusedElement("inspector")
    setResponsiveInspectorOpen(true)
  }

  function closeResponsiveInspector() {
    setResponsiveInspectorOpen(false)
    restoreFocusedElement("inspector")
  }

  function openMobileNavigator() {
    captureFocusedElement("navigator")
    setMobileNavigatorOpen(true)
  }

  function closeMobileNavigator() {
    setMobileNavigatorOpen(false)
    restoreFocusedElement("navigator")
  }

  useEffect(() => {
    if (!aiRoutingScene) {
      setAiVisualizationMode("connections")
      return
    }

    if (state.currentStep === "ai_routing") {
      setAiVisualizationMode("routing")
      return
    }

    if (stepContextId !== "ai_backends") {
      setAiVisualizationMode("connections")
    }
  }, [aiRoutingScene, state.currentStep, stepContextId])

  useEffect(() => {
    if (!usesVisualizationShell || !renderVisualizationInspector()) {
      setResponsiveInspectorOpen(false)
      return
    }

    if (selectedVisualizationNodeId) {
      setResponsiveInspectorOpen(true)
    }
  }, [selectedVisualizationNodeId, stepContextId, usesVisualizationShell])

  useEffect(() => {
    setMobileNavigatorOpen(false)
  }, [stepContextId, uiMode])

  useEffect(() => {
    if (!usesVisualizationShell || !currentScene) {
      setSelectedVisualizationNodeId(null)
      return
    }

    setSelectedVisualizationNodeId((current) => {
      if (current && currentScene.nodes.some((node) => node.id === current)) {
        return current
      }

      if (stepContextId === "welcome") {
        return currentScene.nodes.find((node) => node.status === "required" || node.status === "draft")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "ai_backends") {
        const scenePrefix = currentScene.id === "scene:ai_routing" ? "node:routing:" : "node:ai:"
        if (selectedAiBackendId && currentScene.nodes.some((node) => node.id === `${scenePrefix}${selectedAiBackendId}`)) {
          return `${scenePrefix}${selectedAiBackendId}`
        }
        return currentScene.nodes.find((node) => node.kind === "ai_backend" && node.badges.includes("active"))?.id
          ?? currentScene.nodes.find((node) => node.kind === "ai_backend")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "mcp") {
        if (selectedMcpServerId && currentScene.nodes.some((node) => node.id === `node:mcp:${selectedMcpServerId}`)) {
          return `node:mcp:${selectedMcpServerId}`
        }
        return currentScene.nodes.find((node) => node.id.startsWith("node:mcp:") && node.id !== "node:mcp:hub" && node.id !== "node:mcp:placeholder")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "skills") {
        if (selectedSkillId && currentScene.nodes.some((node) => node.id === `node:skills:${selectedSkillId}`)) {
          return `node:skills:${selectedSkillId}`
        }
        return currentScene.nodes.find((node) => node.id.startsWith("node:skills:") && node.id !== "node:skills:hub" && node.id !== "node:skills:placeholder")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "security") {
        return currentScene.nodes.find((node) => node.status === "error" || node.status === "warning")?.id
          ?? currentScene.nodes.find((node) => node.id === "node:security:approval_gate")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "channels") {
        const preferredNodeId = selectedChannelId ? `node:channels:${selectedChannelId}` : null
        if (preferredNodeId && currentScene.nodes.some((node) => node.id === preferredNodeId)) {
          return preferredNodeId
        }
        return currentScene.nodes.find((node) => node.id === "node:channels:telegram" && (node.status === "required" || node.status === "warning" || node.status === "ready"))?.id
          ?? currentScene.nodes.find((node) => node.id === "node:channels:slack" && (node.status === "required" || node.status === "warning" || node.status === "ready"))?.id
          ?? currentScene.nodes.find((node) => node.id === "node:channels:webui")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "remote_access") {
        return currentScene.nodes.find((node) => node.status === "error" || node.status === "warning")?.id
          ?? currentScene.nodes.find((node) => node.id === "node:remote:external_clients")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "review") {
        return currentScene.nodes.find((node) => node.id !== "node:review:board" && (node.status === "error" || node.status === "warning"))?.id
          ?? currentScene.nodes.find((node) => node.id === "node:review:board")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      if (stepContextId === "done") {
        return currentScene.nodes.find((node) => node.id === "node:done:setup")?.id
          ?? currentScene.nodes[0]?.id
          ?? null
      }

      return currentScene.nodes[0]?.id ?? null
    })
  }, [currentScene, selectedAiBackendId, selectedChannelId, selectedMcpServerId, selectedSkillId, state.currentStep, stepContextId, usesVisualizationShell])

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

  function moveRoutingTarget(profileId: RoutingProfile["id"], from: number, to: number) {
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        routingProfiles: base.routingProfiles.map((profile) => {
          if (profile.id !== profileId) return profile
          if (from < 0 || from >= profile.targets.length || to < 0 || to >= profile.targets.length) {
            return profile
          }
          const nextTargets = [...profile.targets]
          const [moved] = nextTargets.splice(from, 1)
          if (!moved) return profile
          nextTargets.splice(to, 0, moved)
          return {
            ...profile,
            targets: nextTargets,
          }
        }),
      }
    })
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
    const serverId = createDraftId("mcp")
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        mcp: {
          servers: [
            ...base.mcp.servers,
            {
              id: serverId,
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
    setSelectedMcpServerId(serverId)
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
    const skillId = createDraftId("skill")
    setLocalDraft((current) => {
      const base = cloneDraft(current ?? draft)
      return {
        ...base,
        skills: {
          items: [
            ...base.skills.items,
            {
              id: skillId,
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
    setSelectedSkillId(skillId)
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

  async function handleReset(): Promise<boolean> {
    const confirmed = window.confirm("로컬 config와 setup 상태를 기본값으로 복원합니다. 계속할까요?")
    if (!confirmed) return false
    await resetSetup()
    setShowValidation(false)
    setResponsiveInspectorOpen(false)
    return true
  }

  async function persistCurrentStep(): Promise<boolean> {
    if (!hasEditableCurrentStep || !currentStepDirty) {
      return true
    }

    if (!currentValidation.valid) {
      setShowValidation(true)
      if (usesVisualizationShell) {
        openResponsiveInspector()
      }
      return false
    }

    const nextDraft = mergeSetupStepDraft(draft, activeDraft, stepContextId)
    const success = await saveDraftSnapshot(nextDraft, {
      syncChannelRuntime: stepContextId === "channels",
    })

    if (success) {
      setLocalDraft(nextDraft)
      setShowValidation(false)
    }

    return success
  }

  function handleCancelCurrentStep() {
    if (!hasEditableCurrentStep) return
    setLocalDraft(revertSetupStepDraft(activeDraft, draft, stepContextId))
    setShowValidation(false)
    if (!selectedVisualizationNodeId) {
      setResponsiveInspectorOpen(false)
    }
  }

  async function moveToStep(stepId: SetupState["currentStep"]) {
    if (stepId === state.currentStep) return
    const success = await persistCurrentStep()
    if (!success) return
    setShowValidation(false)
    setMobileNavigatorOpen(false)
    setStep(stepId)
  }

  async function handleNext() {
    if (isReview) {
      setShowValidation(true)
      if (!currentValidation.valid) {
        openResponsiveInspector()
        return
      }
      await completeSetup()
      return
    }

    if (!nextStepMeta || nextStepMeta.locked) {
      setShowValidation(true)
      if (usesVisualizationShell) {
        openResponsiveInspector()
      }
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
    setLocalDraft(revertSetupStepDraft(activeDraft, draft, stepContextId))
    setShowValidation(false)
    setMobileNavigatorOpen(false)
    setStep(nextStepMeta.id)
  }

  async function handleWelcomeQuickStart() {
    const resetDone = await handleReset()
    if (!resetDone) return
    await moveToStep("personal")
  }

  function handleVisualizationNodeSelection(nodeId: string) {
    setSelectedVisualizationNodeId(nodeId)
    if (usesVisualizationShell) {
      setResponsiveInspectorOpen(true)
    }

    if (!currentScene) return

    if (currentScene.id === "scene:ai_backends" || currentScene.id === "scene:ai_routing") {
      const prefix = currentScene.id === "scene:ai_routing" ? "node:routing:" : "node:ai:"
      if (!nodeId.startsWith(prefix)) return
      const backendId = nodeId.slice(prefix.length)
      const node = currentScene.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.kind === "ai_backend") {
        setSelectedAiBackendId(backendId)
      }
      return
    }

    if (currentScene.id === "scene:mcp") {
      if (!nodeId.startsWith("node:mcp:") || nodeId === "node:mcp:hub" || nodeId === "node:mcp:placeholder") return
      setSelectedMcpServerId(nodeId.slice("node:mcp:".length))
      return
    }

    if (currentScene.id === "scene:skills") {
      if (!nodeId.startsWith("node:skills:") || nodeId === "node:skills:hub" || nodeId === "node:skills:placeholder") return
      setSelectedSkillId(nodeId.slice("node:skills:".length))
      return
    }

    if (currentScene.id === "scene:channels") {
      if (!nodeId.startsWith("node:channels:")) return
      const channelId = nodeId.slice("node:channels:".length)
      if (channelId === "webui" || channelId === "telegram" || channelId === "slack") {
        setSelectedChannelId(channelId)
      }
      return
    }

    if (currentScene.id === "scene:review") {
      const node = currentScene.nodes.find((candidate) => candidate.id === nodeId)
      const targetStepId = node?.semanticStepIds?.find((candidate) => candidate !== "review")
      if (!targetStepId) return
      void moveToStep(targetStepId)
      return
    }

    if (stepContextId !== "welcome") return
    const node = currentScene.nodes.find((candidate) => candidate.id === nodeId)
    const targetStepId = node?.semanticStepIds?.[0]
    if (!targetStepId || targetStepId === "welcome" || targetStepId === stepContextId) return
    void moveToStep(targetStepId)
  }

  const visualizationLegend = usesVisualizationShell && currentScene
    ? (
        <div className="space-y-3">
          {stepContextId === "ai_backends" ? (
            <AiVisualizationModeToggle
              language={uiLanguage}
              mode={aiVisualizationMode}
              routingAvailable={Boolean(aiRoutingScene)}
              onChange={setAiVisualizationMode}
            />
          ) : null}
          <SetupVisualizationLegend scene={currentScene} language={uiLanguage} />
        </div>
      )
    : undefined

  const visualizationCanvas = usesVisualizationShell && currentScene
    ? (
        <SetupVisualizationCanvas
          scene={currentScene}
          language={uiLanguage}
          selectedNodeId={selectedVisualizationNodeId}
          onSelectNode={handleVisualizationNodeSelection}
          onDismissSelection={() => closeResponsiveInspector()}
        />
      )
    : undefined

  function renderVisualizationInspector() {
    if (!usesVisualizationShell || !currentScene) return undefined

    if (stepContextId === "welcome") {
      return (
        <WelcomeSetupInspector
          language={uiLanguage}
          steps={steps}
          onStart={() => { void moveToStep("personal") }}
          onQuickStart={() => { void handleWelcomeQuickStart() }}
        />
      )
    }

    if (stepContextId === "ai_backends") {
      return (
        <AiSetupInspector
          language={uiLanguage}
          mode={aiVisualizationMode}
          routingAvailable={Boolean(aiRoutingScene)}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          selectedBackend={selectedBackend}
          profile={activeDraft.routingProfiles[0] ?? null}
          backends={activeDraft.aiBackends}
          backendErrors={shouldShowValidation ? currentValidation.backendErrors : undefined}
          onSelectMode={setAiVisualizationMode}
          onMoveRoutingTarget={(from, to) => {
            const profileId = activeDraft.routingProfiles[0]?.id
            if (!profileId) return
            moveRoutingTarget(profileId, from, to)
          }}
          onSelectBackend={setSelectedAiBackendId}
          onUpdateBackend={updateBackend}
          onToggleBackend={(backendId, enabled) => setRoutingTargetEnabled("default", backendId, enabled)}
          onRemoveBackend={removeBackend}
          onSetRoutingTargetEnabled={setRoutingTargetEnabled}
        />
      )
    }

    if (stepContextId === "mcp") {
      return (
        <McpSetupInspector
          language={uiLanguage}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          selectedServer={selectedMcpServer}
          totalServers={activeDraft.mcp.servers.length}
          testingServerId={testingMcpServerId}
          errors={shouldShowValidation ? currentValidation.mcpErrors : undefined}
          onAddServer={addMcpServer}
          onChangeServer={updateMcpServer}
          onRemoveServer={removeMcpServer}
          onTestServer={(serverId) => void handleTestMcpServer(serverId)}
        />
      )
    }

    if (stepContextId === "skills") {
      return (
        <SkillsSetupInspector
          language={uiLanguage}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          selectedSkill={selectedSkill}
          totalSkills={activeDraft.skills.items.length}
          testingSkillId={testingSkillId}
          errors={shouldShowValidation ? currentValidation.skillErrors : undefined}
          onAddSkill={addSkillItem}
          onChangeSkill={updateSkillItem}
          onRemoveSkill={removeSkillItem}
          onTestSkill={(skillId) => void handleTestSkillItem(skillId)}
        />
      )
    }

    if (stepContextId === "security") {
      return (
        <SecuritySetupInspector
          language={uiLanguage}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          value={activeDraft.security}
          errors={shouldShowValidation ? {
            approvalTimeout: currentValidation.fieldErrors.approvalTimeout,
          } : undefined}
          onChange={(patch) => patchDraft("security", { ...activeDraft.security, ...patch })}
        />
      )
    }

    if (stepContextId === "channels") {
      return (
        <ChannelsSetupInspector
          language={uiLanguage}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          selectedChannel={selectedChannel}
          value={activeDraft.channels}
          telegramResult={telegramCheckResult}
          slackResult={slackCheckResult}
          runtime={uiShell?.runtimeHealth.channels ?? null}
          errors={shouldShowValidation ? {
            telegramEnabled: currentValidation.fieldErrors.telegramEnabled,
            botToken: currentValidation.fieldErrors.botToken,
            slackBotToken: currentValidation.fieldErrors.slackBotToken,
            slackAppToken: currentValidation.fieldErrors.slackAppToken,
          } : undefined}
          onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
          onTelegramCheckResult={setTelegramCheckResult}
          onSlackCheckResult={setSlackCheckResult}
        />
      )
    }

    if (stepContextId === "remote_access") {
      return (
        <RemoteAccessSetupInspector
          language={uiLanguage}
          selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
          remoteAccess={activeDraft.remoteAccess}
          mqtt={activeDraft.mqtt}
          errors={shouldShowValidation ? {
            authToken: currentValidation.fieldErrors.authToken,
            host: currentValidation.fieldErrors.host,
            port: currentValidation.fieldErrors.port,
            mqttHost: currentValidation.fieldErrors.mqttHost,
            mqttPort: currentValidation.fieldErrors.mqttPort,
            mqttUsername: currentValidation.fieldErrors.mqttUsername,
            mqttPassword: currentValidation.fieldErrors.mqttPassword,
          } : undefined}
          onChangeRemote={(patch) => patchDraft("remoteAccess", { ...activeDraft.remoteAccess, ...patch })}
          onChangeMqtt={(patch) => patchDraft("mqtt", { ...activeDraft.mqtt, ...patch })}
        />
      )
    }

    if (stepContextId === "review" || stepContextId === "done") {
      return undefined
    }

    return (
      <PersonalSetupInspector
        language={uiLanguage}
        value={activeDraft.personal}
        selectedNodeLabel={currentScene.nodes.find((node) => node.id === selectedVisualizationNodeId)?.label}
        onChange={(patch) => patchDraft("personal", { ...activeDraft.personal, ...patch })}
        errors={shouldShowValidation ? {
          profileName: currentValidation.fieldErrors.profileName,
          displayName: currentValidation.fieldErrors.displayName,
          language: currentValidation.fieldErrors.language,
          timezone: currentValidation.fieldErrors.timezone,
          workspace: currentValidation.fieldErrors.workspace,
        } : undefined}
      />
    )
  }

  const visualizationInspector = renderVisualizationInspector()
  const visualizationMobileInspector = renderVisualizationInspector()

  function patchBeginnerAiInput(patch: Partial<typeof beginnerAiInput>) {
    setBeginnerAiInput((current) => {
      const nextProvider = patch.providerType ?? current.providerType
      const endpointPatch = Object.prototype.hasOwnProperty.call(patch, "providerType")
        ? getAIProviderDefaultEndpoint(nextProvider)
        : patch.endpoint
      return {
        ...current,
        ...patch,
        providerType: nextProvider,
        ...(endpointPatch !== undefined ? { endpoint: endpointPatch } : {}),
        ...(nextProvider !== "openai" && patch.providerType ? { authMode: "api_key" as const } : {}),
      }
    })
    setBeginnerNotice("")
  }

  async function handleSaveBeginnerAi() {
    setBeginnerNotice("")
    setBeginnerAiTestOk(null)
    const nextDraft = upsertBeginnerAiBackend(activeDraft, {
      providerType: beginnerAiInput.providerType,
      authMode: beginnerAiInput.authMode,
      endpoint: beginnerAiInput.endpoint,
      defaultModel: beginnerAiInput.defaultModel,
      credentials: {
        ...(beginnerAiInput.apiKey.trim() ? { apiKey: beginnerAiInput.apiKey.trim() } : {}),
        ...(beginnerAiInput.oauthAuthFilePath.trim() ? { oauthAuthFilePath: beginnerAiInput.oauthAuthFilePath.trim() } : {}),
      },
    })
    setLocalDraft(nextDraft)
    const saved = await saveDraftSnapshot(nextDraft)
    if (!saved) {
      setBeginnerNotice(sanitizeBeginnerSetupError(lastError || "save failed", uiLanguage))
      return
    }

    const backend = getBeginnerActiveAiBackend(nextDraft)
    if (!backend) return
    setBeginnerTestingAi(true)
    try {
      const result = await api.testBackend(backend.endpoint ?? getAIProviderDefaultEndpoint(backend.providerType), backend.providerType, backend.credentials, backend.authMode)
      const testedDraft = markBeginnerAiTestResult(nextDraft, backend.id, {
        ok: result.ok,
        ...(result.models ? { models: result.models } : {}),
        message: result.ok ? uiCatalogText(uiLanguage, "beginner.setup.testReady") : result.error,
      })
      setLocalDraft(testedDraft)
      await saveDraftSnapshot(testedDraft)
      setBeginnerAiTestOk(result.ok)
      setBeginnerNotice(result.ok ? uiCatalogText(uiLanguage, "beginner.setup.testReady") : sanitizeBeginnerSetupError(result.error ?? "AI test failed", uiLanguage))
    } catch (error) {
      const testedDraft = markBeginnerAiTestResult(nextDraft, backend.id, { ok: false, message: sanitizeBeginnerSetupError(error, uiLanguage) })
      setLocalDraft(testedDraft)
      await saveDraftSnapshot(testedDraft)
      setBeginnerAiTestOk(false)
      setBeginnerNotice(sanitizeBeginnerSetupError(error, uiLanguage))
    } finally {
      setBeginnerTestingAi(false)
    }
  }

  async function handleSaveBeginnerChannels() {
    setBeginnerNotice("")
    const success = await saveDraftSnapshot(activeDraft, { syncChannelRuntime: true })
    setBeginnerNotice(success ? uiCatalogText(uiLanguage, "beginner.setup.saved") : sanitizeBeginnerSetupError(lastError || "save failed", uiLanguage))
  }

  async function handleSaveBeginnerComputer() {
    setBeginnerNotice("")
    const success = await saveDraftSnapshot(activeDraft)
    setBeginnerNotice(success ? uiCatalogText(uiLanguage, "beginner.setup.saved") : sanitizeBeginnerSetupError(lastError || "save failed", uiLanguage))
  }

  async function handleFinishBeginnerSetup() {
    setBeginnerNotice("")
    await saveDraftSnapshot(activeDraft)
    await completeSetup()
    setBeginnerNotice(lastError ? sanitizeBeginnerSetupError(lastError, uiLanguage) : uiCatalogText(uiLanguage, "beginner.setup.saved"))
  }

  function beginnerConnectionTone(status: BeginnerConnectionStatus): string {
    switch (status) {
      case "ready": return "border-emerald-200 bg-emerald-50 text-emerald-800"
      case "needs_attention": return "border-amber-200 bg-amber-50 text-amber-800"
      case "idle": return "border-stone-200 bg-stone-50 text-stone-700"
    }
  }

  function renderBeginnerSetupBody() {
    switch (beginnerStepId) {
      case "ai":
        return (
          <section id="setup-ai" className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-stone-900">{uiCatalogText(uiLanguage, "beginner.setup.aiTitle")}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{uiCatalogText(uiLanguage, "beginner.setup.step.aiDesc")}</p>
              </div>
              <Link to="/advanced/ai" className="text-sm font-semibold text-stone-600 underline underline-offset-4">{uiCatalogText(uiLanguage, "beginner.setup.openAdvanced")}</Link>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                {uiCatalogText(uiLanguage, "beginner.setup.provider")}
                <select
                  value={beginnerAiInput.providerType}
                  onChange={(event) => patchBeginnerAiInput({ providerType: event.target.value as AIProviderType })}
                  className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                >
                  {AI_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                {beginnerAiInput.providerType === "openai" && beginnerAiInput.authMode === "chatgpt_oauth" ? uiCatalogText(uiLanguage, "beginner.setup.authFile") : uiCatalogText(uiLanguage, "beginner.setup.apiKey")}
                <input
                  value={beginnerAiInput.providerType === "openai" && beginnerAiInput.authMode === "chatgpt_oauth" ? beginnerAiInput.oauthAuthFilePath : beginnerAiInput.apiKey}
                  onChange={(event) => beginnerAiInput.providerType === "openai" && beginnerAiInput.authMode === "chatgpt_oauth"
                    ? patchBeginnerAiInput({ oauthAuthFilePath: event.target.value })
                    : patchBeginnerAiInput({ apiKey: event.target.value })}
                  type={beginnerAiInput.providerType === "openai" && beginnerAiInput.authMode === "chatgpt_oauth" ? "text" : "password"}
                  placeholder={beginnerAiInput.providerType === "openai" && beginnerAiInput.authMode === "chatgpt_oauth" ? "~/.codex/auth.json" : "optional"}
                  className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                />
              </label>
            </div>
            {beginnerAiInput.providerType === "openai" ? (
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                {(["api_key", "chatgpt_oauth"] as const).map((authMode) => (
                  <button
                    key={authMode}
                    type="button"
                    onClick={() => patchBeginnerAiInput({ authMode })}
                    className={`rounded-full border px-3 py-1.5 font-semibold ${beginnerAiInput.authMode === authMode ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}
                  >
                    {authMode === "api_key" ? "API Key" : "ChatGPT OAuth"}
                  </button>
                ))}
              </div>
            ) : null}
            <details className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-stone-800">{uiCatalogText(uiLanguage, "beginner.setup.advancedOptions")}</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {uiCatalogText(uiLanguage, "beginner.setup.endpoint")}
                  <input
                    value={beginnerAiInput.endpoint}
                    onChange={(event) => patchBeginnerAiInput({ endpoint: event.target.value })}
                    className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {uiCatalogText(uiLanguage, "beginner.setup.defaultModel")}
                  <input
                    value={beginnerAiInput.defaultModel}
                    onChange={(event) => patchBeginnerAiInput({ defaultModel: event.target.value })}
                    className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </label>
              </div>
            </details>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSaveBeginnerAi()}
                disabled={saving || beginnerTestingAi || !beginnerAiInput.defaultModel.trim()}
                className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {beginnerTestingAi ? uiCatalogText(uiLanguage, "beginner.setup.testing") : uiCatalogText(uiLanguage, "beginner.setup.saveAndTestAi")}
              </button>
              <button type="button" onClick={() => setBeginnerStepId("channels")} className="rounded-2xl border border-stone-200 px-5 py-3 text-sm font-semibold text-stone-700">{pickUiText(uiLanguage, "다음", "Next")}</button>
            </div>
          </section>
        )
      case "channels":
        return (
          <section id="setup-channels" className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-stone-900">{uiCatalogText(uiLanguage, "beginner.setup.channelTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{uiCatalogText(uiLanguage, "beginner.setup.step.channelsDesc")}</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                  <input type="checkbox" checked={activeDraft.channels.telegramEnabled} onChange={(event) => patchDraft("channels", { ...activeDraft.channels, telegramEnabled: event.target.checked })} />
                  {uiCatalogText(uiLanguage, "beginner.setup.enableTelegram")}
                </label>
                <label className="mt-4 grid gap-2 text-sm font-semibold text-stone-700">
                  {uiCatalogText(uiLanguage, "beginner.setup.telegramToken")}
                  <input value={activeDraft.channels.botToken} onChange={(event) => patchDraft("channels", { ...activeDraft.channels, botToken: event.target.value })} type="password" className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900" />
                </label>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                  <input type="checkbox" checked={activeDraft.channels.slackEnabled} onChange={(event) => patchDraft("channels", { ...activeDraft.channels, slackEnabled: event.target.checked })} />
                  {uiCatalogText(uiLanguage, "beginner.setup.enableSlack")}
                </label>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2 text-sm font-semibold text-stone-700">
                    {uiCatalogText(uiLanguage, "beginner.setup.slackBotToken")}
                    <input value={activeDraft.channels.slackBotToken} onChange={(event) => patchDraft("channels", { ...activeDraft.channels, slackBotToken: event.target.value })} type="password" className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900" />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-stone-700">
                    {uiCatalogText(uiLanguage, "beginner.setup.slackAppToken")}
                    <input value={activeDraft.channels.slackAppToken} onChange={(event) => patchDraft("channels", { ...activeDraft.channels, slackAppToken: event.target.value })} type="password" className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900" />
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleSaveBeginnerChannels()} disabled={saving} className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{uiCatalogText(uiLanguage, "beginner.setup.saveChannel")}</button>
              <button type="button" onClick={() => setBeginnerStepId("computer")} className="rounded-2xl border border-stone-200 px-5 py-3 text-sm font-semibold text-stone-700">{pickUiText(uiLanguage, "다음", "Next")}</button>
            </div>
          </section>
        )
      case "computer":
        return (
          <section id="setup-computer" className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-stone-900">{uiCatalogText(uiLanguage, "beginner.setup.computerTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{uiCatalogText(uiLanguage, "beginner.setup.step.computerDesc")}</p>
            <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                <input type="checkbox" checked={activeDraft.mqtt.enabled} onChange={(event) => patchDraft("mqtt", { ...activeDraft.mqtt, enabled: event.target.checked })} />
                {uiCatalogText(uiLanguage, "beginner.setup.enableComputer")}
              </label>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {uiCatalogText(uiLanguage, "beginner.setup.computerHost")}
                  <input value={activeDraft.mqtt.host} onChange={(event) => patchDraft("mqtt", { ...activeDraft.mqtt, host: event.target.value })} className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900" />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {uiCatalogText(uiLanguage, "beginner.setup.computerPort")}
                  <input value={activeDraft.mqtt.port} onChange={(event) => patchDraft("mqtt", { ...activeDraft.mqtt, port: Number(event.target.value) || 1883 })} type="number" min={1} max={65535} className="rounded-2xl border border-stone-200 px-4 py-3 text-sm font-normal text-stone-900" />
                </label>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleSaveBeginnerComputer()} disabled={saving} className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{uiCatalogText(uiLanguage, "beginner.setup.saveComputer")}</button>
              <button type="button" onClick={() => setBeginnerStepId("test")} className="rounded-2xl border border-stone-200 px-5 py-3 text-sm font-semibold text-stone-700">{pickUiText(uiLanguage, "다음", "Next")}</button>
            </div>
          </section>
        )
      case "test":
        return (
          <section id="setup-test" className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-stone-900">{uiCatalogText(uiLanguage, "beginner.setup.testTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{beginnerSmoke.summary}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {beginnerConnections.map((card) => (
                <a key={card.id} href={card.href} onClick={() => setBeginnerStepId(card.id === "ai" ? "ai" : card.id === "channels" ? "channels" : card.id === "yeonjang" ? "computer" : "test")} className="rounded-2xl border border-stone-200 bg-stone-50 p-4 hover:bg-stone-100">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{card.title}</div>
                      <div className="mt-2 text-sm leading-6 text-stone-600">{card.summary}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${beginnerConnectionTone(card.status)}`}>{card.statusLabel}</span>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-stone-500">{card.actionLabel}</div>
                </a>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void refreshChecks(true)} disabled={checksLoading} className="rounded-2xl border border-stone-200 px-5 py-3 text-sm font-semibold text-stone-700 disabled:opacity-50">{uiCatalogText(uiLanguage, "beginner.setup.refreshStatus")}</button>
              <button type="button" onClick={() => void handleFinishBeginnerSetup()} disabled={saving || !beginnerSmoke.ok} className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{uiCatalogText(uiLanguage, "beginner.setup.finish")}</button>
            </div>
          </section>
        )
    }
  }

  function renderBeginnerSetup() {
    return (
      <div className="min-h-screen overflow-y-auto bg-stone-100 p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <BetaWarningNotice language={uiLanguage} />
          <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <aside className="space-y-4">
              <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{uiCatalogText(uiLanguage, "beginner.setup.title")}</div>
                <h1 className="mt-2 text-2xl font-semibold text-stone-900">{uiCatalogText(uiLanguage, "beginner.setup.title")}</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">{uiCatalogText(uiLanguage, "beginner.setup.description")}</p>
              </div>
              <BeginnerVisualizationDeck deck={beginnerVisualizationDeck} language={uiLanguage} onSelect={setBeginnerStepId} />
            </aside>
            <main className="space-y-4">
              {beginnerNotice ? <RuntimeNotice tone={beginnerAiTestOk === false ? "error" : "info"} title={uiCatalogText(uiLanguage, beginnerAiTestOk === false ? "beginner.setup.testNeedsAction" : "beginner.setup.saved")} message={beginnerNotice} /> : null}
              {renderBeginnerSetupBody()}
            </main>
          </div>
        </div>
      </div>
    )
  }

  function renderBody() {
    switch (stepContextId) {
      case "welcome":
        return (
          <div className="space-y-6">
            <BetaWarningNotice language={uiLanguage} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="현재 단계" value={state.completed ? "설정 완료" : "환영"} />
              <StatCard label="설정된 AI" value={String(configuredBackends.length)} />
              <StatCard label="사용 중 AI" value={String(enabledBackends.length)} />
              <StatCard
                label="채널 준비"
                value={activeDraft.channels.botToken.trim() || (activeDraft.channels.slackBotToken.trim() && activeDraft.channels.slackAppToken.trim()) ? "입력됨" : "미입력"}
              />
            </div>
            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
              <div className="rounded-3xl border border-stone-200 bg-white p-6">
                <div className="text-sm font-semibold text-stone-900">시작 전에 확인할 점</div>
                <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                  <ChecklistItem text="AI 연결은 필수입니다. 연결 주소와 기본 모델을 정해야 실제 응답 테스트가 가능합니다." />
                  <ChecklistItem text="채널과 원격 접근은 선택 단계입니다. 먼저 필수 단계부터 끝내도 됩니다." />
                  <ChecklistItem text="지도에서 노드를 클릭하면 다음에 볼 단계를 바로 이동할 수 있습니다." />
                </div>
              </div>
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
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="이름" value={activeDraft.personal.profileName.trim() || "미입력"} />
              <StatCard label="표시 이름" value={activeDraft.personal.displayName.trim() || "미입력"} />
              <StatCard label="기본 언어" value={activeDraft.personal.language.trim() || "미선택"} />
              <StatCard label="시간대" value={activeDraft.personal.timezone.trim() || "미선택"} />
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="이름과 표시 이름은 Nobie가 사용자를 구분하고 화면에 노출할 때 사용됩니다." />
                <ChecklistItem text="기본 언어와 시간대는 이후 AI 응답과 일정/알림 시간 계산 기준이 됩니다." />
                <ChecklistItem text="작업 폴더는 전체 경로여야 하며, 이후 파일 작업의 시작 위치가 됩니다." />
              </div>
            </div>
          </div>
        )

      case "ai_backends":
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="AI 연결을 준비합니다"
              description="이 단계는 Nobie Core Router 기준의 topology로 연결 상태를 보여주고, Inspector에서 같은 backend 편집 UI를 재사용합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="활성 AI" value={enabledBackends[0]?.label ?? "없음"} compact />
              <StatCard label="활성 모델" value={enabledBackends[0]?.defaultModel || "미설정"} compact />
              <StatCard label="주소 입력됨" value={String(activeDraft.aiBackends.filter((backend) => backend.endpoint?.trim()).length)} />
              <StatCard label="라우팅 대상" value={String(activeDraft.routingProfiles[0]?.targets.length ?? 0)} />
            </div>
            <RuntimeNotice
              tone={enabledBackends.length === 1 ? "info" : "error"}
              title="단일 AI 정책"
              message={enabledBackends.length === 1
                ? "현재 topology와 routing projection 모두 하나의 활성 backend를 기준으로 정렬됩니다."
                : "활성 backend를 하나 선택해야 topology와 routing scene이 정상 상태로 정렬됩니다."}
            />
            {selectedBackend?.reason ? (
              <RuntimeNotice
                tone={selectedBackend.status === "error" ? "error" : "info"}
                title={`${selectedBackend.label} 상태`}
                message={selectedBackend.reason}
              />
            ) : null}
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="캔버스에서 backend 노드를 선택하면 Inspector가 같은 backend 편집 UI로 바로 연결됩니다." />
                <ChecklistItem text="연결 확인 또는 모델 조회 결과는 노드 상태와 alert overlay에 같이 반영됩니다." />
                <ChecklistItem text="Routing 장면은 확장 보기이며, 현재 routingProfiles 의미를 그대로 시각화합니다." />
              </div>
            </div>
          </div>
        ) : (
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
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="외부 기능 연결을 준비합니다"
              description="MCP 서버를 capability map으로 보고, 선택한 서버의 command/url과 tool list는 Inspector에서 상세하게 편집합니다."
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
            {selectedMcpServer?.reason ? (
              <RuntimeNotice tone={selectedMcpServer.status === "error" ? "error" : "info"} title={`${selectedMcpServer.name || "MCP 서버"} 상태`} message={selectedMcpServer.reason} />
            ) : null}
            <RuntimeNotice
              tone={currentValidation.valid ? "info" : "error"}
              title="필수 확장 안내"
              message={currentValidation.valid
                ? "필수 서버는 연결 확인이 끝나야 하고, tool count badge로 준비 정도를 바로 확인할 수 있습니다."
                : currentValidation.summary[0] ?? "MCP 연결 상태를 다시 확인해 주세요."}
            />
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="stdio와 http transport가 cluster로 분리되어 어떤 서버가 직접 실행형인지 바로 구분됩니다." />
                <ChecklistItem text="tool count는 graph badge로 보고, 실제 tool 이름 목록은 Inspector에서만 상세 확인합니다." />
                <ChecklistItem text="연결 실패 서버는 graph에서 사라지지 않고 경고/오류 상태로 계속 남습니다." />
              </div>
            </div>
          </div>
        ) : (
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
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="작업 능력을 확장합니다"
              description="Skill을 source cluster로 나눠 보고, 선택한 항목의 local path와 상세 설명은 Inspector에서 편집합니다."
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
            {selectedSkill?.reason ? (
              <RuntimeNotice tone={selectedSkill.status === "error" ? "error" : "info"} title={`${selectedSkill.label || "Skill"} 상태`} message={selectedSkill.reason} />
            ) : null}
            <RuntimeNotice
              tone={currentValidation.valid ? "info" : "error"}
              title="필수 확장 안내"
              message={currentValidation.valid
                ? "builtin/local cluster를 함께 보고, local path 검증 결과는 graph 상태와 Inspector 상세에서 같이 확인할 수 있습니다."
                : currentValidation.summary[0] ?? "Skill 설정을 다시 확인해 주세요."}
            />
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="builtin Skill과 local Skill이 cluster로 나뉘어 source가 즉시 구분됩니다." />
                <ChecklistItem text="로컬 path 자체는 graph에 노출하지 않고, Inspector에서만 확인하고 검증합니다." />
                <ChecklistItem text="필수 Skill이 꺼져 있거나 검증되지 않은 경우 cluster 안에서도 바로 눈에 띄게 표시됩니다." />
              </div>
            </div>
          </div>
        ) : (
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
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="안전 경계를 조정합니다"
              description="승인 게이트와 타임아웃 fallback이 어디서 위험 구역으로 이어지는지 경계 지도로 보여줍니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="승인 모드" value={activeDraft.security.approvalMode} compact />
              <StatCard label="타임아웃" value={`${activeDraft.security.approvalTimeout}s`} compact />
              <StatCard label="기본 동작" value={activeDraft.security.approvalTimeoutFallback} compact />
            </div>
            {(activeDraft.security.approvalMode === "off" || activeDraft.security.approvalTimeoutFallback === "allow") ? (
              <RuntimeNotice
                tone={activeDraft.security.approvalMode === "off" && activeDraft.security.approvalTimeoutFallback === "allow" ? "error" : "info"}
                title="위험 조합 감지"
                message={activeDraft.security.approvalMode === "off" && activeDraft.security.approvalTimeoutFallback === "allow"
                  ? "승인이 꺼진 상태에서 timeout fallback도 allow로 열려 있습니다. 고위험 작업이 직접 실행될 수 있습니다."
                  : "현재 설정은 일부 작업을 빠르게 통과시키므로 boundary map의 경고 구역을 같이 확인해야 합니다."}
              />
            ) : (
              <RuntimeNotice
                tone="info"
                title="안전 기본값"
                message="승인 게이트와 deny fallback이 함께 유지되면 boundary map의 안전 구역이 기본 경로가 됩니다."
              />
            )}
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="승인 게이트가 꺼지면 중앙 boundary와 제한 구역이 동시에 경고로 바뀝니다." />
                <ChecklistItem text="timeout fallback은 승인 정책과 별도이며, allow로 바뀌면 위험 구역 alert가 즉시 추가됩니다." />
              </div>
            </div>
          </div>
        ) : (
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
              } : undefined}
            />
          </div>
        )

      case "channels":
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="대화 채널 네트워크를 정리합니다"
              description="WebUI를 기본 루트로 두고, Telegram/Slack의 policy 범위, preflight 결과, 실제 runtime 상태를 서로 다른 신호로 분리해 보여줍니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="사용 중 채널" value={String(channelEnabledCount)} />
              <StatCard label="런타임 활성" value={String(channelRuntimeCount)} />
              <StatCard label="정책 범위 지정" value={String(channelPolicyScopedCount)} />
              <StatCard label="루트 채널" value="WebUI" compact />
            </div>
            {currentStep.reason ? (
              <RuntimeNotice tone={currentStep.status === "error" ? "error" : "info"} title="채널 상태" message={currentStep.reason} />
            ) : null}
            {stepContextId === "channels" && lastError ? (
              <RuntimeNotice tone="error" title="채널 런타임 재시작 실패" message={lastError} />
            ) : null}
            {selectedChannel === "telegram" && telegramCheckResult ? (
              <RuntimeNotice
                tone={telegramCheckResult.ok ? "info" : "error"}
                title="Telegram preflight"
                message={telegramCheckResult.message}
              />
            ) : null}
            {selectedChannel === "slack" && slackCheckResult ? (
              <RuntimeNotice
                tone={slackCheckResult.ok ? "info" : "error"}
                title="Slack preflight"
                message={slackCheckResult.message}
              />
            ) : null}
            <RuntimeNotice
              tone="info"
              title="policy / preflight / runtime 분리"
              message="Allowed IDs badge는 정책 범위이고, Telegram/Slack preflight는 연결 검사이며, 저장 후 runtime restart 결과는 footer와 scene overlay에서 따로 확인합니다."
            />
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="WebUI는 항상 기본 루트 채널로 남고, Telegram/Slack은 별도 runtime 상태를 가진 외부 채널로 붙습니다." />
                <ChecklistItem text="allowed IDs가 비어 있으면 graph badge는 policy:open으로 남고, 연결 테스트 성공과는 별개로 읽어야 합니다." />
                <ChecklistItem text="저장 후 runtime restart가 실패하면 footer 오류와 graph alert가 같이 뜨며, preflight 성공과 혼동되지 않도록 분리됩니다." />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <SectionIntro
              title="대화 채널을 연결합니다"
              description="메신저에서 Nobie와 대화하려면 채널 정보를 입력하고 연결 확인을 해야 합니다. Telegram과 Slack을 모두 연결할 수 있습니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="준비된 채널"
                value={String(Number(Boolean(activeDraft.channels.botToken.trim())) + Number(Boolean(activeDraft.channels.slackBotToken.trim() && activeDraft.channels.slackAppToken.trim())))}
              />
              <StatCard
                label="사용 중 채널"
                value={String(Number(activeDraft.channels.telegramEnabled) + Number(activeDraft.channels.slackEnabled))}
              />
              <StatCard label="바로 연결 가능" value="Telegram / Slack" />
              <StatCard label="입력 방식" value="Bot Token" />
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
                    <div className="mt-1 text-sm leading-6 text-stone-600">회사나 팀용 메신저로 Nobie와 대화할 때 쓰는 채널입니다.</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeDraft.channels.slackEnabled && activeDraft.channels.slackBotToken.trim() && activeDraft.channels.slackAppToken.trim()
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-stone-200 bg-stone-100 text-stone-700"}`}>
                    {activeDraft.channels.slackEnabled && activeDraft.channels.slackBotToken.trim() && activeDraft.channels.slackAppToken.trim() ? "준비됨" : "미설정"}
                  </div>
                </div>
              </div>
            </div>
            {currentStep.status === "error" && currentStep.reason ? (
              <RuntimeNotice tone="error" title="채널 런타임 오류" message={currentStep.reason} />
            ) : currentStep.reason ? (
              <RuntimeNotice tone="info" title="채널 상태" message={currentStep.reason} />
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <TelegramSettingsForm
                  value={activeDraft.channels}
                  onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
                  errors={shouldShowValidation ? {
                    telegramEnabled: currentValidation.fieldErrors.telegramEnabled,
                    botToken: currentValidation.fieldErrors.botToken,
                  } : undefined}
                />
                <TelegramCheckPanel botToken={activeDraft.channels.botToken} />
              </div>
              <div className="space-y-4">
                <SlackSettingsForm
                  value={activeDraft.channels}
                  onChange={(patch) => patchDraft("channels", { ...activeDraft.channels, ...patch })}
                  errors={shouldShowValidation ? {
                    slackBotToken: currentValidation.fieldErrors.slackBotToken,
                    slackAppToken: currentValidation.fieldErrors.slackAppToken,
                  } : undefined}
                />
                <SlackCheckPanel
                  botToken={activeDraft.channels.slackBotToken}
                  appToken={activeDraft.channels.slackAppToken}
                />
              </div>
            </div>
          </div>
        )

      case "remote_access":
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="원격 접근 경계를 정리합니다"
              description="Host/port, auth boundary, MQTT bridge, external client zone을 하나의 네트워크 맵으로 보고, 실제 값 편집은 Inspector에서 진행합니다."
            />
            {shouldShowValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="원격 Host" value={activeDraft.remoteAccess.host || "미입력"} compact />
              <StatCard label="원격 Port" value={String(activeDraft.remoteAccess.port)} />
              <StatCard label="WebUI 인증" value={activeDraft.remoteAccess.authEnabled ? "on" : "off"} compact />
              <StatCard label="MQTT Bridge" value={activeDraft.mqtt.enabled ? "on" : "off"} compact />
            </div>
            {currentStep.reason ? (
              currentStep.status === "planned" ? (
                <PlannedState title="Remote Access" description={currentStep.reason} />
              ) : (
                <RuntimeNotice tone={currentStep.status === "error" ? "error" : "info"} title="원격 접근 상태" message={currentStep.reason} />
              )
            ) : null}
            {!activeDraft.remoteAccess.authEnabled && activeDraft.remoteAccess.host.trim() && !["127.0.0.1", "localhost"].includes(activeDraft.remoteAccess.host.trim()) ? (
              <RuntimeNotice tone="error" title="열린 원격 경계" message="로컬이 아닌 host에서 WebUI 인증이 꺼져 있습니다. boundary map에서 auth boundary 경고를 먼저 확인해야 합니다." />
            ) : null}
            <RuntimeNotice
              tone={activeDraft.mqtt.enabled ? "info" : "info"}
              title="MQTT runtime detail"
              message={`setup에서는 bridge 경계와 자격 정보만 편집하고, 실제 extension 연결 상세는 ${pickUiText(uiLanguage, "설정/연장 화면", "settings/extensions")}에서 다시 확인합니다.`}
            />
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">이 단계에서 확인할 것</div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-700">
                <ChecklistItem text="Host/Port와 Auth boundary는 같은 원격 WebUI 경계를 공유하지만, 오류 원인은 분리해서 읽어야 합니다." />
                <ChecklistItem text="MQTT bridge는 extension client와 연결되지만 Yeonjang 자체를 하위 노드로 표현하지는 않습니다." />
                <ChecklistItem text="Auth token은 값 대신 보호됨/누락/초안 상태로만 읽고, 실제 값 편집은 Inspector에서만 처리합니다." />
              </div>
            </div>
          </div>
        ) : (
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
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <SectionIntro
              title="완료 전 readiness를 확인합니다"
              description="입력값 나열 대신, 왜 지금 완료할 수 있는지 또는 무엇이 아직 막고 있는지를 readiness board로 확인합니다."
            />
            {showValidation && currentValidation.summary.length > 0 ? (
              <ValidationNotice messages={currentValidation.summary} />
            ) : null}
            {completionErrorMessage ? (
              <RuntimeNotice tone="error" title="설정 완료에 실패했습니다" message={completionErrorMessage} />
            ) : null}
            <ReviewSummaryPanel
              board={reviewBoard}
              onSelectStep={(stepId) => {
                void moveToStep(stepId)
              }}
            />
            <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
          </div>
        ) : (
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
              board={reviewBoard}
              onSelectStep={(stepId) => {
                void moveToStep(stepId)
              }}
            />
            <SetupChecksPanel checks={checks} loading={checksLoading} onRefresh={() => void refreshChecks(true)} />
          </div>
        )

      case "done":
        return usesVisualizationShell && currentScene ? (
          <div className="space-y-6">
            <div className="rounded-3xl border border-stone-200 bg-white p-8">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Completed</div>
              <h2 className="mt-3 text-3xl font-semibold text-stone-900">{doneSummary.heroTitle}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-600">{doneSummary.heroMessage}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {doneSummary.cards.map((card) => (
                <RuntimeSummaryCard key={card.id} card={card} />
              ))}
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-6">
              <div className="text-sm font-semibold text-stone-900">다음 행동</div>
              <div className="mt-4 flex flex-wrap gap-3">
                {state.completed ? doneSummary.actions.map((action) => (
                  <Link
                    key={action.id}
                    to={action.href}
                    className={action.tone === "primary"
                      ? "rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white"
                      : "rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700"}
                  >
                    {action.label}
                  </Link>
                )) : (
                  <button
                    onClick={() => void completeSetup()}
                    className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    {pickUiText(uiLanguage, "설정 완료", "Finish Setup")}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
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

  if (uiMode === "beginner") {
    return renderBeginnerSetup()
  }

  return (
    <SetupStepShell
      title={pickUiText(uiLanguage, "처음 설정", "Initial Setup")}
      description={pickUiText(uiLanguage, "필수 단계부터 차례대로 입력하면 Nobie를 바로 사용할 수 있습니다.", "Complete the required steps in order to start using Nobie quickly.")}
      steps={steps}
      currentStep={stepContextId}
      onSelectStep={(stepId) => {
        const targetStep = steps.find((step) => step.id === stepId)
        if (!targetStep || targetStep.locked) return
        void moveToStep(stepId as typeof state.currentStep)
      }}
      language={uiLanguage}
      legend={visualizationLegend}
      canvas={visualizationCanvas}
      inspector={visualizationInspector}
      mobileInspector={visualizationMobileInspector}
      inspectorTitle={currentStep.label}
      inspectorDescription={currentStep.description}
      inspectorOpen={responsiveInspectorOpen}
      onInspectorOpen={openResponsiveInspector}
      onInspectorClose={closeResponsiveInspector}
      mobileNavigatorOpen={mobileNavigatorOpen}
      onMobileNavigatorOpen={openMobileNavigator}
      onMobileNavigatorClose={closeMobileNavigator}
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
                  onClick={() => { if (!currentStepDirty || saving) return; void persistCurrentStep() }}
                  disabled={saving || !currentValidation.valid}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${currentStepDirty ? "border-stone-200 bg-white text-stone-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
                >
                  {saving
                    ? pickUiText(uiLanguage, "저장 중...", "Saving...")
                    : currentStepDirty
                      ? pickUiText(uiLanguage, "저장", "Save")
                      : pickUiText(uiLanguage, "저장됨", "Saved")}
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

function BetaWarningNotice({ language }: { language: UiLanguage }) {
  return (
    <section
      role="alert"
      aria-live="polite"
      className="rounded-[1.75rem] border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-200 text-base font-black text-amber-900" aria-hidden="true">
          !
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {pickUiText(language, "베타 사용 경고", "Beta use warning")}
          </div>
          <p className="mt-1 text-sm leading-6">
            {pickUiText(
              language,
              "이 프로그램은 아직 베타입니다. 사용 방식에 따라 파일 변경, 외부 서비스 호출, 화면 제어 같은 위험이 생길 수 있습니다. 중요한 작업은 실행 내용을 확인하고, 승인 요청을 신중하게 처리해 주세요.",
              "This program is still in beta. Depending on how you use it, it may change files, call external services, or control the screen. Review actions carefully and handle approval requests with caution.",
            )}
          </p>
        </div>
      </div>
    </section>
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

function RuntimeSummaryCard({
  card,
}: {
  card: ReturnType<typeof buildDoneRuntimeSummary>["cards"][number]
}) {
  const toneClass = card.tone === "ready"
    ? "border-emerald-200 bg-emerald-50"
    : card.tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : "border-stone-200 bg-stone-50"

  return (
    <div className={`rounded-3xl border p-5 ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{card.title}</div>
      <div className="mt-3 text-2xl font-semibold text-stone-900">{card.value}</div>
      <div className="mt-3 text-sm leading-6 text-stone-700">{card.detail}</div>
    </div>
  )
}

function channelLabel(channel: SetupChannelId, language: UiLanguage): string {
  switch (channel) {
    case "telegram":
      return pickUiText(language, "Telegram", "Telegram")
    case "slack":
      return pickUiText(language, "Slack", "Slack")
    case "webui":
    default:
      return "WebUI"
  }
}

function channelPolicySummary(
  channel: SetupChannelId,
  value: SetupDraft["channels"],
  language: UiLanguage,
): { title: string; description: string } {
  if (channel === "webui") {
    return {
      title: pickUiText(language, "기본 내장 채널", "Built-in root channel"),
      description: pickUiText(
        language,
        "WebUI는 항상 기본 입력 채널이며 별도 allowed IDs 정책이 없습니다.",
        "WebUI is always the built-in input channel and has no separate allowed-ID policy.",
      ),
    }
  }

  if (channel === "telegram") {
    const scoped = Boolean(value.allowedUserIds.trim() || value.allowedGroupIds.trim())
    return {
      title: scoped ? pickUiText(language, "policy:scoped", "policy:scoped") : pickUiText(language, "policy:open", "policy:open"),
      description: scoped
        ? pickUiText(language, "허용 사용자/그룹 ID가 입력되어 범위가 좁혀져 있습니다.", "Allowed user/group IDs are filled in, so the scope is narrowed.")
        : pickUiText(language, "허용 사용자/그룹 ID가 비어 있어 범위가 넓습니다.", "Allowed user/group IDs are empty, so the scope is broad."),
    }
  }

  const scoped = Boolean(value.slackAllowedUserIds.trim() || value.slackAllowedChannelIds.trim())
  return {
    title: scoped ? pickUiText(language, "policy:scoped", "policy:scoped") : pickUiText(language, "policy:open", "policy:open"),
    description: scoped
      ? pickUiText(language, "허용 사용자/채널 ID가 입력되어 범위가 좁혀져 있습니다.", "Allowed user/channel IDs are filled in, so the scope is narrowed.")
      : pickUiText(language, "허용 사용자/채널 ID가 비어 있어 범위가 넓습니다.", "Allowed user/channel IDs are empty, so the scope is broad."),
  }
}

function channelRuntimeSummary(
  channel: SetupChannelId,
  runtime: UiShellResponse["runtimeHealth"]["channels"] | null,
  language: UiLanguage,
): { title: string; description: string } {
  if (!runtime) {
    return {
      title: pickUiText(language, "runtime:unknown", "runtime:unknown"),
      description: pickUiText(language, "런타임 상태를 아직 불러오지 못했습니다.", "Runtime state is not loaded yet."),
    }
  }

  if (channel === "webui") {
    return {
      title: runtime.webui ? pickUiText(language, "runtime:ready", "runtime:ready") : pickUiText(language, "runtime:warning", "runtime:warning"),
      description: runtime.webui
        ? pickUiText(language, "WebUI 루트 채널은 활성 상태입니다.", "The WebUI root channel is active.")
        : pickUiText(language, "WebUI 루트 채널 상태를 다시 확인해야 합니다.", "The WebUI root channel needs to be checked."),
    }
  }

  if (channel === "telegram") {
    return {
      title: runtime.telegramEnabled
        ? pickUiText(language, "runtime:ready", "runtime:ready")
        : runtime.telegramConfigured
          ? pickUiText(language, "runtime:stopped", "runtime:stopped")
          : pickUiText(language, "runtime:idle", "runtime:idle"),
      description: runtime.telegramEnabled
        ? pickUiText(language, "Telegram 런타임이 실제로 동작 중입니다.", "The Telegram runtime is actually running.")
        : runtime.telegramConfigured
          ? pickUiText(language, "설정은 저장되어 있지만 런타임은 아직 시작되지 않았습니다.", "The configuration is saved, but the runtime has not started yet.")
          : pickUiText(language, "Telegram 런타임 설정이 아직 비어 있습니다.", "Telegram runtime settings are still empty."),
    }
  }

  return {
    title: runtime.slackEnabled
      ? pickUiText(language, "runtime:ready", "runtime:ready")
      : runtime.slackConfigured
        ? pickUiText(language, "runtime:stopped", "runtime:stopped")
        : pickUiText(language, "runtime:idle", "runtime:idle"),
    description: runtime.slackEnabled
      ? pickUiText(language, "Slack Socket Mode 런타임이 실제로 동작 중입니다.", "The Slack Socket Mode runtime is actually running.")
      : runtime.slackConfigured
        ? pickUiText(language, "설정은 저장되어 있지만 Socket Mode 런타임은 아직 시작되지 않았습니다.", "The configuration is saved, but the Socket Mode runtime has not started yet.")
        : pickUiText(language, "Slack 런타임 설정이 아직 비어 있습니다.", "Slack runtime settings are still empty."),
  }
}

export function decorateSetupScene(
  scene: VisualizationScene | null,
  {
    stepContextId,
    saving,
    lastError,
    language,
    telegramCheckResult,
    slackCheckResult,
  }: {
    stepContextId: SetupState["currentStep"]
    saving: boolean
    lastError: string
    language: UiLanguage
    telegramCheckResult: ChannelCheckResult
    slackCheckResult: ChannelCheckResult
  },
): VisualizationScene | null {
  if (!scene || stepContextId !== "channels") return scene

  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const extraAlerts = [...(scene.alerts ?? [])]
  const nodes = scene.nodes.map((node) => {
    let nextNode = node

    if (node.id === "node:channels:telegram" && telegramCheckResult) {
      nextNode = {
        ...nextNode,
        status: telegramCheckResult.ok ? nextNode.status : softenNodeStatusToWarning(nextNode.status),
        badges: appendVisualizationBadge(nextNode.badges, telegramCheckResult.ok ? "preflight:ok" : "preflight:error"),
      }
    }

    if (node.id === "node:channels:slack" && slackCheckResult) {
      nextNode = {
        ...nextNode,
        status: slackCheckResult.ok ? nextNode.status : softenNodeStatusToWarning(nextNode.status),
        badges: appendVisualizationBadge(nextNode.badges, slackCheckResult.ok ? "preflight:ok" : "preflight:error"),
      }
    }

    if (lastError && (node.id === "node:channels:telegram" || node.id === "node:channels:slack") && node.badges.includes("enabled")) {
      nextNode = {
        ...nextNode,
        status: softenNodeStatusToWarning(nextNode.status),
        badges: appendVisualizationBadge(nextNode.badges, "runtime:retry"),
      }
    }

    return nextNode
  })

  if (saving) {
    extraAlerts.push({
      id: "alert:channels:runtime-sync-pending",
      tone: "info",
      message: t(
        "채널 설정을 저장하는 동안 외부 런타임 재시작 경계를 같이 반영합니다.",
        "While saving channel settings, the external runtime restart boundary is being applied.",
      ),
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:webui"],
    })
  }

  if (telegramCheckResult) {
    extraAlerts.push({
      id: "alert:channels:telegram-preflight",
      tone: telegramCheckResult.ok ? "info" : "error",
      message: `${t("Telegram preflight", "Telegram preflight")}: ${telegramCheckResult.message}`,
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:telegram"],
    })
  }

  if (slackCheckResult) {
    extraAlerts.push({
      id: "alert:channels:slack-preflight",
      tone: slackCheckResult.ok ? "info" : "error",
      message: `${t("Slack preflight", "Slack preflight")}: ${slackCheckResult.message}`,
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:slack"],
    })
  }

  if (lastError) {
    extraAlerts.push({
      id: "alert:channels:runtime-sync-error",
      tone: "error",
      message: `${t("채널 런타임 재시작 실패", "Channel runtime restart failed")}: ${lastError}`,
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:webui", "node:channels:telegram", "node:channels:slack"],
    })
  }

  return {
    ...scene,
    nodes,
    alerts: extraAlerts,
  }
}

function appendVisualizationBadge(badges: string[], badge: string): string[] {
  return badges.includes(badge) ? badges : [...badges, badge]
}

function softenNodeStatusToWarning(status: VisualizationScene["nodes"][number]["status"]): VisualizationScene["nodes"][number]["status"] {
  if (status === "error" || status === "required") return status
  return "warning"
}

function WelcomeSetupInspector({
  language,
  steps,
  onStart,
  onQuickStart,
}: {
  language: UiLanguage
  steps: Array<{ id: string; label: string; required: boolean; completed: boolean; locked: boolean }>
  onStart: () => void
  onQuickStart: () => void
}) {
  const remainingRequired = steps.filter((step) => step.required && !step.completed).length
  const nextRecommended = steps.find((step) => step.required && !step.completed && !step.locked)
  const estimatedMinutes = Math.max(2, remainingRequired * 2)

  return (
    <div className="space-y-4 p-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          {pickUiText(language, "권장 시작점", "Recommended start")}
        </div>
        <div className="mt-2 text-sm font-semibold text-stone-900">
          {nextRecommended?.label ?? pickUiText(language, "모든 필수 단계를 마쳤습니다.", "All required steps are ready.")}
        </div>
        <div className="mt-2 text-sm leading-6 text-stone-600">
          {pickUiText(language, `예상 소요 시간 약 ${estimatedMinutes}분`, `Estimated time about ${estimatedMinutes} min`)}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          {pickUiText(language, "빠른 액션", "Quick actions")}
        </div>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={onStart}
            className="rounded-2xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white"
          >
            {pickUiText(language, "설정 시작", "Start setup")}
          </button>
          <button
            type="button"
            onClick={onQuickStart}
            className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(language, "기본값으로 빠른 시작", "Quick start with defaults")}
          </button>
          <Link
            to="/advanced/ai"
            className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700"
          >
            {pickUiText(language, "고급 설정 보기", "Open advanced settings")}
          </Link>
        </div>
      </div>
    </div>
  )
}

function PersonalSetupInspector({
  language,
  value,
  selectedNodeLabel,
  onChange,
  errors,
}: {
  language: UiLanguage
  value: SetupDraft["personal"]
  selectedNodeLabel?: string
  onChange: (patch: Partial<SetupDraft["personal"]>) => void
  errors?: Partial<Record<keyof SetupDraft["personal"], string>>
}) {
  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          {pickUiText(language, "편집 Inspector", "Editing inspector")}
        </div>
        <div className="mt-2 text-sm font-semibold text-stone-900">
          {selectedNodeLabel ?? pickUiText(language, "프로필 컨텍스트", "Profile context")}
        </div>
        <div className="mt-2 text-sm leading-6 text-stone-600">
          {pickUiText(language, "입력값을 바꾸면 지도 노드 상태가 즉시 같이 바뀝니다.", "Changing a value updates the map node state immediately.")}
        </div>
      </div>
      <PersonalSettingsForm value={value} onChange={onChange} errors={errors} />
    </div>
  )
}

function InspectorIntroCard({
  language,
  title,
  description,
}: {
  language: UiLanguage
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {pickUiText(language, "편집 Inspector", "Editing inspector")}
      </div>
      <div className="mt-2 text-sm font-semibold text-stone-900">{title}</div>
      <div className="mt-2 text-sm leading-6 text-stone-600">{description}</div>
    </div>
  )
}

function McpSetupInspector({
  language,
  selectedNodeLabel,
  selectedServer,
  totalServers,
  testingServerId,
  errors,
  onAddServer,
  onChangeServer,
  onRemoveServer,
  onTestServer,
}: {
  language: UiLanguage
  selectedNodeLabel?: string
  selectedServer: SetupDraft["mcp"]["servers"][number] | null
  totalServers: number
  testingServerId?: string | null
  errors?: Record<string, import("../lib/setupFlow").McpServerErrors>
  onAddServer: () => void
  onChangeServer: (serverId: string, patch: Partial<SetupDraft["mcp"]["servers"][number]>) => void
  onRemoveServer: (serverId: string) => void
  onTestServer: (serverId: string) => void
}) {
  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <InspectorIntroCard
        language={language}
        title={selectedNodeLabel ?? selectedServer?.name ?? pickUiText(language, "MCP 서버", "MCP server")}
        description={pickUiText(
          language,
          totalServers > 0
            ? "선택한 MCP 서버의 command, transport, tool list를 여기서 바로 편집하고 검사합니다."
            : "아직 MCP 서버가 없습니다. 먼저 하나를 추가하면 capability map과 Inspector가 함께 채워집니다.",
          totalServers > 0
            ? "Edit and test the selected MCP server's command, transport, and tool list here."
            : "There are no MCP servers yet. Add one first and the capability map and inspector will populate together.",
        )}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAddServer}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
        >
          {pickUiText(language, "새 MCP 추가", "Add MCP Server")}
        </button>
      </div>

      {selectedServer ? (
        <McpServerEditorCard
          server={selectedServer}
          isTesting={testingServerId === selectedServer.id}
          errors={errors?.[selectedServer.id]}
          onChange={(patch) => onChangeServer(selectedServer.id, patch)}
          onRemove={() => onRemoveServer(selectedServer.id)}
          onTest={() => onTestServer(selectedServer.id)}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/75 p-4 text-sm leading-6 text-stone-500">
          {pickUiText(language, "왼쪽 capability map에서 MCP 서버를 선택하거나 새 서버를 추가해 주세요.", "Select an MCP server from the capability map or add a new server.")}
        </div>
      )}
    </div>
  )
}

function SkillsSetupInspector({
  language,
  selectedNodeLabel,
  selectedSkill,
  totalSkills,
  testingSkillId,
  errors,
  onAddSkill,
  onChangeSkill,
  onRemoveSkill,
  onTestSkill,
}: {
  language: UiLanguage
  selectedNodeLabel?: string
  selectedSkill: SetupDraft["skills"]["items"][number] | null
  totalSkills: number
  testingSkillId?: string | null
  errors?: Record<string, import("../lib/setupFlow").SkillItemErrors>
  onAddSkill: () => void
  onChangeSkill: (skillId: string, patch: Partial<SetupDraft["skills"]["items"][number]>) => void
  onRemoveSkill: (skillId: string) => void
  onTestSkill: (skillId: string) => void
}) {
  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <InspectorIntroCard
        language={language}
        title={selectedNodeLabel ?? selectedSkill?.label ?? pickUiText(language, "Skill", "Skill")}
        description={pickUiText(
          language,
          totalSkills > 0
            ? "선택한 Skill의 source, 설명, local path를 여기서 편집하고 바로 검증합니다."
            : "아직 Skill이 없습니다. 먼저 하나를 추가하면 source cluster와 Inspector가 함께 채워집니다.",
          totalSkills > 0
            ? "Edit the selected skill's source, description, and local path here and validate it immediately."
            : "There are no skills yet. Add one first and both the source clusters and inspector will populate together.",
        )}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAddSkill}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
        >
          {pickUiText(language, "새 Skill 추가", "Add Skill")}
        </button>
      </div>

      {selectedSkill ? (
        <SkillItemEditorCard
          item={selectedSkill}
          isTesting={testingSkillId === selectedSkill.id}
          errors={errors?.[selectedSkill.id]}
          onChange={(patch) => onChangeSkill(selectedSkill.id, patch)}
          onRemove={() => onRemoveSkill(selectedSkill.id)}
          onTest={() => onTestSkill(selectedSkill.id)}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/75 p-4 text-sm leading-6 text-stone-500">
          {pickUiText(language, "왼쪽 capability map에서 Skill을 선택하거나 새 Skill을 추가해 주세요.", "Select a skill from the capability map or add a new skill.")}
        </div>
      )}
    </div>
  )
}

function SecuritySetupInspector({
  language,
  selectedNodeLabel,
  value,
  errors,
  onChange,
}: {
  language: UiLanguage
  selectedNodeLabel?: string
  value: SetupDraft["security"]
  errors?: Partial<Record<"approvalTimeout", string>>
  onChange: (patch: Partial<SetupDraft["security"]>) => void
}) {
  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <InspectorIntroCard
        language={language}
        title={selectedNodeLabel ?? pickUiText(language, "보안 경계", "Security boundary")}
        description={pickUiText(
          language,
          "선택한 boundary node와 같은 승인 정책을 여기서 직접 편집합니다. 값이 바뀌면 경고 구역과 안전 구역이 즉시 다시 계산됩니다.",
          "Edit the same approval policy represented by the selected boundary node. Changing a value immediately recalculates the safe and warning zones.",
        )}
      />
      <SecuritySettingsForm value={value} onChange={onChange} errors={errors} />
    </div>
  )
}

function ChannelsSetupInspector({
  language,
  selectedNodeLabel,
  selectedChannel,
  value,
  telegramResult,
  slackResult,
  runtime,
  errors,
  onChange,
  onTelegramCheckResult,
  onSlackCheckResult,
}: {
  language: UiLanguage
  selectedNodeLabel?: string
  selectedChannel: SetupChannelId
  value: SetupDraft["channels"]
  telegramResult: ChannelCheckResult
  slackResult: ChannelCheckResult
  runtime: UiShellResponse["runtimeHealth"]["channels"] | null
  errors?: Partial<Record<"telegramEnabled" | "botToken" | "slackBotToken" | "slackAppToken", string>>
  onChange: (patch: Partial<SetupDraft["channels"]>) => void
  onTelegramCheckResult: (result: ChannelCheckResult) => void
  onSlackCheckResult: (result: ChannelCheckResult) => void
}) {
  const selectedTitle = selectedNodeLabel ?? channelLabel(selectedChannel, language)
  const runtimeSummary = channelRuntimeSummary(selectedChannel, runtime, language)
  const policySummary = channelPolicySummary(selectedChannel, value, language)

  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <InspectorIntroCard
        language={language}
        title={selectedTitle}
        description={selectedChannel === "webui"
          ? pickUiText(
            language,
            "WebUI는 기본 루트 채널입니다. 외부 메신저는 여기서 갈라져 나가며, 저장 후 runtime restart 경계를 공유합니다.",
            "WebUI is the built-in root channel. External messengers branch from here and share the runtime restart boundary after save.",
          )
          : pickUiText(
            language,
            "선택한 채널의 정책 범위와 preflight를 여기서 확인합니다. allowed IDs와 연결 테스트는 서로 다른 의미로 유지됩니다.",
            "Review the selected channel's policy scope and preflight here. Allowed IDs and connection tests stay as separate signals.",
          )}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            {pickUiText(language, "정책 범위", "Policy scope")}
          </div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{policySummary.title}</div>
          <div className="mt-2 text-sm leading-6 text-stone-600">{policySummary.description}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            {pickUiText(language, "런타임 상태", "Runtime state")}
          </div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{runtimeSummary.title}</div>
          <div className="mt-2 text-sm leading-6 text-stone-600">{runtimeSummary.description}</div>
        </div>
      </div>

      {selectedChannel === "webui" ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 p-4 text-sm leading-6 text-stone-600">
          {pickUiText(
            language,
            "WebUI는 입력 토큰이 필요 없는 기본 채널입니다. Telegram/Slack의 policy 편집과 preflight는 각 채널 노드를 선택했을 때만 표시됩니다.",
            "WebUI is the built-in channel and does not require input tokens. Telegram and Slack policy editing and preflight appear only when those channel nodes are selected.",
          )}
        </div>
      ) : selectedChannel === "telegram" ? (
        <>
          <TelegramSettingsForm
            value={value}
            onChange={onChange}
            errors={errors ? {
              telegramEnabled: errors.telegramEnabled,
              botToken: errors.botToken,
            } : undefined}
          />
          <TelegramCheckPanel botToken={value.botToken} result={telegramResult} onResult={onTelegramCheckResult} />
        </>
      ) : (
        <>
          <SlackSettingsForm
            value={value}
            onChange={onChange}
            errors={errors ? {
              slackBotToken: errors.slackBotToken,
              slackAppToken: errors.slackAppToken,
            } : undefined}
          />
          <SlackCheckPanel
            botToken={value.slackBotToken}
            appToken={value.slackAppToken}
            result={slackResult}
            onResult={onSlackCheckResult}
          />
        </>
      )}
    </div>
  )
}

function RemoteAccessSetupInspector({
  language,
  selectedNodeLabel,
  remoteAccess,
  mqtt,
  errors,
  onChangeRemote,
  onChangeMqtt,
}: {
  language: UiLanguage
  selectedNodeLabel?: string
  remoteAccess: SetupDraft["remoteAccess"]
  mqtt: SetupDraft["mqtt"]
  errors?: Partial<Record<"authToken" | "host" | "port" | "mqttHost" | "mqttPort" | "mqttUsername" | "mqttPassword", string>>
  onChangeRemote: (patch: Partial<SetupDraft["remoteAccess"]>) => void
  onChangeMqtt: (patch: Partial<SetupDraft["mqtt"]>) => void
}) {
  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <InspectorIntroCard
        language={language}
        title={selectedNodeLabel ?? pickUiText(language, "원격 접근 경계", "Remote access boundary")}
        description={pickUiText(
          language,
          "Host/port, auth boundary, MQTT bridge 편집을 여기서 진행합니다. 토큰 값은 메인 graph가 아니라 inspector 안에서만 다룹니다.",
          "Edit the host/port, auth boundary, and MQTT bridge here. Token values stay inside the inspector instead of the main graph.",
        )}
      />
      <RemoteAccessForm
        value={remoteAccess}
        onChange={onChangeRemote}
        errors={errors ? {
          authToken: errors.authToken,
          host: errors.host,
          port: errors.port,
        } : undefined}
      />
      <MqttSettingsForm
        value={mqtt}
        onChange={onChangeMqtt}
        errors={errors ? {
          host: errors.mqttHost,
          port: errors.mqttPort,
          username: errors.mqttUsername,
          password: errors.mqttPassword,
        } : undefined}
      />
      <AuthTokenPanel
        authEnabled={remoteAccess.authEnabled}
        authToken={remoteAccess.authToken}
        onGenerated={(token) => onChangeRemote({ authToken: token })}
      />
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 p-4 text-sm leading-6 text-stone-600">
        {pickUiText(
          language,
          "MQTT runtime deep detail과 extension 상태는 setup에서 직접 다루지 않고 settings/extensions 화면으로 분리합니다.",
          "MQTT runtime deep detail and extension status stay out of setup and move to the settings/extensions view.",
        )}
      </div>
    </div>
  )
}

function AiVisualizationModeToggle({
  language,
  mode,
  routingAvailable,
  onChange,
}: {
  language: UiLanguage
  mode: "connections" | "routing"
  routingAvailable: boolean
  onChange: (mode: "connections" | "routing") => void
}) {
  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {pickUiText(language, "AI 장면", "AI scene")}
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {pickUiText(language, "연결 topology와 routing projection을 같은 단계에서 전환해 볼 수 있습니다.", "Switch between the connection topology and the routing projection within the same step.")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange("connections")}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${mode === "connections" ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}
          >
            {pickUiText(language, "연결", "Connections")}
          </button>
          <button
            type="button"
            onClick={() => onChange("routing")}
            disabled={!routingAvailable}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${mode === "routing" ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}
          >
            {pickUiText(language, "라우팅", "Routing")}
          </button>
        </div>
      </div>
    </div>
  )
}

function AiSetupInspector({
  language,
  mode,
  routingAvailable,
  selectedNodeLabel,
  selectedBackend,
  profile,
  backends,
  backendErrors,
  onSelectMode,
  onMoveRoutingTarget,
  onSelectBackend,
  onUpdateBackend,
  onToggleBackend,
  onRemoveBackend,
  onSetRoutingTargetEnabled,
}: {
  language: UiLanguage
  mode: "connections" | "routing"
  routingAvailable: boolean
  selectedNodeLabel?: string
  selectedBackend: AIBackendCard | null
  profile: RoutingProfile | null
  backends: AIBackendCard[]
  backendErrors?: Record<string, BackendCardErrors>
  onSelectMode: (mode: "connections" | "routing") => void
  onMoveRoutingTarget: (from: number, to: number) => void
  onSelectBackend: (backendId: string) => void
  onUpdateBackend: (backendId: string, patch: Partial<AIBackendCard>) => void
  onToggleBackend: (backendId: string, enabled: boolean) => void
  onRemoveBackend: (backendId: string) => void
  onSetRoutingTargetEnabled: (profileId: RoutingProfile["id"], backendId: string, enabled: boolean) => void
}) {
  const enabledBackend = backends.find((backend) => backend.enabled) ?? null

  return (
    <div className="space-y-4 bg-[#f7f3eb] p-5">
      <AiVisualizationModeToggle language={language} mode={mode} routingAvailable={routingAvailable} onChange={onSelectMode} />

      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          {pickUiText(language, "편집 Inspector", "Editing inspector")}
        </div>
        <div className="mt-2 text-sm font-semibold text-stone-900">
          {selectedNodeLabel ?? selectedBackend?.label ?? pickUiText(language, "AI 연결", "AI connection")}
        </div>
        <div className="mt-2 text-sm leading-6 text-stone-600">
          {pickUiText(
            language,
            enabledBackend
              ? `${enabledBackend.label} 이(가) 현재 live backend입니다. 다른 backend를 켜면 routing target도 같이 바뀝니다.`
              : "아직 live backend가 없습니다. Inspector에서 하나를 활성화하면 topology와 routing scene이 같이 갱신됩니다.",
            enabledBackend
              ? `${enabledBackend.label} is currently live. Enabling another backend also updates the routing target.`
              : "There is no live backend yet. Enable one backend here and both the topology and routing scene will update together.",
          )}
        </div>
      </div>

      {mode === "routing" && profile ? (
        <RoutingPriorityEditor
          profile={profile}
          backends={backends}
          onMove={onMoveRoutingTarget}
        />
      ) : null}

      <SingleAIConnectionPanel
        backends={backends}
        routingProfiles={profile ? [profile] : []}
        activeBackendId={selectedBackend?.id ?? null}
        onSelectBackend={onSelectBackend}
        onUpdateBackend={onUpdateBackend}
        onToggleBackend={onToggleBackend}
        onRemoveBackend={onRemoveBackend}
        onSetRoutingTargetEnabled={onSetRoutingTargetEnabled}
        backendErrors={backendErrors}
      />
    </div>
  )
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
