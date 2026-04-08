import type { SetupDraft, SetupStepId } from "../../contracts/setup"
import { getBackendDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"

const LANGUAGE_LABELS: Record<string, { ko: string; en: string }> = {
  ko: { ko: "한국어", en: "Korean" },
  en: { ko: "영어", en: "English" },
  ja: { ko: "일본어", en: "Japanese" },
  "zh-CN": { ko: "중국어(간체)", en: "Chinese (Simplified)" },
}

type ReviewStepId = Extract<SetupStepId, "personal" | "ai_backends" | "mcp" | "skills" | "security" | "channels" | "remote_access">

export function ReviewSummaryPanel({
  draft,
  reviewMessages = [],
  onSelectStep,
}: {
  draft: SetupDraft
  reviewMessages?: string[]
  onSelectStep?: (stepId: ReviewStepId) => void
}) {
  const enabledBackends = draft.aiBackends.filter((backend) => backend.enabled)
  const enabledMcpServers = draft.mcp.servers.filter((server) => server.enabled)
  const enabledSkills = draft.skills.items.filter((item) => item.enabled)
  const telegramReady = draft.channels.telegramEnabled && Boolean(draft.channels.botToken.trim())
  const slackReady = draft.channels.slackEnabled
    && Boolean(draft.channels.slackBotToken.trim())
    && Boolean(draft.channels.slackAppToken.trim())
  const { text, displayText, language } = useUiI18n()

  const languageLabel = LANGUAGE_LABELS[draft.personal.language]
    ? text(LANGUAGE_LABELS[draft.personal.language].ko, LANGUAGE_LABELS[draft.personal.language].en)
    : draft.personal.language

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border px-4 py-4 text-sm ${reviewMessages.length > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        <div className="font-semibold">{reviewMessages.length > 0 ? text("아직 확인이 더 필요합니다", "More checks are still needed") : text("완료 준비가 끝났습니다", "Ready to finish")}</div>
        <div className="mt-2 leading-6">
          {reviewMessages.length > 0
            ? displayText(reviewMessages[0])
            : text("필수 단계 입력이 끝났습니다. 아래 요약을 확인한 뒤 설정 완료를 진행하면 됩니다.", "Required inputs are complete. Review the summary below, then finish setup.")}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SummaryCard title={text("개인 정보", "Personal")} stepId="personal" onSelectStep={onSelectStep} text={text}>
          <div>{text("이름", "Name")}: {draft.personal.profileName}</div>
          <div>{text("표시 이름", "Display Name")}: {draft.personal.displayName}</div>
          <div>{text("기본 언어", "Default Language")}: {languageLabel}</div>
          <div>{text("시간대", "Timezone")}: {draft.personal.timezone}</div>
          <div className="break-all">{text("기본 작업 폴더", "Default Workspace")}: {draft.personal.workspace}</div>
        </SummaryCard>
        <SummaryCard title={text("보안", "Security")} stepId="security" onSelectStep={onSelectStep} text={text}>
          <div>{text("모드", "Mode")}: {draft.security.approvalMode}</div>
          <div>{text("타임아웃", "Timeout")}: {draft.security.approvalTimeout}{text("초", "s")}</div>
          <div>{text("자동 후속 처리", "Automatic Follow-up")}: {draft.security.maxDelegationTurns === 0 ? text("무제한", "Unlimited") : `${draft.security.maxDelegationTurns}${text("회", " runs")}`}</div>
        </SummaryCard>
      </div>

      <SummaryCard title={text("AI 연결", "AI Connection")} stepId="ai_backends" onSelectStep={onSelectStep} text={text}>
        <div className="flex flex-wrap gap-2">
          {enabledBackends.length > 0 ? enabledBackends.map((backend) => (
            <span key={backend.id} className="rounded-full bg-white px-3 py-1 text-xs text-stone-700">
              {getBackendDisplayLabel(backend.id, backend.label, language)} · {backend.defaultModel}
              {backend.providerType === "openai"
                ? ` · ${backend.authMode === "chatgpt_oauth" ? text("ChatGPT OAuth", "ChatGPT OAuth") : text("API Key", "API Key")}`
                : ""}
            </span>
          )) : <EmptyChip text={text("활성화된 AI 연결이 없습니다.", "No active AI connection is enabled.")} />}
        </div>
      </SummaryCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SummaryCard title={text("외부 기능 연결 (MCP)", "External Tool Connections (MCP)")} stepId="mcp" onSelectStep={onSelectStep} text={text}>
          <div className="space-y-2">
            {enabledMcpServers.length > 0 ? enabledMcpServers.map((server) => (
              <div key={server.id} className="rounded-xl bg-white px-3 py-2 text-sm text-stone-700">
                <span className="font-medium">{server.name}</span>
                <span className="text-stone-500"> · {server.transport} · {server.tools.length > 0 ? text(`${server.tools.length}개 도구`, `${server.tools.length} tools`) : text("도구 미확인", "Tools not checked")}</span>
              </div>
            )) : <EmptyBox text={text("활성화된 MCP 서버가 없습니다.", "No enabled MCP servers.")} />}
          </div>
        </SummaryCard>
        <SummaryCard title={text("작업 능력 확장 (Skill)", "Skill Extensions")} stepId="skills" onSelectStep={onSelectStep} text={text}>
          <div className="space-y-2">
            {enabledSkills.length > 0 ? enabledSkills.map((item) => (
              <div key={item.id} className="rounded-xl bg-white px-3 py-2 text-sm text-stone-700">
                <span className="font-medium">{item.label}</span>
                <span className="text-stone-500"> · {item.source === "local" ? text("로컬 Skill", "Local Skill") : text("기본 Skill", "Built-in Skill")}</span>
              </div>
            )) : <EmptyBox text={text("활성화된 Skill이 없습니다.", "No enabled skills.")} />}
          </div>
        </SummaryCard>
      </div>

      <SummaryCard title={text("대화 채널 (Communication)", "Communication Channels")} stepId="channels" onSelectStep={onSelectStep} text={text}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-white px-3 py-3 text-sm text-stone-700">
            <div className="font-medium">Telegram</div>
            <div className="mt-1">{text("상태", "Status")}: {telegramReady ? text("준비됨", "Ready") : text("미설정", "Not configured")}</div>
            <div>{text("입력 채널", "Input Channel")}: {draft.channels.telegramEnabled ? text("켜짐", "On") : text("꺼짐", "Off")}</div>
          </div>
          <div className="rounded-xl bg-white px-3 py-3 text-sm text-stone-700">
            <div className="font-medium">Slack</div>
            <div className="mt-1">{text("상태", "Status")}: {slackReady ? text("준비됨", "Ready") : text("미설정", "Not configured")}</div>
            <div>{text("입력 채널", "Input Channel")}: {draft.channels.slackEnabled ? text("켜짐", "On") : text("꺼짐", "Off")}</div>
          </div>
        </div>
      </SummaryCard>

      <SummaryCard title={text("원격 접근", "Remote Access")} stepId="remote_access" onSelectStep={onSelectStep} text={text}>
        <div>{text("호스트", "Host")}: {draft.remoteAccess.host}</div>
        <div>{text("포트", "Port")}: {draft.remoteAccess.port}</div>
        <div>{text("인증", "Authentication")}: {draft.remoteAccess.authEnabled ? text("사용", "Enabled") : text("사용 안 함", "Disabled")}</div>
        <div>{text("MQTT", "MQTT")}: {draft.mqtt.enabled ? text("사용", "Enabled") : text("사용 안 함", "Disabled")}</div>
        {draft.mqtt.enabled ? (
          <>
            <div>{text("MQTT 호스트", "MQTT Host")}: {draft.mqtt.host}</div>
            <div>{text("MQTT 포트", "MQTT Port")}: {draft.mqtt.port}</div>
            <div>{text("MQTT 아이디", "MQTT Username")}: {draft.mqtt.username}</div>
          </>
        ) : null}
      </SummaryCard>
    </div>
  )
}

function SummaryCard({
  title,
  stepId,
  onSelectStep,
  text,
  children,
}: {
  title: string
  stepId: ReviewStepId
  onSelectStep?: (stepId: ReviewStepId) => void
  text: (ko: string, en: string) => string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-stone-900">{title}</div>
        {onSelectStep ? (
          <button
            type="button"
            onClick={() => onSelectStep(stepId)}
            className="rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700"
          >
            {text("이 단계 수정", "Edit This Step")}
          </button>
        ) : null}
      </div>
      <div className="mt-3 space-y-1 leading-6">{children}</div>
    </div>
  )
}

function EmptyBox({ text }: { text: string }) {
  return <div className="rounded-xl bg-white px-3 py-2 text-sm text-stone-500">{text}</div>
}

function EmptyChip({ text }: { text: string }) {
  return <span className="rounded-full bg-white px-3 py-1 text-xs text-stone-500">{text}</span>
}
