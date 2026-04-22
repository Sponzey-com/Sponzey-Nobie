import * as React from "react"
import type { OrchestrationAgentRegistryEntry } from "../../contracts/orchestration-api"
import type { BoardAgentDraft } from "../../lib/orchestration-board"
import type { BoardAgentQuickEditPatch } from "../../lib/orchestration-board-editing"
import {
  buildOrchestrationAgentDetailBadges,
  buildOrchestrationAgentRuntimeBadges,
  describeOrchestrationAgentDegradedRecovery,
  ORCHESTRATION_EDITABLE_AGENT_STATUSES,
} from "../../lib/orchestration-status"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationAgentAvatar } from "./OrchestrationAgentAvatar"

export function OrchestrationAgentQuickEdit({
  language,
  agent,
  runtimeAgent = null,
  editingLocked = false,
  teamLabels = [],
  displayNameIssues = [],
  roleIssues = [],
  descriptionIssues = [],
  onPatch,
}: {
  language: UiLanguage
  agent: BoardAgentDraft
  runtimeAgent?: OrchestrationAgentRegistryEntry | null
  editingLocked?: boolean
  teamLabels?: string[]
  displayNameIssues?: Array<{ severity: "warning" | "error"; message: string }>
  roleIssues?: Array<{ severity: "warning" | "error"; message: string }>
  descriptionIssues?: Array<{ severity: "warning" | "error"; message: string }>
  onPatch: (patch: BoardAgentQuickEditPatch) => void
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const runtimeBadges = runtimeAgent ? buildOrchestrationAgentRuntimeBadges(runtimeAgent, language) : [t("런타임 신호 없음", "No runtime signal yet")]
  const detailBadges = buildOrchestrationAgentDetailBadges({
    agent: {
      status: agent.config.status,
      delegationEnabled: agent.config.delegation.enabled,
    },
    language,
  })
  const membershipChips = teamLabels.length > 0 ? teamLabels : [t("아직 팀 lane 없음", "No team lane yet")]
  const displayLabel = agent.config.displayName.trim() || t("이름 없는 에이전트", "Untitled agent")

  return (
    <div className="space-y-4" data-orchestration-agent-quick-edit="">
      <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-start gap-3">
          <OrchestrationAgentAvatar
            seed={agent.agentId}
            displayName={agent.config.displayName}
            role={agent.config.role}
            mode="card"
            size="md"
            tone={agent.config.status === "archived" || agent.config.status === "disabled" ? "disabled" : agent.config.status === "degraded" ? "warning" : "neutral"}
          />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-stone-950">{displayLabel}</div>
            <div className="mt-1 text-sm leading-6 text-stone-600">
              {membershipChips.join(" / ")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2" data-orchestration-agent-detail-badges="">
              {detailBadges.map((badge) => (
                <span key={badge} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                  {badge}
                </span>
              ))}
              {runtimeBadges.slice(0, 2).map((badge) => (
                <span key={`runtime:${badge}`} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900">
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t("이름", "Display name")}
          value={agent.config.displayName}
          placeholder={t("이름 입력", "Enter name")}
          disabled={editingLocked}
          issues={displayNameIssues}
          onChange={(value) => onPatch({ displayName: value })}
        />

        <Field
          label={t("역할", "Role")}
          value={agent.config.role}
          placeholder={t("역할 입력", "Enter role")}
          disabled={editingLocked}
          issues={roleIssues}
          onChange={(value) => onPatch({ role: value })}
        />
      </div>

      <TextAreaField
        label={t("Description", "Description")}
        value={agent.config.personality}
        placeholder={t("설명 입력", "Enter description")}
        disabled={editingLocked}
        issues={descriptionIssues}
        onChange={(value) => onPatch({ personality: value })}
      />

      <label className="block" data-orchestration-agent-status-options="">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{t("구성 상태", "Config status")}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {ORCHESTRATION_EDITABLE_AGENT_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              data-orchestration-agent-status-option={status}
              disabled={editingLocked}
              onClick={() => onPatch({ status })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                agent.config.status === status
                  ? "bg-stone-900 text-white"
                  : "border border-stone-200 bg-white text-stone-700"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
        {agent.config.status === "degraded" ? (
          <div
            className="mt-3 rounded-[1.1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
            data-orchestration-agent-degraded-recovery=""
          >
            {describeOrchestrationAgentDegradedRecovery(language)}
          </div>
        ) : null}
      </label>
    </div>
  )
}

function Field({
  label,
  value,
  placeholder,
  disabled = false,
  issues = [],
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  issues?: Array<{ severity: "warning" | "error"; message: string }>
  onChange: (value: string) => void
}) {
  const tone = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "normal"
  return (
    <label className="block" data-orchestration-field-state={tone}>
      <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${tone === "error" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-stone-500"}`}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm text-stone-900 outline-none disabled:opacity-60 ${
          tone === "error"
            ? "border-red-300 focus:border-red-500"
            : tone === "warning"
              ? "border-amber-300 focus:border-amber-500"
              : "border-stone-200 focus:border-stone-400"
        }`}
      />
      {issues.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs leading-5" data-orchestration-field-issues="">
          {issues.map((issue, index) => (
            <div key={`${issue.message}-${index}`} className={issue.severity === "error" ? "text-red-700" : "text-amber-700"}>
              {issue.message}
            </div>
          ))}
        </div>
      ) : null}
    </label>
  )
}

function TextAreaField({
  label,
  value,
  placeholder,
  disabled = false,
  issues = [],
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  issues?: Array<{ severity: "warning" | "error"; message: string }>
  onChange: (value: string) => void
}) {
  const tone = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "normal"
  return (
    <label className="block" data-orchestration-field-state={tone}>
      <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${tone === "error" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-stone-500"}`}>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm text-stone-900 outline-none disabled:opacity-60 ${
          tone === "error"
            ? "border-red-300 focus:border-red-500"
            : tone === "warning"
              ? "border-amber-300 focus:border-amber-500"
              : "border-stone-200 focus:border-stone-400"
        }`}
      />
      {issues.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs leading-5" data-orchestration-field-issues="">
          {issues.map((issue, index) => (
            <div key={`${issue.message}-${index}`} className={issue.severity === "error" ? "text-red-700" : "text-amber-700"}>
              {issue.message}
            </div>
          ))}
        </div>
      ) : null}
    </label>
  )
}
