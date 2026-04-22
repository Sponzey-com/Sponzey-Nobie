import type { SetupChecksResponse, StatusResponse } from "../api/adapters/types"
import type { UiShellResponse } from "../api/client"
import { hasRequiredProviderCredentials } from "../contracts/ai"
import { countCapabilities, type FeatureCapability } from "../contracts/capabilities"
import type { SetupDraft, SetupState, SetupStepId, SetupStepMeta } from "../contracts/setup"
import { buildDoneRuntimeSummary, buildReviewReadinessBoard } from "./setup-readiness"
import { createSetupSteps } from "./setup-step-meta"
import { validateSetupStep } from "./setupFlow"
import {
  type VisualizationAlert,
  type VisualizationNode,
  type VisualizationScene,
  type VisualizationStatus,
} from "./setup-visualization"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export interface SetupVisualizationBuilderInput {
  draft: SetupDraft
  checks: SetupChecksResponse | null
  shell?: UiShellResponse | null
  status?: StatusResponse | null
  capabilities: FeatureCapability[]
  state: SetupState
  language: UiLanguage
  includeAdvancedOptionalScenes?: boolean
}

export interface SetupVisualizationRegistry {
  steps: SetupStepMeta[]
  scenes: VisualizationScene[]
  sceneOrder: string[]
  scenesById: Record<string, VisualizationScene>
  sceneIdByStepId: Partial<Record<SetupStepId, string>>
}

export function buildSetupVisualizationRegistry(input: SetupVisualizationBuilderInput): SetupVisualizationRegistry {
  const steps = createSetupSteps(input.capabilities, input.draft, input.state, input.language)
  const stepMap = new Map<SetupStepId, SetupStepMeta>(steps.map((step) => [step.id, step]))

  const scenes = steps.map((step) => buildSceneForStep(step.id, input, stepMap))
  if (input.includeAdvancedOptionalScenes) {
    scenes.splice(3, 0, buildAiRoutingScene(input, stepMap))
  }

  const scenesById: Record<string, VisualizationScene> = {}
  const sceneIdByStepId: Partial<Record<SetupStepId, string>> = {}
  for (const scene of scenes) {
    scenesById[scene.id] = scene
    for (const stepId of scene.semanticStepIds) {
      if (!(stepId in sceneIdByStepId)) {
        sceneIdByStepId[stepId] = scene.id
      }
    }
  }

  return {
    steps,
    scenes,
    sceneOrder: scenes.map((scene) => scene.id),
    scenesById,
    sceneIdByStepId,
  }
}

function buildSceneForStep(
  stepId: SetupStepId,
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  switch (stepId) {
    case "welcome":
      return buildWelcomeScene(input, stepMap)
    case "personal":
      return buildPersonalScene(input, stepMap)
    case "ai_backends":
      return buildAiBackendsScene(input, stepMap)
    case "mcp":
      return buildMcpScene(input, stepMap)
    case "skills":
      return buildSkillsScene(input, stepMap)
    case "security":
      return buildSecurityScene(input, stepMap)
    case "channels":
      return buildChannelsScene(input, stepMap)
    case "remote_access":
      return buildRemoteAccessScene(input, stepMap)
    case "review":
      return buildReviewScene(input, stepMap)
    case "done":
    default:
      return buildDoneScene(input, stepMap)
  }
}

function buildWelcomeScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const flowStepIds: SetupStepId[] = ["welcome", "personal", "ai_backends", "mcp", "skills", "security", "channels", "remote_access", "review", "done"]
  const nodes = flowStepIds.map((stepId) => {
    const step = stepMap.get(stepId)!
    const validationValid = stepId === "welcome" || stepId === "review" || stepId === "done"
      ? step.completed || stepId === "welcome" || stepId === "review"
      : validateSetupStep(stepId, input.draft).valid
    return {
      id: `node:${stepId}`,
      kind:
        stepId === "personal"
          ? "profile"
          : stepId === "ai_backends"
            ? "router"
            : stepId === "mcp"
              ? "mcp"
              : stepId === "skills"
                ? "skill"
                : stepId === "security"
                  ? "security"
                  : stepId === "channels"
                    ? "channel"
                    : stepId === "remote_access"
                      ? "remote"
                      : stepId === "done"
                        ? "team"
                        : "step",
      label: step.label,
      status: sceneStatusFromStep(step, validationValid),
      description: step.lockReason ?? step.description,
      badges: [
        step.required ? "required" : "optional",
        step.completed ? "prepared" : "pending",
        step.locked ? "locked" : "open",
      ],
      semanticStepIds: [stepId],
      draftOwnedByStepIds: [stepId],
    } satisfies VisualizationNode
  })

  return {
    id: sceneId("welcome"),
    label: stepMap.get("welcome")?.label ?? "Welcome",
    mode: "shared",
    semanticStepIds: ["welcome"],
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge:welcome:${index}`,
      from: node.id,
      to: nodes[index + 1]!.id,
      kind: "flow" as const,
      semanticStepIds: [flowStepIds[index]!, flowStepIds[index + 1]!],
    })),
    inspectorSections: [
      {
        id: "welcome:start",
        label: "Get started",
        description: "Entry actions and recommended next step.",
        fieldKeys: ["start", "quick_start", "advanced"],
      },
    ],
    alerts: buildAlerts("welcome", input, stepMap.get("welcome")),
  }
}

function buildPersonalScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("personal")!
  const validation = validateSetupStep("personal", input.draft)
  const aiStep = stepMap.get("ai_backends")
  const channelsStep = stepMap.get("channels")
  const profileName = input.draft.personal.profileName.trim()
  const displayName = input.draft.personal.displayName.trim()
  const language = input.draft.personal.language.trim()
  const timezone = input.draft.personal.timezone.trim()
  const workspace = input.draft.personal.workspace.trim()
  const workspaceError = validation.fieldErrors.workspace

  const nodes: VisualizationNode[] = [
    {
      id: "node:personal:identity",
      kind: "profile",
      label: displayName || profileName || "Identity",
      status: validation.fieldErrors.profileName || validation.fieldErrors.displayName ? "required" : "ready",
      description: profileName && displayName ? `${profileName} / ${displayName}` : step.description,
      badges: [
        profileName || "profileName",
        displayName || "displayName",
      ],
      semanticStepIds: ["personal"],
      draftOwnedByStepIds: ["personal"],
      inspectorId: "profile",
    },
    {
      id: "node:personal:language",
      kind: "step",
      label: language || "Language",
      status: validation.fieldErrors.language ? "required" : "ready",
      description: "Default response language",
      badges: ["language"],
      semanticStepIds: ["personal"],
      draftOwnedByStepIds: ["personal"],
      inspectorId: "preferences",
    },
    {
      id: "node:personal:timezone",
      kind: "step",
      label: timezone || "Timezone",
      status: validation.fieldErrors.timezone ? "required" : "ready",
      description: "Schedule and notification clock",
      badges: ["timezone"],
      semanticStepIds: ["personal"],
      draftOwnedByStepIds: ["personal"],
      inspectorId: "preferences",
    },
    {
      id: "node:personal:workspace",
      kind: "memory",
      label: workspace || "Workspace",
      status: !workspace ? "required" : workspaceError ? "error" : "ready",
      description: workspaceError || "Default location for file work and automation",
      badges: [workspace.startsWith("/") ? "absolute" : workspace ? "relative" : "empty"],
      semanticStepIds: ["personal"],
      draftOwnedByStepIds: ["personal"],
      inspectorId: "workspace",
    },
    {
      id: "node:personal:local_context",
      kind: "memory",
      label: "Local system context",
      status: workspace && !workspaceError ? "ready" : "draft",
      description: workspace || "Waiting for an absolute workspace path",
      badges: ["filesystem"],
      semanticStepIds: ["personal"],
      draftOwnedByStepIds: ["personal"],
    },
    {
      id: "node:personal:ai_context",
      kind: "router",
      label: "AI responses",
      status: relatedStepStatus(aiStep),
      description: "Language affects later prompts and reviews",
      badges: ["downstream"],
      semanticStepIds: ["personal", "ai_backends"],
    },
    {
      id: "node:personal:channel_context",
      kind: "channel",
      label: "Schedules and notifications",
      status: relatedStepStatus(channelsStep),
      description: "Timezone affects delivery timing and channel context",
      badges: ["downstream"],
      semanticStepIds: ["personal", "channels"],
    },
  ]

  const alerts: VisualizationAlert[] = [
    ...Object.entries(validation.fieldErrors).map(([fieldKey, message], index) => ({
      id: `alert:personal:${fieldKey}:${index}`,
      tone: fieldKey === "workspace" && message.includes("전체 경로") ? "error" as const : "warning" as const,
      message,
      semanticStepIds: ["personal"],
      relatedNodeIds: [fieldKey === "language"
        ? "node:personal:language"
        : fieldKey === "timezone"
          ? "node:personal:timezone"
          : fieldKey === "workspace"
            ? "node:personal:workspace"
            : "node:personal:identity"],
    })),
  ]

  return {
    id: sceneId("personal"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["personal"],
    nodes,
    edges: [
      {
        id: "edge:personal:identity:language",
        from: "node:personal:identity",
        to: "node:personal:language",
        kind: "depends",
        semanticStepIds: ["personal"],
      },
      {
        id: "edge:personal:identity:timezone",
        from: "node:personal:identity",
        to: "node:personal:timezone",
        kind: "depends",
        semanticStepIds: ["personal"],
      },
      {
        id: "edge:personal:identity:workspace",
        from: "node:personal:identity",
        to: "node:personal:workspace",
        kind: "depends",
        semanticStepIds: ["personal"],
      },
      {
        id: "edge:personal:workspace:local",
        from: "node:personal:workspace",
        to: "node:personal:local_context",
        kind: "belongs_to",
        semanticStepIds: ["personal"],
      },
      {
        id: "edge:personal:language:ai",
        from: "node:personal:language",
        to: "node:personal:ai_context",
        kind: "uses",
        semanticStepIds: ["personal", "ai_backends"],
      },
      {
        id: "edge:personal:timezone:channels",
        from: "node:personal:timezone",
        to: "node:personal:channel_context",
        kind: "uses",
        semanticStepIds: ["personal", "channels"],
      },
    ],
    inspectorSections: [
      {
        id: "profile",
        label: "Identity",
        description: "User identity values used across the UI.",
        fieldKeys: ["profileName", "displayName"],
      },
      {
        id: "preferences",
        label: "Preferences",
        description: "Language and timezone influence downstream behavior.",
        fieldKeys: ["language", "timezone"],
      },
      {
        id: "workspace",
        label: "Workspace",
        description: "Absolute default workspace path.",
        fieldKeys: ["workspace"],
      },
    ],
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildAiBackendsScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("ai_backends")!
  const validation = validateSetupStep("ai_backends", input.draft)
  const enabledBackends = input.draft.aiBackends.filter((backend) => backend.enabled)
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const nodes: VisualizationNode[] = [
    {
      id: "node:ai:router",
      kind: "router",
      label: "Nobie Core Router",
      status:
        enabledBackends.length === 1
          ? validation.valid
            ? "ready"
            : "warning"
          : enabledBackends.length > 1
            ? "warning"
            : sceneStatusFromStep(step, validation.valid),
      description: t(
        "단일 AI 정책으로 한 번에 하나의 연결만 활성화됩니다. 라우팅 projection도 이 선택을 그대로 반영합니다.",
        "Single-AI policy keeps exactly one live backend. The routing projection mirrors the same selection.",
      ),
      badges: [
        `profiles:${input.draft.routingProfiles.length}`,
        enabledBackends.length === 1 ? "single-ai" : `active:${enabledBackends.length}`,
      ],
      semanticStepIds: ["ai_backends"],
      draftOwnedByStepIds: ["ai_backends"],
      inspectorId: "router",
    },
  ]

  if (input.draft.aiBackends.length === 0) {
    nodes.push({
      id: "node:ai:placeholder",
      kind: "ai_backend",
      label: t("준비된 연결 없음", "No backend configured"),
      status: "required",
      description: t("연결할 AI 공급자를 하나 선택하고 인증, 주소, 기본 모델을 입력해야 합니다.", "Choose one AI provider and fill in the credentials, endpoint, and default model."),
      badges: ["empty", "single-ai"],
      semanticStepIds: ["ai_backends"],
      draftOwnedByStepIds: ["ai_backends"],
    })
  } else {
    for (const backend of input.draft.aiBackends) {
      nodes.push({
        id: `node:ai:${backend.id}`,
        kind: "ai_backend",
        label: backend.label,
        status: getAiBackendVisualizationStatus(backend),
        description: getAiBackendNodeDescription(backend, input.language),
        badges: buildAiBackendBadges(backend),
        semanticStepIds: ["ai_backends"],
        draftOwnedByStepIds: ["ai_backends"],
        inspectorId: backend.id,
      })
    }
  }

  const alerts = [
    ...(buildAlerts("ai_backends", input, step) ?? []),
    ...buildAiBackendAlerts(input.draft.aiBackends, input.language),
    ...(enabledBackends.length > 1 ? [{
      id: "alert:ai_backends:multiple-enabled",
      tone: "warning" as const,
      message: t("단일 AI 정책과 다르게 여러 backend가 활성 상태입니다. 하나만 남기도록 정리해야 합니다.", "More than one backend is active. Keep only one backend enabled to satisfy the single-AI policy."),
      semanticStepIds: ["ai_backends"],
      relatedNodeIds: enabledBackends.map((backend) => `node:ai:${backend.id}`),
    }] : []),
  ]

  return {
    id: sceneId("ai_backends"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["ai_backends"],
    nodes,
    edges: nodes.slice(1).map((node) => ({
      id: `edge:ai:${node.id}`,
      from: "node:ai:router",
      to: node.id,
      kind: "uses" as const,
      status:
        node.status === "error"
          ? "error"
          : node.status === "required" || node.status === "warning"
            ? "warning"
            : "normal",
      semanticStepIds: ["ai_backends"],
    })),
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildMcpScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("mcp")!
  const validation = validateSetupStep("mcp", input.draft)
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const readyCount = input.draft.mcp.servers.filter((server) => server.status === "ready").length
  const requiredCount = input.draft.mcp.servers.filter((server) => server.required).length
  const enabledCount = input.draft.mcp.servers.filter((server) => server.enabled).length
  const nodes: VisualizationNode[] = [
    {
      id: "node:mcp:hub",
      kind: "mcp",
      label: t("MCP Capability Hub", "MCP Capability Hub"),
      status: input.draft.mcp.servers.length === 0 ? sceneStatusFromStep(step, validation.valid) : validation.valid ? "ready" : "warning",
      description: t(
        "연결된 MCP 서버가 제공할 외부 도구의 준비 상태를 한눈에 보여줍니다.",
        "Shows the readiness of external tools exposed by connected MCP servers.",
      ),
      badges: [
        `servers:${input.draft.mcp.servers.length}`,
        `required:${requiredCount}`,
        `ready:${readyCount}`,
        `enabled:${enabledCount}`,
      ],
      semanticStepIds: ["mcp"],
      draftOwnedByStepIds: ["mcp"],
      inspectorId: "hub",
    },
  ]

  if (input.draft.mcp.servers.length === 0) {
    nodes.push({
      id: "node:mcp:placeholder",
      kind: "mcp",
      label: t("준비된 MCP 서버 없음", "No MCP servers configured"),
      status: sceneStatusFromStep(step, validation.valid),
      description: step.description,
      badges: ["optional", "empty"],
      semanticStepIds: ["mcp"],
      draftOwnedByStepIds: ["mcp"],
    })
  } else {
    nodes.push(...input.draft.mcp.servers.map((server) => ({
      id: `node:mcp:${server.id}`,
      kind: "mcp" as const,
      label: server.name || server.id,
      status: getMcpServerVisualizationStatus(server),
      description: server.reason?.trim() || (server.transport === "http" ? server.url : server.command) || undefined,
      badges: [
        server.transport,
        server.required ? "required" : "optional",
        server.enabled ? "enabled" : "disabled",
        `tools:${server.tools.length}`,
      ],
      clusterId: `cluster:mcp:${server.transport}`,
      inspectorId: server.id,
      semanticStepIds: ["mcp"],
      draftOwnedByStepIds: ["mcp"],
    })))
  }

  const alerts = [
    ...(buildAlerts("mcp", input, step) ?? []),
    ...input.draft.mcp.servers
      .filter((server) => Boolean(server.reason?.trim()))
      .map((server) => ({
        id: `alert:mcp:${server.id}:reason`,
        tone: server.status === "error" ? "error" as const : "warning" as const,
        message: `${server.name || server.id}: ${server.reason ?? t("상태 확인 필요", "Check server status")}`,
        semanticStepIds: ["mcp"],
        relatedNodeIds: [`node:mcp:${server.id}`],
      })),
  ]

  return {
    id: sceneId("mcp"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["mcp"],
    nodes,
    edges: nodes
      .filter((node) => node.id !== "node:mcp:hub")
      .map((node) => ({
        id: `edge:mcp:${node.id}`,
        from: "node:mcp:hub",
        to: node.id,
        kind: "uses" as const,
        status:
          node.status === "error"
            ? "error"
            : node.status === "warning" || node.status === "required"
              ? "warning"
              : "normal",
        semanticStepIds: ["mcp"],
      })),
    clusters: input.draft.mcp.servers.length > 0 ? [
      {
        id: "cluster:mcp:stdio",
        label: "stdio",
        description: t("직접 실행되는 로컬 MCP 서버", "Directly launched local MCP servers"),
        nodeIds: nodes.filter((node) => node.clusterId === "cluster:mcp:stdio").map((node) => node.id),
        semanticStepIds: ["mcp"],
      },
      {
        id: "cluster:mcp:http",
        label: "http",
        description: t("원격 엔드포인트 기반 MCP 서버", "Endpoint-based MCP servers"),
        nodeIds: nodes.filter((node) => node.clusterId === "cluster:mcp:http").map((node) => node.id),
        semanticStepIds: ["mcp"],
      },
    ] : undefined,
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildSkillsScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("skills")!
  const validation = validateSetupStep("skills", input.draft)
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const readyCount = input.draft.skills.items.filter((item) => item.status === "ready").length
  const requiredCount = input.draft.skills.items.filter((item) => item.required).length
  const enabledCount = input.draft.skills.items.filter((item) => item.enabled).length
  const nodes: VisualizationNode[] = [
    {
      id: "node:skills:hub",
      kind: "skill",
      label: t("Skill Capability Map", "Skill Capability Map"),
      status: input.draft.skills.items.length === 0 ? sceneStatusFromStep(step, validation.valid) : validation.valid ? "ready" : "warning",
      description: t(
        "로컬 Skill과 기본 Skill이 어떤 상태로 준비되었는지 source별로 묶어 보여줍니다.",
        "Groups local and built-in skills by source so you can see what is ready at a glance.",
      ),
      badges: [
        `skills:${input.draft.skills.items.length}`,
        `required:${requiredCount}`,
        `ready:${readyCount}`,
        `enabled:${enabledCount}`,
      ],
      semanticStepIds: ["skills"],
      draftOwnedByStepIds: ["skills"],
      inspectorId: "hub",
    },
  ]

  if (input.draft.skills.items.length === 0) {
    nodes.push({
      id: "node:skills:placeholder",
      kind: "skill",
      label: t("준비된 Skill 없음", "No skills configured"),
      status: sceneStatusFromStep(step, validation.valid),
      description: step.description,
      badges: ["optional", "empty"],
      semanticStepIds: ["skills"],
      draftOwnedByStepIds: ["skills"],
    })
  } else {
    nodes.push(...input.draft.skills.items.map((skill) => ({
      id: `node:skills:${skill.id}`,
      kind: "skill" as const,
      label: skill.label || skill.id,
      status: getSkillVisualizationStatus(skill),
      description: skill.reason?.trim() || skill.description || getSkillNodeDescription(skill, input.language),
      badges: [
        skill.source,
        skill.required ? "required" : "optional",
        skill.enabled ? "enabled" : "disabled",
      ],
      clusterId: `cluster:skills:${skill.source}`,
      inspectorId: skill.id,
      semanticStepIds: ["skills"],
      draftOwnedByStepIds: ["skills"],
    })))
  }

  const alerts = [
    ...(buildAlerts("skills", input, step) ?? []),
    ...input.draft.skills.items
      .filter((item) => Boolean(item.reason?.trim()))
      .map((item) => ({
        id: `alert:skills:${item.id}:reason`,
        tone: item.status === "error" ? "error" as const : "warning" as const,
        message: `${item.label || item.id}: ${item.reason ?? t("상태 확인 필요", "Check skill status")}`,
        semanticStepIds: ["skills"],
        relatedNodeIds: [`node:skills:${item.id}`],
      })),
  ]

  return {
    id: sceneId("skills"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["skills"],
    nodes,
    edges: nodes
      .filter((node) => node.id !== "node:skills:hub")
      .map((node) => ({
        id: `edge:skills:${node.id}`,
        from: "node:skills:hub",
        to: node.id,
        kind: "uses" as const,
        status:
          node.status === "error"
            ? "error"
            : node.status === "warning" || node.status === "required"
              ? "warning"
              : "normal",
        semanticStepIds: ["skills"],
      })),
    clusters: input.draft.skills.items.length > 0 ? [
      {
        id: "cluster:skills:builtin",
        label: t("기본 Skill", "Built-in Skill"),
        description: t("경로 입력 없이 바로 쓸 수 있는 기본 항목", "Built-in entries that do not require a local path"),
        nodeIds: nodes.filter((node) => node.clusterId === "cluster:skills:builtin").map((node) => node.id),
        semanticStepIds: ["skills"],
      },
      {
        id: "cluster:skills:local",
        label: t("로컬 Skill", "Local Skill"),
        description: t("경로 확인이 필요한 로컬 Skill", "Local skills that require path validation"),
        nodeIds: nodes.filter((node) => node.clusterId === "cluster:skills:local").map((node) => node.id),
        semanticStepIds: ["skills"],
      },
    ] : undefined,
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function getMcpServerVisualizationStatus(server: SetupDraft["mcp"]["servers"][number]): VisualizationStatus {
  if (server.required && !server.enabled) {
    return "required"
  }
  if (server.enabled) {
    if (server.status === "error") {
      return "error"
    }
    if (server.status === "ready") {
      return "ready"
    }
    if (!server.name.trim()) {
      return "required"
    }
    if (server.transport === "stdio" && !server.command.trim()) {
      return "required"
    }
    if (server.transport === "http" && !server.url.trim()) {
      return "required"
    }
    return server.transport === "http" ? "warning" : "draft"
  }
  if (server.status === "error") {
    return "warning"
  }
  return "disabled"
}

function getSkillVisualizationStatus(item: SetupDraft["skills"]["items"][number]): VisualizationStatus {
  if (item.required && !item.enabled) {
    return "required"
  }
  if (item.enabled) {
    if (item.status === "error") {
      return "error"
    }
    if (item.status === "ready") {
      return "ready"
    }
    if (!item.label.trim()) {
      return "required"
    }
    if (item.source === "local" && !item.path.trim()) {
      return "required"
    }
    return "draft"
  }
  if (item.status === "error") {
    return "warning"
  }
  return "disabled"
}

function getSkillNodeDescription(
  item: SetupDraft["skills"]["items"][number],
  language: UiLanguage,
): string | undefined {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  if (item.description.trim()) {
    return item.description.trim()
  }
  if (item.source === "builtin") {
    return t("경로 입력 없이 사용할 수 있는 기본 Skill", "Built-in skill that does not require a local path")
  }
  if (item.path.trim()) {
    return t("경로는 Inspector에서 확인됩니다.", "The path is available in the inspector.")
  }
  return t("로컬 경로 확인이 필요합니다.", "Local path verification is required.")
}

function splitScopedIds(value: string): string[] {
  return value
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isLoopbackHost(value: string): boolean {
  return value === "" || value === "127.0.0.1" || value === "localhost"
}

function buildSecurityScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("security")!
  const validation = validateSetupStep("security", input.draft)
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const approvalEnabled = input.draft.security.approvalMode !== "off"
  const fallbackAllows = input.draft.security.approvalTimeoutFallback === "allow"
  const unlimitedDelegation = input.draft.security.maxDelegationTurns === 0
  const shortTimeout = input.draft.security.approvalTimeout <= 15
  const safeZoneStatus: VisualizationStatus = !approvalEnabled
    ? "warning"
    : fallbackAllows || unlimitedDelegation
      ? "warning"
      : "ready"
  const approvalGateStatus: VisualizationStatus = !approvalEnabled
    ? "disabled"
    : validation.fieldErrors.approvalTimeout
      ? "error"
      : input.draft.security.approvalMode === "always"
        ? "ready"
        : "draft"
  const timeoutStatus: VisualizationStatus = validation.fieldErrors.approvalTimeout
    ? "error"
    : fallbackAllows || shortTimeout
      ? "warning"
      : "ready"
  const delegationStatus: VisualizationStatus = validation.fieldErrors.maxDelegationTurns
    ? "error"
    : unlimitedDelegation
      ? "warning"
      : input.draft.security.maxDelegationTurns > 8
        ? "draft"
        : "ready"
  const restrictedZoneStatus: VisualizationStatus = !approvalEnabled && fallbackAllows
    ? "error"
    : !approvalEnabled || fallbackAllows || unlimitedDelegation
      ? "warning"
      : "ready"
  const alerts = [
    ...(buildAlerts("security", input, step) ?? []),
    ...(!approvalEnabled ? [{
      id: "alert:security:approval-disabled",
      tone: fallbackAllows ? "error" as const : "warning" as const,
      message: t(
        "승인 요청이 꺼져 있어 고위험 작업이 바로 실행될 수 있습니다.",
        "Approvals are disabled, so high-risk work may execute immediately.",
      ),
      semanticStepIds: ["security"],
      relatedNodeIds: ["node:security:approval_gate", "node:security:restricted_zone"],
    }] : []),
    ...(fallbackAllows ? [{
      id: "alert:security:fallback-allow",
      tone: approvalEnabled ? "warning" as const : "error" as const,
      message: t(
        "타임아웃 후 기본 동작이 허용으로 설정되어 있어 승인 응답이 없어도 작업이 계속될 수 있습니다.",
        "Timeout fallback is set to allow, so work may continue without an approval response.",
      ),
      semanticStepIds: ["security"],
      relatedNodeIds: ["node:security:timeout_policy", "node:security:restricted_zone"],
    }] : []),
    ...(unlimitedDelegation ? [{
      id: "alert:security:delegation-unlimited",
      tone: "warning" as const,
      message: t(
        "자동 후속 처리가 무제한이라 같은 작업이 길게 반복될 수 있습니다.",
        "Automatic follow-up is unlimited, so the same work can repeat for a long time.",
      ),
      semanticStepIds: ["security"],
      relatedNodeIds: ["node:security:delegation_limit", "node:security:restricted_zone"],
    }] : []),
    ...(shortTimeout && approvalEnabled ? [{
      id: "alert:security:timeout-short",
      tone: "info" as const,
      message: t(
        "승인 대기 시간이 짧아 응답 전에 타임아웃될 수 있습니다.",
        "The approval timeout is short and may expire before the user responds.",
      ),
      semanticStepIds: ["security"],
      relatedNodeIds: ["node:security:timeout_policy"],
    }] : []),
  ]

  return {
    id: sceneId("security"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["security"],
    nodes: [
      {
        id: "node:security:safe_zone",
        kind: "security",
        label: t("안전 구역", "Safe zone"),
        status: safeZoneStatus,
        description: t(
          "승인과 제한이 적용된 기본 작업 흐름입니다.",
          "The default execution path with approvals and limits applied.",
        ),
        badges: [
          input.draft.security.approvalMode,
          fallbackAllows ? "fallback:allow" : "fallback:deny",
        ],
        semanticStepIds: ["security"],
        draftOwnedByStepIds: ["security"],
        inspectorId: "policy",
      },
      {
        id: "node:security:approval_gate",
        kind: "approval",
        label: t("승인 게이트", "Approval gate"),
        status: approvalGateStatus,
        description: approvalEnabled
          ? t(
            "실행 전에 사용자 확인을 받을 지점을 정의합니다.",
            "Defines the point where the user is asked to approve execution.",
          )
          : t("현재 승인이 비활성화되어 있습니다.", "Approvals are currently disabled."),
        badges: [
          input.draft.security.approvalMode,
          `timeout:${input.draft.security.approvalTimeout}s`,
        ],
        semanticStepIds: ["security"],
        draftOwnedByStepIds: ["security"],
        inspectorId: "policy",
      },
      {
        id: "node:security:timeout_policy",
        kind: "approval",
        label: t("타임아웃 경계", "Timeout boundary"),
        status: timeoutStatus,
        description: t(
          "응답이 없을 때 deny/allow 중 어떤 경로를 기본값으로 탈지 보여줍니다.",
          "Shows which deny/allow path becomes the default when no response arrives.",
        ),
        badges: [
          `timeout:${input.draft.security.approvalTimeout}s`,
          input.draft.security.approvalTimeoutFallback,
        ],
        semanticStepIds: ["security"],
        draftOwnedByStepIds: ["security"],
        inspectorId: "timeout",
      },
      {
        id: "node:security:delegation_limit",
        kind: "security",
        label: t("후속 처리 제한", "Delegation limit"),
        status: delegationStatus,
        description: unlimitedDelegation
          ? t("자동 후속 처리가 무제한입니다.", "Automatic follow-up is unlimited.")
          : t(
            "연속 후속 처리를 몇 번까지 허용할지 정합니다.",
            "Controls how many chained follow-up turns are allowed.",
          ),
        badges: [
          unlimitedDelegation ? "unlimited" : `turns:${input.draft.security.maxDelegationTurns}`,
          approvalEnabled ? "guarded" : "unguarded",
        ],
        semanticStepIds: ["security"],
        draftOwnedByStepIds: ["security"],
        inspectorId: "delegation",
      },
      {
        id: "node:security:restricted_zone",
        kind: "security",
        label: t("제한 구역", "Restricted zone"),
        status: restrictedZoneStatus,
        description: t(
          "Fallback와 delegation 설정이 쌓였을 때 실제 위험이 모이는 구간입니다.",
          "This is where the real risk accumulates when fallback and delegation rules stack up.",
        ),
        badges: [
          input.draft.security.approvalMode === "off" ? "direct-run" : "approval-first",
          unlimitedDelegation ? "unlimited" : "bounded",
        ],
        semanticStepIds: ["security"],
        draftOwnedByStepIds: ["security"],
        inspectorId: "policy",
      },
    ],
    edges: [
      {
        id: "edge:security:safe:approval",
        from: "node:security:safe_zone",
        to: "node:security:approval_gate",
        kind: "protected_by",
        semanticStepIds: ["security"],
      },
      {
        id: "edge:security:approval:timeout",
        from: "node:security:approval_gate",
        to: "node:security:timeout_policy",
        kind: "depends",
        status: timeoutStatus === "error" ? "error" : timeoutStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["security"],
      },
      {
        id: "edge:security:approval:delegation",
        from: "node:security:approval_gate",
        to: "node:security:delegation_limit",
        kind: "depends",
        status: delegationStatus === "error" ? "error" : delegationStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["security"],
      },
      {
        id: "edge:security:timeout:restricted",
        from: "node:security:timeout_policy",
        to: "node:security:restricted_zone",
        kind: "flow",
        status: restrictedZoneStatus === "error" ? "error" : restrictedZoneStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["security"],
      },
      {
        id: "edge:security:delegation:restricted",
        from: "node:security:delegation_limit",
        to: "node:security:restricted_zone",
        kind: "flow",
        status: restrictedZoneStatus === "error" ? "error" : restrictedZoneStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["security"],
      },
    ],
    inspectorSections: [
      {
        id: "policy",
        label: t("승인 정책", "Approval policy"),
        description: t(
          "승인 모드와 제한 구역 기본 정책을 편집합니다.",
          "Edit the approval mode and the default restricted-zone policy.",
        ),
        fieldKeys: ["approvalMode", "approvalTimeoutFallback"],
      },
      {
        id: "timeout",
        label: t("타임아웃", "Timeout"),
        description: t("응답 대기 시간을 편집합니다.", "Edit the approval wait time."),
        fieldKeys: ["approvalTimeout"],
      },
      {
        id: "delegation",
        label: t("후속 처리", "Delegation"),
        description: t("자동 후속 처리 제한을 편집합니다.", "Edit the automatic follow-up limit."),
        fieldKeys: ["maxDelegationTurns"],
      },
    ],
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildChannelsScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("channels")!
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const telegramTokenReady = input.draft.channels.botToken.trim().length > 0
  const slackBotReady = input.draft.channels.slackBotToken.trim().length > 0
  const slackAppReady = input.draft.channels.slackAppToken.trim().length > 0
  const telegramConfigured = input.shell?.runtimeHealth.channels.telegramConfigured ?? input.checks?.telegramConfigured ?? telegramTokenReady
  const slackConfigured = input.shell?.runtimeHealth.channels.slackConfigured ?? (slackBotReady && slackAppReady)
  const telegramRuntime = input.shell?.runtimeHealth.channels.telegramEnabled ?? false
  const slackRuntime = input.shell?.runtimeHealth.channels.slackEnabled ?? false
  const webuiRuntime = input.shell?.runtimeHealth.channels.webui ?? true
  const telegramScoped = splitScopedIds(input.draft.channels.allowedUserIds).length > 0
    || splitScopedIds(input.draft.channels.allowedGroupIds).length > 0
  const slackScoped = splitScopedIds(input.draft.channels.slackAllowedUserIds).length > 0
    || splitScopedIds(input.draft.channels.slackAllowedChannelIds).length > 0
  const telegramStatus = input.draft.channels.telegramEnabled
    ? !telegramTokenReady
      ? "required"
      : telegramRuntime
        ? "ready"
        : "warning"
    : telegramTokenReady
      ? telegramRuntime
        ? "warning"
        : "draft"
      : telegramRuntime
        ? "warning"
        : "disabled"
  const slackStatus = input.draft.channels.slackEnabled
    ? !slackBotReady || !slackAppReady
      ? "required"
      : slackRuntime
        ? "ready"
        : "warning"
    : slackBotReady || slackAppReady
      ? slackRuntime
        ? "warning"
        : "draft"
      : slackRuntime
        ? "warning"
        : "disabled"
  const activeRuntimeCount = Number(telegramRuntime) + Number(slackRuntime)
  const alerts = [
    ...(buildAlerts("channels", input, step) ?? []),
    ...(input.draft.channels.telegramEnabled && telegramTokenReady && !telegramRuntime ? [{
      id: "alert:channels:telegram-runtime",
      tone: "warning" as const,
      message: t(
        "Telegram 정보는 저장되었지만 런타임이 아직 시작되지 않았습니다.",
        "Telegram is configured, but the runtime has not started yet.",
      ),
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:telegram"],
    }] : []),
    ...(input.draft.channels.slackEnabled && slackBotReady && slackAppReady && !slackRuntime ? [{
      id: "alert:channels:slack-runtime",
      tone: "warning" as const,
      message: t(
        "Slack 정보는 저장되었지만 런타임이 아직 시작되지 않았습니다.",
        "Slack is configured, but the runtime has not started yet.",
      ),
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:slack"],
    }] : []),
    ...(input.draft.channels.telegramEnabled && !telegramScoped ? [{
      id: "alert:channels:telegram-policy-open",
      tone: "info" as const,
      message: t(
        "Telegram 허용 ID가 비어 있어 정책 범위가 넓습니다.",
        "Telegram allowed IDs are empty, so the policy scope is broad.",
      ),
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:telegram"],
    }] : []),
    ...(input.draft.channels.slackEnabled && !slackScoped ? [{
      id: "alert:channels:slack-policy-open",
      tone: "info" as const,
      message: t(
        "Slack 허용 ID가 비어 있어 정책 범위가 넓습니다.",
        "Slack allowed IDs are empty, so the policy scope is broad.",
      ),
      semanticStepIds: ["channels"],
      relatedNodeIds: ["node:channels:slack"],
    }] : []),
  ]

  return {
    id: sceneId("channels"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["channels"],
    nodes: [
      {
        id: "node:channels:webui",
        kind: "channel",
        label: "WebUI",
        status: webuiRuntime ? "ready" : "warning",
        description: t(
          "기본 내장 채널이며 외부 메신저 런타임 재시작의 기준점입니다.",
          "Built-in root channel and the anchor point for external runtime restarts.",
        ),
        badges: [
          "builtin",
          webuiRuntime ? "runtime:ready" : "runtime:warning",
          `external:${activeRuntimeCount}`,
        ],
        semanticStepIds: ["channels"],
        draftOwnedByStepIds: ["channels"],
        inspectorId: "webui",
      },
      {
        id: "node:channels:telegram",
        kind: "channel",
        label: "Telegram",
        status: telegramStatus,
        description: input.draft.channels.telegramEnabled
          ? telegramRuntime
            ? t("입력 채널과 런타임이 모두 활성화되어 있습니다.", "The input channel and runtime are both active.")
            : t("설정은 저장할 수 있지만 런타임 재시작 전까지는 ready가 아닙니다.", "The configuration can be saved, but it is not ready until the runtime restarts.")
          : telegramConfigured
            ? t("토큰은 있지만 현재 입력 채널은 꺼져 있습니다.", "A token exists, but the input channel is currently disabled.")
            : t("아직 Telegram 입력 채널이 준비되지 않았습니다.", "Telegram input is not configured yet."),
        badges: [
          input.draft.channels.telegramEnabled ? "enabled" : "disabled",
          telegramTokenReady ? "token:ready" : "token:missing",
          telegramScoped ? "policy:scoped" : "policy:open",
          telegramRuntime ? "runtime:ready" : telegramConfigured ? "runtime:stopped" : "runtime:idle",
        ],
        semanticStepIds: ["channels"],
        draftOwnedByStepIds: ["channels"],
        inspectorId: "telegram",
      },
      {
        id: "node:channels:slack",
        kind: "channel",
        label: "Slack",
        status: slackStatus,
        description: input.draft.channels.slackEnabled
          ? slackRuntime
            ? t("입력 채널과 Socket Mode 런타임이 모두 활성화되어 있습니다.", "The input channel and Socket Mode runtime are both active.")
            : t("설정은 저장되었지만 Socket Mode 런타임이 아직 시작되지 않았습니다.", "The configuration is saved, but the Socket Mode runtime has not started yet.")
          : slackConfigured
            ? t("토큰은 있지만 현재 입력 채널은 꺼져 있습니다.", "Tokens exist, but the input channel is currently disabled.")
            : t("아직 Slack 입력 채널이 준비되지 않았습니다.", "Slack input is not configured yet."),
        badges: [
          input.draft.channels.slackEnabled ? "enabled" : "disabled",
          slackBotReady ? "bot:ready" : "bot:missing",
          slackAppReady ? "app:ready" : "app:missing",
          slackScoped ? "policy:scoped" : "policy:open",
          slackRuntime ? "runtime:ready" : slackConfigured ? "runtime:stopped" : "runtime:idle",
        ],
        semanticStepIds: ["channels"],
        draftOwnedByStepIds: ["channels"],
        inspectorId: "slack",
      },
    ],
    edges: [
      {
        id: "edge:channels:webui:telegram",
        from: "node:channels:webui",
        to: "node:channels:telegram",
        kind: "flow",
        status: telegramStatus === "error" ? "error" : telegramStatus === "warning" || telegramStatus === "required" ? "warning" : "normal",
        semanticStepIds: ["channels"],
      },
      {
        id: "edge:channels:webui:slack",
        from: "node:channels:webui",
        to: "node:channels:slack",
        kind: "flow",
        status: slackStatus === "error" ? "error" : slackStatus === "warning" || slackStatus === "required" ? "warning" : "normal",
        semanticStepIds: ["channels"],
      },
    ],
    inspectorSections: [
      {
        id: "webui",
        label: "WebUI",
        description: t("기본 채널과 런타임 재시작 경계를 확인합니다.", "Review the built-in channel and runtime restart boundary."),
        fieldKeys: ["webui"],
      },
      {
        id: "telegram",
        label: "Telegram",
        description: t("Telegram 정책과 preflight를 분리해서 확인합니다.", "Review Telegram policy and preflight separately."),
        fieldKeys: ["telegramEnabled", "botToken", "allowedUserIds", "allowedGroupIds"],
      },
      {
        id: "slack",
        label: "Slack",
        description: t("Slack 정책과 preflight를 분리해서 확인합니다.", "Review Slack policy and preflight separately."),
        fieldKeys: ["slackEnabled", "slackBotToken", "slackAppToken", "slackAllowedUserIds", "slackAllowedChannelIds"],
      },
    ],
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildRemoteAccessScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("remote_access")!
  const validation = validateSetupStep("remote_access", input.draft)
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const host = input.draft.remoteAccess.host.trim()
  const authTokenState = input.draft.remoteAccess.authEnabled
    ? input.draft.remoteAccess.authToken.trim()
      ? "protected"
      : "missing"
    : input.draft.remoteAccess.authToken.trim()
      ? "draft"
      : "disabled"
  const authStatus: VisualizationStatus = input.draft.remoteAccess.authEnabled
    ? input.draft.remoteAccess.authToken.trim()
      ? "ready"
      : "error"
    : isLoopbackHost(host)
      ? "disabled"
      : "warning"
  const endpointStatus: VisualizationStatus = validation.fieldErrors.host || validation.fieldErrors.port
    ? "error"
    : host
      ? "ready"
      : "required"
  const mqttCredentialsReady = Boolean(input.draft.mqtt.username.trim() && input.draft.mqtt.password.trim())
  const mqttStatus: VisualizationStatus = input.draft.mqtt.enabled
    ? validation.fieldErrors.mqttUsername || validation.fieldErrors.mqttPassword || validation.fieldErrors.mqttHost || validation.fieldErrors.mqttPort
      ? "error"
      : mqttCredentialsReady
        ? "ready"
        : "required"
    : mqttCredentialsReady
      ? "draft"
      : "disabled"
  const externalZoneStatus: VisualizationStatus = !host || validation.fieldErrors.host || validation.fieldErrors.port
    ? "required"
    : !input.draft.remoteAccess.authEnabled && !isLoopbackHost(host)
      ? "warning"
      : input.draft.mqtt.enabled
        ? mqttStatus === "ready"
          ? "ready"
          : mqttStatus === "error"
            ? "error"
            : "warning"
        : "draft"
  const alerts = [
    ...(buildAlerts("remote_access", input, step) ?? []),
    ...(input.draft.remoteAccess.authEnabled && !input.draft.remoteAccess.authToken.trim() ? [{
      id: "alert:remote:auth-missing",
      tone: "error" as const,
      message: t("원격 접근 인증이 켜져 있지만 auth token이 비어 있습니다.", "Remote access auth is enabled, but the auth token is empty."),
      semanticStepIds: ["remote_access"],
      relatedNodeIds: ["node:remote:auth_boundary"],
    }] : []),
    ...(!input.draft.remoteAccess.authEnabled && !isLoopbackHost(host) ? [{
      id: "alert:remote:auth-open",
      tone: "warning" as const,
      message: t("로컬이 아닌 host에서 WebUI 인증이 꺼져 있습니다.", "WebUI auth is disabled on a non-local host."),
      semanticStepIds: ["remote_access"],
      relatedNodeIds: ["node:remote:auth_boundary", "node:remote:external_clients"],
    }] : []),
    ...(input.draft.mqtt.enabled && !mqttCredentialsReady ? [{
      id: "alert:remote:mqtt-credentials",
      tone: "error" as const,
      message: t("MQTT 브로커를 켜려면 username과 password가 모두 필요합니다.", "Username and password are both required to enable the MQTT broker."),
      semanticStepIds: ["remote_access"],
      relatedNodeIds: ["node:remote:mqtt_bridge"],
    }] : []),
    ...((input.shell?.runtimeHealth.yeonjang.connectedExtensions ?? 0) > 0 ? [{
      id: "alert:remote:yeonjang-link",
      tone: "info" as const,
      message: t(
        `Yeonjang 연결 ${input.shell?.runtimeHealth.yeonjang.connectedExtensions ?? 0}개는 MQTT bridge와 관련 있지만 이 장면의 하위 노드는 아닙니다.`,
        `${input.shell?.runtimeHealth.yeonjang.connectedExtensions ?? 0} Yeonjang connections are related to the MQTT bridge, but they are not subordinate nodes in this scene.`,
      ),
      semanticStepIds: ["remote_access"],
      relatedNodeIds: ["node:remote:mqtt_bridge", "node:remote:external_clients"],
    }] : []),
  ]

  return {
    id: sceneId("remote_access"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["remote_access"],
    nodes: [
      {
        id: "node:remote:endpoint",
        kind: "remote",
        label: t("Host / Port", "Host / Port"),
        status: endpointStatus,
        badges: [
          host || "host:missing",
          `port:${input.draft.remoteAccess.port}`,
        ],
        description: host ? `${host}:${input.draft.remoteAccess.port}` : t("원격 접근 endpoint를 먼저 확인해야 합니다.", "Review the remote access endpoint first."),
        semanticStepIds: ["remote_access"],
        draftOwnedByStepIds: ["remote_access"],
        inspectorId: "endpoint",
      },
      {
        id: "node:remote:auth_boundary",
        kind: "security",
        label: t("Auth boundary", "Auth boundary"),
        status: authStatus,
        badges: [
          input.draft.remoteAccess.authEnabled ? "auth:on" : "auth:off",
          `token:${authTokenState}`,
        ],
        description: input.draft.remoteAccess.authEnabled
          ? t("WebUI 인증 경계를 유지합니다.", "Keeps the WebUI authentication boundary in place.")
          : t("인증이 꺼져 있어 host 경계만 남아 있습니다.", "Authentication is off, so only the host boundary remains."),
        semanticStepIds: ["remote_access"],
        draftOwnedByStepIds: ["remote_access"],
        inspectorId: "auth",
      },
      {
        id: "node:remote:mqtt_bridge",
        kind: "remote",
        label: t("MQTT bridge", "MQTT bridge"),
        status: mqttStatus,
        badges: [
          input.draft.mqtt.enabled ? "mqtt:on" : "mqtt:off",
          `port:${input.draft.mqtt.port}`,
          `yeonjang:${input.shell?.runtimeHealth.yeonjang.connectedExtensions ?? 0}`,
        ],
        description: `${input.draft.mqtt.host}:${input.draft.mqtt.port}`,
        semanticStepIds: ["remote_access"],
        draftOwnedByStepIds: ["remote_access"],
        inspectorId: "mqtt",
      },
      {
        id: "node:remote:external_clients",
        kind: "remote",
        label: t("External client zone", "External client zone"),
        status: externalZoneStatus,
        badges: [
          input.draft.remoteAccess.authEnabled ? "guarded" : "open",
          input.draft.mqtt.enabled ? "mqtt-path" : "webui-only",
        ],
        description: t(
          "브라우저와 extension client가 만나는 외부 경계입니다.",
          "The external boundary where browsers and extension clients meet.",
        ),
        semanticStepIds: ["remote_access"],
        draftOwnedByStepIds: ["remote_access"],
        inspectorId: "endpoint",
      },
    ],
    edges: [
      {
        id: "edge:remote:endpoint:auth",
        from: "node:remote:endpoint",
        to: "node:remote:auth_boundary",
        kind: "protected_by",
        status: authStatus === "error" ? "error" : authStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["remote_access"],
      },
      {
        id: "edge:remote:auth:external",
        from: "node:remote:auth_boundary",
        to: "node:remote:external_clients",
        kind: "flow",
        status: externalZoneStatus === "error" ? "error" : externalZoneStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["remote_access"],
      },
      {
        id: "edge:remote:auth:mqtt",
        from: "node:remote:auth_boundary",
        to: "node:remote:mqtt_bridge",
        kind: "uses",
        status: mqttStatus === "error" ? "error" : mqttStatus === "warning" || mqttStatus === "required" ? "warning" : "normal",
        semanticStepIds: ["remote_access"],
      },
      {
        id: "edge:remote:mqtt:external",
        from: "node:remote:mqtt_bridge",
        to: "node:remote:external_clients",
        kind: "flow",
        status: externalZoneStatus === "error" ? "error" : externalZoneStatus === "warning" ? "warning" : "normal",
        semanticStepIds: ["remote_access"],
      },
    ],
    inspectorSections: [
      {
        id: "endpoint",
        label: t("Endpoint", "Endpoint"),
        description: t("원격 host와 port를 편집합니다.", "Edit the remote host and port."),
        fieldKeys: ["host", "port"],
      },
      {
        id: "auth",
        label: t("Auth boundary", "Auth boundary"),
        description: t("인증 사용 여부와 token 상태를 편집합니다.", "Edit auth enablement and token state."),
        fieldKeys: ["authEnabled", "authToken"],
      },
      {
        id: "mqtt",
        label: "MQTT",
        description: t("MQTT bridge 설정을 편집합니다.", "Edit the MQTT bridge settings."),
        fieldKeys: ["mqtt.enabled", "mqtt.host", "mqtt.port", "mqtt.username", "mqtt.password"],
      },
    ],
    alerts: alerts.length > 0 ? alerts : undefined,
  }
}

function buildReviewScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("review")!
  const board = buildReviewReadinessBoard({
    draft: input.draft,
    steps: Array.from(stepMap.values()),
    checks: input.checks,
    shell: input.shell,
    capabilityCounts: countCapabilities(input.capabilities),
    language: input.language,
  })
  const tileKind = (stepId: SetupStepId): VisualizationNode["kind"] => {
    switch (stepId) {
      case "personal":
        return "profile"
      case "ai_backends":
        return "router"
      case "mcp":
        return "mcp"
      case "skills":
        return "skill"
      case "security":
        return "security"
      case "channels":
        return "channel"
      case "remote_access":
      default:
        return "remote"
    }
  }
  const toneToStatus = (tone: "ready" | "warning" | "error" | "draft"): VisualizationStatus => tone

  return {
    id: sceneId("review"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["review"],
    nodes: [
      {
        id: "node:review:board",
        kind: "team",
        label: step.label,
        status: board.overallTone === "ready" ? "ready" : "warning",
        description: board.overallMessage,
        badges: [`ready:${board.readyCount}/${board.totalCount}`, `capabilities:${board.capabilityReadyCount}/${board.capabilityTotalCount}`],
        semanticStepIds: ["review"],
      },
      ...board.tiles.map((tile) => ({
        id: `node:review:${tile.stepId}`,
        kind: tileKind(tile.stepId),
        label: tile.title,
        status: toneToStatus(tile.tone),
        description: tile.summary,
        badges: tile.badges,
        semanticStepIds: [tile.stepId, "review"],
        draftOwnedByStepIds: [tile.stepId],
      })),
    ],
    edges: board.tiles.map((tile) => ({
      id: `edge:review:${tile.stepId}`,
      from: "node:review:board",
      to: `node:review:${tile.stepId}`,
      kind: "flow" as const,
      status: tile.tone === "error" ? "error" : tile.tone === "warning" ? "warning" : "normal",
      semanticStepIds: [tile.stepId, "review"],
    })),
    alerts: [
      ...(buildAlerts("review", input, step) ?? []),
      ...board.missingLinks.slice(0, 3).map((issue) => ({
        id: `alert:review:${issue.id}`,
        tone: issue.tone,
        message: `${issue.title}: ${issue.description}`,
        semanticStepIds: ["review"],
        relatedNodeIds: issue.stepId ? [`node:review:${issue.stepId}`] : undefined,
      })),
      ...board.riskPaths.slice(0, 3).map((issue) => ({
        id: `alert:review:${issue.id}`,
        tone: issue.tone,
        message: `${issue.title}: ${issue.description}`,
        semanticStepIds: ["review"],
        relatedNodeIds: issue.stepId ? [`node:review:${issue.stepId}`] : undefined,
      })),
    ],
  }
}

function buildDoneScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const step = stepMap.get("done")!
  const summary = buildDoneRuntimeSummary({
    draft: input.draft,
    checks: input.checks,
    shell: input.shell,
    status: input.status,
    capabilityCounts: countCapabilities(input.capabilities),
    state: input.state,
    language: input.language,
  })
  const toneToStatus = (tone: "ready" | "warning" | "disabled"): VisualizationStatus => tone === "disabled" ? "disabled" : tone

  return {
    id: sceneId("done"),
    label: step.label,
    mode: "shared",
    semanticStepIds: ["done"],
    nodes: [
      {
        id: "node:done:setup",
        kind: "team",
        label: step.label,
        status: input.state.completed ? "ready" : "draft",
        description: summary.heroMessage,
        badges: [input.state.completed ? "completed" : "pending", `capabilities:${countCapabilities(input.capabilities).ready}`],
        semanticStepIds: ["done"],
      },
      ...summary.cards.map((card) => ({
        id: `node:done:${card.id}`,
        kind:
          card.id === "ai"
            ? "router"
            : card.id === "channels"
              ? "channel"
              : card.id === "extensions"
                ? "mcp"
                : card.id === "security"
                  ? "security"
                  : card.id === "orchestration"
                    ? "team"
                    : "memory",
        label: card.title,
        status: toneToStatus(card.tone),
        description: card.detail,
        badges: [card.value],
        semanticStepIds: ["done"],
      })),
    ],
    edges: summary.cards.map((card) => ({
      id: `edge:done:${card.id}`,
      from: "node:done:setup",
      to: `node:done:${card.id}`,
      kind: "belongs_to" as const,
      status: card.tone === "warning" ? "warning" : "normal",
      semanticStepIds: ["done"],
    })),
    alerts: buildAlerts("done", input, step),
  }
}

function buildAiRoutingScene(
  input: SetupVisualizationBuilderInput,
  stepMap: Map<SetupStepId, SetupStepMeta>,
): VisualizationScene {
  const baseStep = stepMap.get("ai_backends")
  const t = (korean: string, english: string) => pickUiText(input.language, korean, english)
  const primaryProfile = input.draft.routingProfiles[0]
  const routingTargets = input.draft.routingProfiles.flatMap((profile) => profile.targets)
  const targetIndexByBackendId = new Map(primaryProfile?.targets.map((target, index) => [target, index]) ?? [])
  const activeTargets = input.draft.aiBackends.filter((backend) => targetIndexByBackendId.has(backend.id))

  return {
    id: sceneId("ai_routing"),
    label: t("AI 라우팅", "AI Routing"),
    mode: "advanced",
    semanticStepIds: ["ai_routing", "ai_backends"],
    featureGateKey: "setup.ai_routing",
    nodes: [
      {
        id: "node:routing:profile",
        kind: "profile",
        label: primaryProfile?.label || t("기본 프로필", "Default profile"),
        status: routingTargets.length > 0 ? "ready" : "draft",
        description: t(
          "현재 라우팅 프로필이 어떤 backend 순서로 요청을 전달하는지 보여줍니다.",
          "Shows the order in which the current routing profile hands requests to backends.",
        ),
        badges: [
          `targets:${routingTargets.length}`,
          activeTargets.length <= 1 ? "single-ai" : `fanout:${activeTargets.length}`,
        ],
        semanticStepIds: ["ai_routing", "ai_backends"],
        draftOwnedByStepIds: ["ai_backends"],
      },
      {
        id: "node:routing:router",
        kind: "router",
        label: "Nobie Core Router",
        status: baseStep?.completed ? "ready" : "draft",
        description: t(
          "라우팅 화면은 연결 설정을 바꾸지 않고 현재 routingProfiles 의미만 시각적으로 보여줍니다.",
          "This routing scene does not invent new persistence. It visualizes the current routingProfiles semantics.",
        ),
        badges: ["advanced-only", activeTargets.length <= 1 ? "single-ai" : "multi-target"],
        semanticStepIds: ["ai_routing", "ai_backends"],
        draftOwnedByStepIds: ["ai_backends"],
      },
      ...input.draft.aiBackends.map((backend) => ({
        id: `node:routing:${backend.id}`,
        kind: "ai_backend" as const,
        label: backend.label,
        status: getAiBackendVisualizationStatus(backend),
        description: getAiBackendNodeDescription(backend, input.language),
        badges: [
          ...buildAiBackendBadges(backend).filter((badge) => badge !== "single-ai"),
          ...(targetIndexByBackendId.has(backend.id) ? [`priority:${(targetIndexByBackendId.get(backend.id) ?? 0) + 1}`] : ["unrouted"]),
        ],
        semanticStepIds: ["ai_routing", "ai_backends"],
        draftOwnedByStepIds: ["ai_backends"],
      })),
    ],
    edges: [
      {
        id: "edge:routing:profile:router",
        from: "node:routing:profile",
        to: "node:routing:router",
        kind: "flow",
        semanticStepIds: ["ai_routing", "ai_backends"],
      },
      ...input.draft.aiBackends.map((backend) => ({
        id: `edge:routing:router:${backend.id}`,
        from: "node:routing:router",
        to: `node:routing:${backend.id}`,
        kind: "uses" as const,
        status: targetIndexByBackendId.has(backend.id) ? "normal" : "warning",
        semanticStepIds: ["ai_routing", "ai_backends"],
      })),
    ],
    alerts: [
      ...(routingTargets.length === 0 ? [{
        id: "alert:ai_routing:empty",
        tone: "warning" as const,
        message: t("아직 라우팅 대상이 없습니다. 활성 backend를 선택하면 이 장면도 같이 채워집니다.", "No routing targets are assigned yet. Select an active backend to populate this scene."),
        semanticStepIds: ["ai_routing", "ai_backends"],
      }] : []),
      ...buildAiBackendAlerts(input.draft.aiBackends.filter((backend) => backend.enabled), input.language, "ai_routing"),
    ],
  }
}

function getAiBackendVisualizationStatus(backend: SetupDraft["aiBackends"][number]): VisualizationStatus {
  const hasEndpoint = Boolean(backend.endpoint?.trim())
  const hasModel = Boolean(backend.defaultModel.trim())
  const hasCredentials = hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode ?? "api_key")
  const hasConfiguredFields = hasEndpoint || hasModel || hasCredentials || Boolean(backend.reason?.trim())

  if (backend.enabled) {
    if (!hasEndpoint || !hasCredentials || !hasModel) {
      return "required"
    }
    if (backend.status === "error") {
      return "error"
    }
    if (backend.status === "ready") {
      return "ready"
    }
    return "draft"
  }

  if (!hasConfiguredFields) {
    return "disabled"
  }

  return backend.status === "error" ? "warning" : "draft"
}

function getAiBackendNodeDescription(
  backend: SetupDraft["aiBackends"][number],
  language: UiLanguage,
): string | undefined {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  if (backend.reason?.trim()) {
    return backend.reason
  }
  if (backend.defaultModel.trim() && backend.endpoint?.trim()) {
    return `${backend.defaultModel.trim()} · ${backend.endpoint.trim()}`
  }
  if (backend.defaultModel.trim()) {
    return `${t("기본 모델", "Default model")}: ${backend.defaultModel.trim()}`
  }
  if (backend.endpoint?.trim()) {
    return backend.endpoint.trim()
  }
  if (backend.summary.trim()) {
    return backend.summary.trim()
  }
  return undefined
}

function buildAiBackendBadges(backend: SetupDraft["aiBackends"][number]): string[] {
  const hasEndpoint = Boolean(backend.endpoint?.trim())
  const hasModel = Boolean(backend.defaultModel.trim())
  const hasCredentials = hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode ?? "api_key")

  return [
    backend.providerType,
    backend.enabled ? "active" : "standby",
    hasCredentials ? "auth:ready" : "auth:missing",
    hasEndpoint ? "endpoint:ready" : "endpoint:missing",
    hasModel ? "model:ready" : "model:missing",
    ...(backend.providerType === "openai" ? [backend.authMode === "chatgpt_oauth" ? "oauth" : "api-key"] : []),
  ]
}

function buildAiBackendAlerts(
  backends: SetupDraft["aiBackends"],
  language: UiLanguage,
  semanticStepId: "ai_backends" | "ai_routing" = "ai_backends",
): VisualizationAlert[] {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)

  return backends
    .filter((backend) => Boolean(backend.reason?.trim()))
    .map((backend) => ({
      id: `alert:${semanticStepId}:${backend.id}:reason`,
      tone: backend.status === "error" ? "error" : backend.enabled ? "warning" : "info",
      message: `${backend.label}: ${backend.reason ?? t("상태 확인 필요", "Check backend status")}`,
      semanticStepIds: [semanticStepId],
      relatedNodeIds: [
        semanticStepId === "ai_routing" ? `node:routing:${backend.id}` : `node:ai:${backend.id}`,
      ],
    }))
}

function buildAlerts(
  stepId: SetupStepId,
  input: SetupVisualizationBuilderInput,
  step?: SetupStepMeta,
): VisualizationAlert[] | undefined {
  if (stepId === "welcome" || stepId === "review" || stepId === "done") {
    if (step?.reason) {
      return [{
        id: `alert:${stepId}:reason`,
        tone: step.status === "error" ? "error" : "info",
        message: step.reason,
        semanticStepIds: [stepId],
      }]
    }
    return undefined
  }

  const validation = validateSetupStep(stepId, input.draft)
  const alerts: VisualizationAlert[] = []
  for (const [index, summary] of validation.summary.entries()) {
    alerts.push({
      id: `alert:${stepId}:${index}`,
      tone: summary.toLowerCase().includes("error") || step?.status === "error" ? "error" : "warning",
      message: summary,
      semanticStepIds: [stepId],
    })
  }
  if (step?.reason && alerts.every((alert) => alert.message !== step.reason)) {
    alerts.push({
      id: `alert:${stepId}:reason`,
      tone: step.status === "error" ? "error" : "info",
      message: step.reason,
      semanticStepIds: [stepId],
    })
  }
  return alerts.length > 0 ? alerts : undefined
}

function sceneStatusFromStep(step: SetupStepMeta, validationValid: boolean): VisualizationStatus {
  if (step.completed) return "ready"
  if (step.status === "error") return "error"
  if (step.status === "disabled") return validationValid ? "disabled" : "warning"
  if (step.status === "planned") return "planned"
  if (!validationValid) return step.required ? "required" : "warning"
  return step.required ? "required" : "draft"
}

function relatedStepStatus(step?: SetupStepMeta): VisualizationStatus {
  if (!step) return "planned"
  if (step.completed) return "ready"
  if (step.status === "error") return "error"
  if (step.status === "disabled") return "disabled"
  if (step.status === "planned") return "planned"
  return "draft"
}

function sceneId(stepId: SetupStepId | "ai_routing") {
  return `scene:${stepId}`
}
