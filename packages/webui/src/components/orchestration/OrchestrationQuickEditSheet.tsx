import * as React from "react"
import type { OrchestrationAgentRegistryEntry } from "../../contracts/orchestration-api"
import type { BoardAgentDraft, BoardTeamLaneDraft } from "../../lib/orchestration-board"
import type { BoardAgentQuickEditPatch, BoardTeamQuickEditPatch } from "../../lib/orchestration-board-editing"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationAdvancedFoldout } from "./OrchestrationAdvancedFoldout"
import { OrchestrationAgentQuickEdit } from "./OrchestrationAgentQuickEdit"
import { OrchestrationIdField } from "./OrchestrationIdField"

export interface OrchestrationQuickEditIssue {
  severity: "warning" | "error"
  message: string
  field?: string
  category?: "field" | "membership" | "policy" | "runtime_prerequisite"
}

export function OrchestrationQuickEditSheet({
  language,
  editingLocked = false,
  selection,
  onRequestKeyboardMove,
  onRequestCreateAgentInTeam,
}: {
  language: UiLanguage
  editingLocked?: boolean
  onRequestKeyboardMove?: () => void
  onRequestCreateAgentInTeam?: (teamId: string) => void
  selection:
    | {
        kind: "agent"
        agent: BoardAgentDraft
        runtimeAgent?: OrchestrationAgentRegistryEntry | null
        teamLabels?: string[]
        issues: OrchestrationQuickEditIssue[]
        onPatch: (patch: BoardAgentQuickEditPatch) => void
      }
    | {
        kind: "team"
        team: BoardTeamLaneDraft
        issues: OrchestrationQuickEditIssue[]
        onPatch: (patch: BoardTeamQuickEditPatch) => void
      }
    | null
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)

  if (!selection) {
    return (
      <section className="rounded-[1.6rem] border border-stone-200 bg-white p-5 shadow-sm" data-orchestration-quick-edit="empty">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
          {t("Quick edit", "Quick edit")}
        </div>
        <div className="mt-3 rounded-[1.2rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm leading-6 text-stone-500">
          {t("카드나 lane을 선택하면 이름, 상태, 목적을 여기서 바로 바꿀 수 있습니다.", "Select a card or lane to edit name, status, and purpose here.")}
        </div>
      </section>
    )
  }

  const selectionTitle = selection.kind === "agent"
    ? (selection.agent.config.displayName.trim() || t("이름 없는 에이전트", "Untitled agent"))
    : (selection.team.config.displayName.trim() || t("이름 없는 팀", "Untitled team"))
  const displayNameIssues = filterQuickEditIssuesByField(selection.issues, "displayName")
  const roleIssues = filterQuickEditIssuesByField(selection.issues, "role")
  const descriptionIssues = filterQuickEditIssuesByField(selection.issues, selection.kind === "agent" ? "personality" : "purpose")
  const idIssues = filterQuickEditIssuesByField(selection.issues, selection.kind === "agent" ? "agentId" : "teamId")
  const generalIssues = selection.issues.filter((issue) => !issue.field)

  return (
    <section className="rounded-[1.6rem] border border-stone-200 bg-white p-5 shadow-sm" data-orchestration-quick-edit={selection.kind}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Quick edit", "Quick edit")}
          </div>
          <div className="mt-2 text-base font-semibold text-stone-950">
            {selectionTitle}
          </div>
        </div>
        <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
          {selection.kind === "agent" ? t("에이전트", "Agent") : t("팀", "Team")}
        </div>
      </div>

      {selection.kind === "agent" ? (
        <div className="mt-5 space-y-4">
          <ActionBar
            actions={[
              {
                id: "disable",
                label: t("비활성화", "Disable"),
                disabled: editingLocked || selection.agent.config.status === "disabled",
                onClick: () => selection.onPatch({ status: "disabled" }),
              },
              {
                id: "archive",
                label: t("보관", "Archive"),
                disabled: editingLocked || selection.agent.config.status === "archived",
                tone: "danger",
                onClick: () => selection.onPatch({ status: "archived" }),
              },
            ]}
          />
          {onRequestKeyboardMove ? (
            <button
              type="button"
              onClick={onRequestKeyboardMove}
              disabled={editingLocked}
              data-orchestration-keyboard-move-trigger=""
              className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("키보드로 소속 이동", "Move membership with keyboard")}
            </button>
          ) : null}
          <OrchestrationAgentQuickEdit
            language={language}
            agent={selection.agent}
            runtimeAgent={selection.runtimeAgent ?? null}
            editingLocked={editingLocked}
            teamLabels={selection.teamLabels ?? []}
            displayNameIssues={displayNameIssues}
            roleIssues={roleIssues}
            descriptionIssues={descriptionIssues}
            onPatch={selection.onPatch}
          />
          {generalIssues.length > 0 ? <IssueListCard language={language} issues={generalIssues} /> : null}
          <OrchestrationAdvancedFoldout
            language={language}
            agent={selection.agent}
            editingLocked={editingLocked}
            idIssues={idIssues}
            onPatch={selection.onPatch}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <ActionBar
            actions={[
              {
                id: "create-agent",
                label: t("이 팀에 에이전트 추가", "Add agent here"),
                disabled: editingLocked || !onRequestCreateAgentInTeam,
                onClick: () => onRequestCreateAgentInTeam?.(selection.team.teamId),
              },
              {
                id: "disable-team",
                label: t("비활성화", "Disable"),
                disabled: editingLocked || selection.team.config.status === "disabled",
                onClick: () => selection.onPatch({ status: "disabled" }),
              },
              {
                id: "archive-team",
                label: t("팀 보관", "Archive team"),
                disabled: editingLocked || selection.team.config.status === "archived",
                tone: "danger",
                onClick: () => selection.onPatch({ status: "archived" }),
              },
            ]}
          />
          <Field
            label={t("이름", "Display name")}
            value={selection.team.config.displayName}
            placeholder={t("팀 이름 입력", "Enter team name")}
            disabled={editingLocked}
            issues={displayNameIssues}
            onChange={(value) => selection.onPatch({ displayName: value })}
          />
          <TextAreaField
            label={t("Description", "Description")}
            value={selection.team.config.purpose}
            placeholder={t("팀 설명 입력", "Enter team description")}
            disabled={editingLocked}
            issues={descriptionIssues}
            onChange={(value) => selection.onPatch({ purpose: value })}
          />
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{t("상태", "Status")}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["disabled", "enabled", "archived"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={editingLocked}
                  onClick={() => selection.onPatch({ status })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    selection.team.config.status === status
                      ? "bg-stone-900 text-white"
                      : "border border-stone-200 bg-white text-stone-700"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </label>

          {generalIssues.length > 0 ? <IssueListCard language={language} issues={generalIssues} /> : null}

          <details className="rounded-[1.2rem] border border-stone-200 bg-stone-50 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-stone-900">
              {t("고급 펼치기", "Advanced")}
            </summary>
            <div className="mt-4 space-y-4">
              <OrchestrationIdField
                kind="team"
                language={language}
                value={selection.team.teamId}
                locked={selection.team.lockedId}
                issues={idIssues}
                onChange={editingLocked ? undefined : (value) => selection.onPatch({ teamId: value })}
              />
              <Field
                label={t("닉네임", "Nickname")}
                value={selection.team.config.nickname ?? ""}
                placeholder={t("선택 입력", "Optional")}
                disabled={editingLocked}
                onChange={(value) => selection.onPatch({ nickname: value })}
              />
              <Field
                label={t("Role hints", "Role hints")}
                value={selection.team.config.roleHints.join(", ")}
                placeholder={t("쉼표로 구분", "Comma separated")}
                disabled={editingLocked}
                onChange={(value) => selection.onPatch({ roleHints: parseCommaList(value) })}
              />
            </div>
          </details>
        </div>
      )}
    </section>
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
  issues?: OrchestrationQuickEditIssue[]
  onChange: (value: string) => void
}) {
  const tone = resolveQuickEditIssueTone(issues)
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
  issues?: OrchestrationQuickEditIssue[]
  onChange: (value: string) => void
}) {
  const tone = resolveQuickEditIssueTone(issues)
  return (
    <label className="block" data-orchestration-field-state={tone}>
      <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${tone === "error" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-stone-500"}`}>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
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

function filterQuickEditIssuesByField(issues: OrchestrationQuickEditIssue[], field: string): OrchestrationQuickEditIssue[] {
  return issues.filter((issue) => issue.field === field)
}

function resolveQuickEditIssueTone(issues: OrchestrationQuickEditIssue[]): "normal" | "warning" | "error" {
  if (issues.some((issue) => issue.severity === "error")) return "error"
  if (issues.length > 0) return "warning"
  return "normal"
}

function IssueListCard({
  language,
  issues,
}: {
  language: UiLanguage
  issues: OrchestrationQuickEditIssue[]
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const tone = resolveQuickEditIssueTone(issues)

  return (
    <div
      className={`rounded-[1.2rem] border px-4 py-3 text-sm leading-6 ${
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
      data-orchestration-quick-edit-other-issues=""
    >
      <div className="font-semibold">{t("추가 확인 필요", "Needs attention")}</div>
      <div className="mt-2 space-y-1">
        {issues.map((issue, index) => (
          <div key={`${issue.message}-${index}`}>{issue.message}</div>
        ))}
      </div>
    </div>
  )
}

function parseCommaList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)))
}

function ActionBar({
  actions,
}: {
  actions: Array<{
    id: string
    label: string
    disabled?: boolean
    tone?: "neutral" | "danger"
    onClick: () => void
  }>
}) {
  return (
    <div className="flex flex-wrap gap-2" data-orchestration-quick-actions="">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              action.tone === "danger"
                ? "border border-red-200 bg-red-50 text-red-900"
                : "border border-stone-200 bg-white text-stone-700"
              }`}
          >
            {action.label}
          </button>
        ))}
    </div>
  )
}
