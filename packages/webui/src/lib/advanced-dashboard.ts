import type { SetupChecksResponse, StatusResponse } from "../api/adapters/types"
import type { DoctorReport } from "../contracts/doctor"
import type { OperationsSummary } from "../contracts/operations"
import type { RootRun } from "../contracts/runs"
import type { SetupDraft } from "../contracts/setup"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"
import { formatWebUiErrorMessage } from "./message-catalog"

export type AdvancedDashboardCardId = "connections" | "recent_runs" | "pending_approvals" | "warnings" | "doctor"
export type AdvancedDashboardCardStatus = "ready" | "loading" | "error" | "idle"
export type AdvancedDashboardSourceKey = "status" | "runs" | "operations" | "doctor"

export interface AdvancedDashboardSources {
  status?: StatusResponse
  runs?: RootRun[]
  operations?: OperationsSummary
  doctor?: DoctorReport
}

export type AdvancedDashboardLoadErrors = Partial<Record<AdvancedDashboardSourceKey, string>>

export interface AdvancedDashboardCardView {
  id: AdvancedDashboardCardId
  title: string
  status: AdvancedDashboardCardStatus
  value: string
  summary: string
  items: string[]
  href: string
}

export interface AdvancedDashboardLoaders {
  status?: () => Promise<StatusResponse>
  runs?: () => Promise<RootRun[]>
  operations?: () => Promise<OperationsSummary>
  doctor?: () => Promise<DoctorReport>
}

function sanitizeError(error: unknown, language: UiLanguage): string {
  const raw = error instanceof Error ? error.message : String(error ?? "")
  return formatWebUiErrorMessage(raw, language).message
}

function sourceStatus(params: { loading: boolean; error?: string; hasData: boolean; emptyIsIdle?: boolean }): AdvancedDashboardCardStatus {
  if (params.error) return "error"
  if (params.loading && !params.hasData) return "loading"
  if (!params.hasData && params.emptyIsIdle) return "idle"
  return "ready"
}

export async function loadAdvancedDashboardSources(loaders: AdvancedDashboardLoaders, language: UiLanguage = "ko"): Promise<{
  sources: AdvancedDashboardSources
  errors: AdvancedDashboardLoadErrors
}> {
  const entries = Object.entries(loaders) as Array<[AdvancedDashboardSourceKey, () => Promise<unknown>]>
  const settled = await Promise.all(entries.map(async ([key, loader]) => {
    try {
      return { key, ok: true as const, value: await loader() }
    } catch (error) {
      return { key, ok: false as const, error: sanitizeError(error, language) }
    }
  }))

  const sources: AdvancedDashboardSources = {}
  const errors: AdvancedDashboardLoadErrors = {}
  for (const item of settled) {
    if (item.ok) {
      if (item.key === "status") sources.status = item.value as StatusResponse
      if (item.key === "runs") sources.runs = item.value as RootRun[]
      if (item.key === "operations") sources.operations = item.value as OperationsSummary
      if (item.key === "doctor") sources.doctor = item.value as DoctorReport
    } else {
      errors[item.key] = item.error
    }
  }
  return { sources, errors }
}

export function buildAdvancedDashboardCards(input: {
  draft: SetupDraft
  checks: SetupChecksResponse | null
  status?: StatusResponse | null
  runs?: RootRun[] | null
  operations?: OperationsSummary | null
  doctor?: DoctorReport | null
  errors?: AdvancedDashboardLoadErrors
  loading?: boolean
  language: UiLanguage
}): AdvancedDashboardCardView[] {
  const t = (ko: string, en: string) => pickUiText(input.language, ko, en)
  const errors = input.errors ?? {}
  const runs = input.runs ?? []
  const operations = input.operations ?? null
  const pendingRuns = runs.filter((run) => run.status === "awaiting_approval" || run.status === "awaiting_user")
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "cancelled" || run.status === "interrupted")
  const recentRuns = runs.slice(0, 5)
  const aiConfigured = Boolean(input.status?.primaryAiTarget || input.draft.aiBackends.some((backend) => backend.enabled && backend.defaultModel.trim()))
  const channelConfigured = Boolean(input.draft.channels.telegramEnabled || input.draft.channels.slackEnabled || input.checks?.telegramConfigured)
  const yeonjangConfigured = Boolean(input.status?.mqtt.running || input.draft.mqtt.enabled)
  const setupReady = Boolean(input.checks?.setupCompleted || input.status?.setupCompleted)
  const connectionCount = [aiConfigured, channelConfigured, yeonjangConfigured, setupReady].filter(Boolean).length
  const repeatedIssues = operations?.repeatedIssues ?? []
  const warningCount = repeatedIssues.length + failedRuns.length
  const doctorBlocked = input.doctor?.summary.blocked ?? 0
  const doctorWarning = input.doctor?.summary.warning ?? 0

  return [
    {
      id: "connections",
      title: t("연결 요약", "Connection summary"),
      status: sourceStatus({ loading: input.loading === true, error: errors.status, hasData: Boolean(input.status || input.checks), emptyIsIdle: false }),
      value: `${connectionCount}/4`,
      summary: errors.status ?? t("AI, 채널, 연장, 저장 상태를 한 번에 확인합니다.", "Review AI, channels, extension, and setup storage together."),
      items: [
        `${t("AI", "AI")}: ${aiConfigured ? t("준비됨", "ready") : t("확인 필요", "needs check")}`,
        `${t("채널", "Channels")}: ${channelConfigured ? t("준비됨", "ready") : t("선택", "optional")}`,
        `Yeonjang: ${yeonjangConfigured ? t("준비됨", "ready") : t("확인 필요", "needs check")}`,
        `${t("저장", "Storage")}: ${setupReady ? t("준비됨", "ready") : t("확인 필요", "needs check")}`,
      ],
      href: "/advanced/settings",
    },
    {
      id: "recent_runs",
      title: t("최근 실행", "Recent runs"),
      status: sourceStatus({ loading: input.loading === true, error: errors.runs, hasData: Boolean(input.runs), emptyIsIdle: true }),
      value: String(recentRuns.length),
      summary: errors.runs ?? (recentRuns[0]?.title || t("최근 실행이 없습니다.", "No recent runs.")),
      items: recentRuns.map((run) => `${run.title || run.prompt} · ${run.status} · ${run.source}`).slice(0, 4),
      href: "/advanced/runs",
    },
    {
      id: "pending_approvals",
      title: t("승인 대기", "Pending approvals"),
      status: sourceStatus({ loading: input.loading === true, error: errors.runs || errors.operations, hasData: Boolean(input.runs || operations), emptyIsIdle: true }),
      value: String(pendingRuns.length + (operations?.stale.pendingApprovals.length ?? 0)),
      summary: errors.runs || errors.operations || (pendingRuns.length > 0 ? t("사용자 확인이 필요한 실행이 있습니다.", "Some runs need user approval.") : t("대기 중인 승인이 없습니다.", "No pending approvals.")),
      items: pendingRuns.map((run) => `${run.title || run.prompt} · ${run.status}`).slice(0, 4),
      href: "/advanced/runs",
    },
    {
      id: "warnings",
      title: t("최근 실패/경고", "Recent failures and warnings"),
      status: sourceStatus({ loading: input.loading === true, error: errors.operations, hasData: Boolean(input.runs || operations), emptyIsIdle: true }),
      value: String(warningCount),
      summary: errors.operations ?? (warningCount > 0 ? t("확인할 실패 또는 반복 문제가 있습니다.", "There are failures or repeated issues to inspect.") : t("눈에 띄는 경고가 없습니다.", "No visible warnings.")),
      items: [
        ...repeatedIssues.map((issue) => `${issue.label} · ${issue.status} · ${issue.count}`),
        ...failedRuns.map((run) => `${run.title || run.prompt} · ${run.status}`),
      ].slice(0, 4),
      href: "/advanced/audit",
    },
    {
      id: "doctor",
      title: t("Doctor 요약", "Doctor summary"),
      status: sourceStatus({ loading: input.loading === true, error: errors.doctor, hasData: Boolean(input.doctor), emptyIsIdle: false }),
      value: input.doctor?.overallStatus ?? "-",
      summary: errors.doctor ?? (input.doctor ? t("운영 진단 결과를 요약했습니다.", "Operational diagnostics are summarized.") : t("진단 결과를 불러오는 중입니다.", "Loading diagnostics.")),
      items: input.doctor ? [
        `ok=${input.doctor.summary.ok}`,
        `warning=${doctorWarning}`,
        `blocked=${doctorBlocked}`,
        `unknown=${input.doctor.summary.unknown}`,
      ] : [],
      href: "/advanced/dashboard",
    },
  ]
}
