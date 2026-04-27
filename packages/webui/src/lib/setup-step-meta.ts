import type { FeatureCapability } from "../contracts/capabilities"
import type { SetupDraft, SetupState, SetupStepMeta } from "../contracts/setup"
import { validateSetupStep } from "./setupFlow"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export function createSetupSteps(
  capabilities: FeatureCapability[],
  draft: SetupDraft,
  state: SetupState,
  language: UiLanguage,
): SetupStepMeta[] {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const telegramCapability = capabilities.find((item) => item.key === "telegram.channel")
  const slackCapability = capabilities.find((item) => item.key === "slack.channel")
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
        t("승인 타임아웃과 기본 동작을 확인합니다.", "Review approval timeouts and default behavior."),
        t("처음에는 기본값을 유지해도 됩니다.", "Keeping the defaults is fine at first."),
      ],
      hasSecurityDefaults,
    ),
    withSetupChannelCapability(
      "channels",
      t("대화 채널 (Communication)", "Communication"),
      t("메신저에서 Nobie와 대화할 채널을 연결합니다.", "Connect the messaging channels used to talk with Nobie."),
      telegramCapability ?? slackCapability,
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
  channels: {
    telegramEnabled: boolean
    botToken: string
    slackEnabled: boolean
    slackBotToken: string
    slackAppToken: string
  },
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
  const hasSlackConfig = Boolean(channels.slackBotToken.trim() && channels.slackAppToken.trim())
  const hasSavedChannel = (hasTelegramConfig && channels.telegramEnabled) || (hasSlackConfig && channels.slackEnabled)
  const reason = hasSavedChannel && capability.reason?.includes("런타임이 시작되지 않았습니다.")
    ? t("채널 정보는 저장되었습니다. 런타임 시작 상태는 채널 상세에서 확인할 수 있습니다.", "Channel details are saved. Check the channel details for runtime status.")
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
