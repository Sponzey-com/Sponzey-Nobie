import type { SetupChecksResponse, StatusResponse } from "../api/adapters/types"
import type { UiShellResponse } from "../api/client"
import type { CapabilityCounts } from "../contracts/capabilities"
import type { SetupDraft, SetupState, SetupStepId, SetupStepMeta } from "../contracts/setup"
import { validateSetupStep } from "./setupFlow"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type ReviewBoardStepId = Extract<SetupStepId, "personal" | "ai_backends" | "mcp" | "skills" | "security" | "channels" | "remote_access">
export type ReviewBoardTone = "ready" | "warning" | "error" | "draft"

export interface ReviewReadinessTile {
  stepId: ReviewBoardStepId
  title: string
  tone: ReviewBoardTone
  summary: string
  details: string[]
  badges: string[]
}

export interface ReviewReadinessIssue {
  id: string
  tone: "info" | "warning" | "error"
  title: string
  description: string
  stepId?: ReviewBoardStepId
}

export interface ReviewReadinessBoard {
  overallTone: "ready" | "warning"
  overallTitle: string
  overallMessage: string
  readyCount: number
  totalCount: number
  capabilityReadyCount: number
  capabilityTotalCount: number
  tiles: ReviewReadinessTile[]
  missingLinks: ReviewReadinessIssue[]
  riskPaths: ReviewReadinessIssue[]
  snapshot: Array<{ label: string; value: string }>
}

export interface DoneSummaryCard {
  id: "ai" | "channels" | "extensions" | "security" | "orchestration" | "storage"
  title: string
  value: string
  detail: string
  tone: "ready" | "warning" | "disabled"
}

export interface DoneNextAction {
  id: "dashboard" | "settings" | "agents"
  label: string
  href: string
  tone: "primary" | "secondary"
}

export interface DoneRuntimeSummary {
  heroTitle: string
  heroMessage: string
  cards: DoneSummaryCard[]
  actions: DoneNextAction[]
}

const REVIEW_STEP_IDS: ReviewBoardStepId[] = ["personal", "ai_backends", "mcp", "skills", "security", "channels", "remote_access"]

export function buildReviewReadinessBoard({
  draft,
  steps,
  checks,
  shell,
  capabilityCounts,
  language,
}: {
  draft: SetupDraft
  steps: SetupStepMeta[]
  checks: SetupChecksResponse | null
  shell?: UiShellResponse | null
  capabilityCounts: CapabilityCounts
  language: UiLanguage
}): ReviewReadinessBoard {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const tiles = REVIEW_STEP_IDS.map((stepId) => buildReviewTile(stepId, draft, steps, shell, language))
  const readyCount = tiles.filter((tile) => tile.tone === "ready").length
  const missingLinks: ReviewReadinessIssue[] = []
  const riskPaths: ReviewReadinessIssue[] = []

  if (!draft.aiBackends.some((backend) => backend.enabled)) {
    missingLinks.push({
      id: "missing:ai",
      tone: "error",
      title: t("활성 AI 연결 없음", "No active AI connection"),
      description: t("AI 연결 단계에서 하나의 backend를 활성화해야 합니다.", "Enable exactly one backend in the AI step."),
      stepId: "ai_backends",
    })
  }

  if (!draft.channels.telegramEnabled && !draft.channels.slackEnabled) {
    missingLinks.push({
      id: "missing:channels",
      tone: "error",
      title: t("활성 입력 채널 없음", "No active input channel"),
      description: t("Telegram 또는 Slack 입력 채널을 하나 이상 켜야 합니다.", "Enable at least one Telegram or Slack input channel."),
      stepId: "channels",
    })
  } else if ((draft.channels.telegramEnabled || draft.channels.slackEnabled) && !hasAnyLiveChannel(shell)) {
    missingLinks.push({
      id: "missing:channel-runtime",
      tone: "warning",
      title: t("채널 런타임 대기", "Channel runtime pending"),
      description: t(
        "채널 정보는 입력되었지만 실제 런타임 시작 상태는 아직 확인되지 않았습니다.",
        "Channel details are saved, but the live runtime state is not confirmed yet.",
      ),
      stepId: "channels",
    })
  }

  if (draft.remoteAccess.authEnabled && !draft.remoteAccess.authToken.trim()) {
    missingLinks.push({
      id: "missing:auth-token",
      tone: "error",
      title: t("WebUI 인증 토큰 누락", "WebUI auth token missing"),
      description: t("원격 접근 인증이 켜져 있으므로 토큰이 필요합니다.", "Remote access auth is enabled, so a token is required."),
      stepId: "remote_access",
    })
  }

  if (draft.mqtt.enabled && (!draft.mqtt.username.trim() || !draft.mqtt.password.trim())) {
    missingLinks.push({
      id: "missing:mqtt-credentials",
      tone: "error",
      title: t("MQTT 인증 정보 누락", "MQTT credentials missing"),
      description: t("MQTT 브로커를 켜려면 username과 password가 모두 필요합니다.", "Username and password are both required to enable the MQTT broker."),
      stepId: "remote_access",
    })
  }

  if (draft.security.approvalMode === "off") {
    riskPaths.push({
      id: "risk:approvals-off",
      tone: "warning",
      title: t("승인 게이트 비활성", "Approval gate disabled"),
      description: t("고위험 작업이 사용자 확인 없이 바로 실행될 수 있습니다.", "High-risk work may run without a user approval."),
      stepId: "security",
    })
  }

  if (draft.security.approvalTimeoutFallback === "allow") {
    riskPaths.push({
      id: "risk:fallback-allow",
      tone: "warning",
      title: t("타임아웃 허용 경로", "Timeout allow path"),
      description: t("승인 응답이 없어도 실행이 계속될 수 있습니다.", "Execution may continue even if no approval response arrives."),
      stepId: "security",
    })
  }

  if (draft.security.maxDelegationTurns === 0) {
    riskPaths.push({
      id: "risk:delegation-unlimited",
      tone: "warning",
      title: t("후속 처리 무제한", "Unlimited delegation"),
      description: t("같은 후속 작업이 길게 반복될 수 있습니다.", "The same follow-up work can repeat for a long time."),
      stepId: "security",
    })
  }

  if (!draft.remoteAccess.authEnabled && !isLoopbackHost(draft.remoteAccess.host.trim())) {
    riskPaths.push({
      id: "risk:remote-open",
      tone: "warning",
      title: t("열린 원격 경계", "Open remote boundary"),
      description: t("로컬이 아닌 호스트에서 인증이 꺼져 있습니다.", "Authentication is disabled on a non-local host."),
      stepId: "remote_access",
    })
  }

  const overallTone: "ready" | "warning" = missingLinks.some((issue) => issue.tone === "error") || riskPaths.length > 0 || readyCount < REVIEW_STEP_IDS.length
    ? "warning"
    : "ready"

  return {
    overallTone,
    overallTitle: overallTone === "ready"
      ? t("완료 준비가 끝났습니다", "Ready to finish")
      : t("아직 확인이 더 필요합니다", "More checks are still needed"),
    overallMessage: overallTone === "ready"
      ? t(
        "필수 단계와 연결 경계를 모두 확인했습니다. 아래 readiness board를 본 뒤 설정 완료를 진행하면 됩니다.",
        "Required steps and connection boundaries are ready. Review the readiness board below, then finish setup.",
      )
      : missingLinks[0]?.description
        ?? riskPaths[0]?.description
        ?? t("누락 연결과 위험 경로를 먼저 확인한 뒤 완료를 진행해야 합니다.", "Review missing links and risk paths before finishing."),
    readyCount,
    totalCount: REVIEW_STEP_IDS.length,
    capabilityReadyCount: capabilityCounts.ready,
    capabilityTotalCount: capabilityCounts.ready + capabilityCounts.disabled + capabilityCounts.planned + capabilityCounts.error,
    tiles,
    missingLinks,
    riskPaths,
    snapshot: [
      { label: t("Setup 완료", "Setup complete"), value: checks?.setupCompleted ? t("예", "Yes") : t("아니오", "No") },
      { label: t("설정 파일", "Config file"), value: checks?.configFile || "-" },
      { label: t("Setup state", "Setup state"), value: checks?.setupStateFile || "-" },
      { label: t("Telegram 토큰", "Telegram token"), value: checks?.telegramConfigured ? t("설정됨", "Configured") : t("비어 있음", "Empty") },
    ],
  }
}

export function buildDoneRuntimeSummary({
  draft,
  checks,
  shell,
  status,
  capabilityCounts,
  state,
  language,
}: {
  draft: SetupDraft
  checks: SetupChecksResponse | null
  shell?: UiShellResponse | null
  status?: StatusResponse | null
  capabilityCounts: CapabilityCounts
  state: SetupState
  language: UiLanguage
}): DoneRuntimeSummary {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const activeBackend = draft.aiBackends.find((backend) => backend.enabled) ?? null
  const liveChannelCount = countLiveChannels(shell)
  const enabledChannelCount = Number(draft.channels.telegramEnabled) + Number(draft.channels.slackEnabled)
  const enabledMcpCount = draft.mcp.servers.filter((server) => server.enabled).length
  const enabledSkillCount = draft.skills.items.filter((item) => item.enabled).length
  const orchestrationMode = status?.orchestration?.mode ?? status?.orchestratorStatus.mode ?? null
  const subAgentCount = status?.orchestration?.activeSubAgentCount ?? status?.orchestratorStatus.activeSubAgentCount ?? 0
  const orchestrationAvailable = orchestrationMode !== null

  const cards: DoneSummaryCard[] = [
    {
      id: "ai",
      title: t("활성 AI", "Active AI"),
      value: activeBackend?.label ?? t("없음", "None"),
      detail: activeBackend
        ? `${activeBackend.defaultModel || t("모델 미설정", "model missing")} · ${activeBackend.providerType}`
        : t("활성 backend가 아직 없습니다.", "There is no active backend yet."),
      tone: activeBackend ? "ready" : "warning",
    },
    {
      id: "channels",
      title: t("활성 채널", "Active channels"),
      value: liveChannelCount > 0 ? String(liveChannelCount) : String(enabledChannelCount),
      detail: liveChannelCount > 0
        ? t("실제 런타임 기준 활성 채널 수입니다.", "Active channel count based on the live runtime.")
        : enabledChannelCount > 0
          ? t("draft 기준으로 켜진 채널 수입니다. 실제 런타임은 dashboard에서 다시 확인하세요.", "Enabled channel count from the draft. Confirm the live runtime again on the dashboard.")
          : t("활성 입력 채널이 없습니다.", "There are no active input channels."),
      tone: liveChannelCount > 0 ? "ready" : enabledChannelCount > 0 ? "warning" : "disabled",
    },
    {
      id: "extensions",
      title: t("확장 연결", "Extensions"),
      value: `${enabledMcpCount}/${enabledSkillCount}`,
      detail: t(`MCP ${enabledMcpCount}개 · Skill ${enabledSkillCount}개`, `MCP ${enabledMcpCount} · Skill ${enabledSkillCount}`),
      tone: enabledMcpCount > 0 || enabledSkillCount > 0 ? "ready" : "disabled",
    },
    {
      id: "security",
      title: t("보안 경계", "Security boundary"),
      value: draft.security.approvalMode,
      detail: draft.security.maxDelegationTurns === 0
        ? t("fallback와 delegation 제한을 다시 확인해야 합니다.", "Review fallback and delegation limits again.")
        : `${draft.security.approvalTimeout}s · ${draft.security.approvalTimeoutFallback}`,
      tone: draft.security.approvalMode === "off" || draft.security.approvalTimeoutFallback === "allow" || draft.security.maxDelegationTurns === 0 ? "warning" : "ready",
    },
    {
      id: "orchestration",
      title: t("오케스트레이션", "Orchestration"),
      value: orchestrationAvailable ? orchestrationMode ?? "" : t("선택 사항", "Optional"),
      detail: orchestrationAvailable
        ? t(`활성 서브 에이전트 ${subAgentCount}개`, `${subAgentCount} active sub-agents`)
        : t("이 배포에서는 오케스트레이션 요약이 노출되지 않습니다.", "This deployment does not expose orchestration summary."),
      tone: orchestrationAvailable ? "ready" : "disabled",
    },
    {
      id: "storage",
      title: t("저장 상태", "Storage"),
      value: checks?.setupStateFile ? t("저장됨", "Saved") : t("대기", "Pending"),
      detail: checks?.configFile || checks?.setupStateFile || t("아직 저장된 setup snapshot이 없습니다.", "There is no saved setup snapshot yet."),
      tone: checks?.setupStateFile ? "ready" : state.completed ? "warning" : "disabled",
    },
  ]

  return {
    heroTitle: state.completed ? t("설정이 끝났습니다", "Setup is complete") : t("마지막 적용을 기다리고 있습니다", "Waiting for the final apply"),
    heroMessage: state.completed
      ? t(
        "현재 활성 구조를 확인한 뒤 dashboard, settings, orchestration 화면으로 바로 이동할 수 있습니다.",
        "Review the active structure, then jump straight to the dashboard, settings, or orchestration view.",
      )
      : t(
        "아직 setup 완료 호출 전입니다. 현재 snapshot을 먼저 확인한 뒤 마지막 적용을 진행하세요.",
        "The final setup completion has not been called yet. Review the current snapshot before the final apply.",
      ),
    cards,
    actions: [
      { id: "dashboard", label: t("대시보드로 이동", "Open dashboard"), href: "/advanced/dashboard", tone: "primary" },
      { id: "settings", label: t("설정 열기", "Open settings"), href: "/advanced/settings", tone: "secondary" },
      { id: "agents", label: t("에이전트 보기", "Open agents"), href: "/advanced/agents", tone: "secondary" },
    ],
  }
}

function buildReviewTile(
  stepId: ReviewBoardStepId,
  draft: SetupDraft,
  steps: SetupStepMeta[],
  shell: UiShellResponse | null | undefined,
  language: UiLanguage,
): ReviewReadinessTile {
  const step = steps.find((item) => item.id === stepId)
  const validation = validateSetupStep(stepId, draft)
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const defaultTone: ReviewBoardTone = !validation.valid
    ? step?.status === "error" ? "error" : "warning"
    : step?.completed
      ? "ready"
      : "draft"

  switch (stepId) {
    case "personal":
      return {
        stepId,
        title: step?.label ?? t("개인 정보", "Personal"),
        tone: defaultTone,
        summary: `${draft.personal.profileName || t("이름 없음", "No profile")} · ${draft.personal.language || "-"}`,
        details: [draft.personal.timezone || "-", draft.personal.workspace || t("작업 폴더 미입력", "Workspace missing")],
        badges: ["profile", draft.personal.workspace.trim() ? "workspace" : "workspace:missing"],
      }
    case "ai_backends": {
      const activeBackend = draft.aiBackends.find((backend) => backend.enabled)
      return {
        stepId,
        title: step?.label ?? t("AI 연결", "AI"),
        tone: defaultTone,
        summary: activeBackend
          ? `${activeBackend.label} · ${activeBackend.defaultModel || t("모델 미설정", "model missing")}`
          : t("활성 backend 없음", "No active backend"),
        details: [
          t(`활성 ${draft.aiBackends.filter((backend) => backend.enabled).length}개`, `${draft.aiBackends.filter((backend) => backend.enabled).length} active`),
          t(`라우팅 대상 ${draft.routingProfiles[0]?.targets.length ?? 0}개`, `${draft.routingProfiles[0]?.targets.length ?? 0} routing targets`),
        ],
        badges: ["single-ai", `configured:${draft.aiBackends.filter((backend) => backend.endpoint?.trim()).length}`],
      }
    }
    case "mcp":
      return {
        stepId,
        title: step?.label ?? "MCP",
        tone: defaultTone,
        summary: t(
          `활성 ${draft.mcp.servers.filter((server) => server.enabled).length}개 · ready ${draft.mcp.servers.filter((server) => server.status === "ready").length}개`,
          `${draft.mcp.servers.filter((server) => server.enabled).length} enabled · ${draft.mcp.servers.filter((server) => server.status === "ready").length} ready`,
        ),
        details: draft.mcp.servers.slice(0, 2).map((server) => `${server.name || server.id} · ${server.transport}`),
        badges: [`servers:${draft.mcp.servers.length}`],
      }
    case "skills":
      return {
        stepId,
        title: step?.label ?? t("Skill", "Skills"),
        tone: defaultTone,
        summary: t(
          `활성 ${draft.skills.items.filter((item) => item.enabled).length}개 · ready ${draft.skills.items.filter((item) => item.status === "ready").length}개`,
          `${draft.skills.items.filter((item) => item.enabled).length} enabled · ${draft.skills.items.filter((item) => item.status === "ready").length} ready`,
        ),
        details: draft.skills.items.slice(0, 2).map((item) => `${item.label || item.id} · ${item.source}`),
        badges: [`skills:${draft.skills.items.length}`],
      }
    case "security":
      return {
        stepId,
        title: step?.label ?? t("보안", "Security"),
        tone: defaultTone,
        summary: `${draft.security.approvalMode} · ${draft.security.approvalTimeout}s`,
        details: [
          `fallback:${draft.security.approvalTimeoutFallback}`,
          draft.security.maxDelegationTurns === 0 ? "delegation:unlimited" : `delegation:${draft.security.maxDelegationTurns}`,
        ],
        badges: [draft.security.approvalMode, draft.security.approvalTimeoutFallback],
      }
    case "channels":
      return {
        stepId,
        title: step?.label ?? t("채널", "Channels"),
        tone: defaultTone,
        summary: hasAnyLiveChannel(shell)
          ? t(`런타임 활성 ${countLiveChannels(shell)}개`, `${countLiveChannels(shell)} live channels`)
          : t(`draft 활성 ${Number(draft.channels.telegramEnabled) + Number(draft.channels.slackEnabled)}개`, `${Number(draft.channels.telegramEnabled) + Number(draft.channels.slackEnabled)} enabled in draft`),
        details: [
          `Telegram:${draft.channels.telegramEnabled ? "on" : "off"}`,
          `Slack:${draft.channels.slackEnabled ? "on" : "off"}`,
        ],
        badges: [shell?.runtimeHealth.channels.telegramEnabled ? "telegram:live" : "telegram:draft", shell?.runtimeHealth.channels.slackEnabled ? "slack:live" : "slack:draft"],
      }
    case "remote_access":
    default:
      return {
        stepId,
        title: step?.label ?? t("원격 접근", "Remote Access"),
        tone: defaultTone,
        summary: `${draft.remoteAccess.host}:${draft.remoteAccess.port}`,
        details: [
          draft.remoteAccess.authEnabled ? t("WebUI 인증 사용", "WebUI auth enabled") : t("WebUI 인증 비활성", "WebUI auth disabled"),
          draft.mqtt.enabled ? `MQTT:${draft.mqtt.host}:${draft.mqtt.port}` : "MQTT:off",
        ],
        badges: [draft.remoteAccess.authEnabled ? "auth:on" : "auth:off", draft.mqtt.enabled ? "mqtt:on" : "mqtt:off"],
      }
  }
}

function hasAnyLiveChannel(shell: UiShellResponse | null | undefined): boolean {
  return Boolean(shell?.runtimeHealth.channels.telegramEnabled || shell?.runtimeHealth.channels.slackEnabled)
}

function countLiveChannels(shell: UiShellResponse | null | undefined): number {
  return Number(Boolean(shell?.runtimeHealth.channels.telegramEnabled)) + Number(Boolean(shell?.runtimeHealth.channels.slackEnabled))
}

function isLoopbackHost(value: string): boolean {
  return value === "127.0.0.1" || value === "localhost" || value === ""
}
