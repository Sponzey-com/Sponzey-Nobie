import * as React from "react"
import type { BoardAgentDraft } from "../../lib/orchestration-board"
import type { BoardAgentQuickEditPatch } from "../../lib/orchestration-board-editing"
import { formatCommaList, parseCommaList } from "../../lib/orchestration-ui"
import { formatMemoryVisibility } from "../../lib/orchestration-status"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"
import { OrchestrationIdField } from "./OrchestrationIdField"

export function OrchestrationAdvancedFoldout({
  language,
  agent,
  editingLocked = false,
  idIssues = [],
  onPatch,
}: {
  language: UiLanguage
  agent: BoardAgentDraft
  editingLocked?: boolean
  idIssues?: Array<{ severity: "warning" | "error"; message: string }>
  onPatch: (patch: BoardAgentQuickEditPatch) => void
}) {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const allowlist = agent.config.capabilityPolicy.skillMcpAllowlist
  const permission = agent.config.capabilityPolicy.permissionProfile
  const rateLimit = agent.config.capabilityPolicy.rateLimit
  const delegation = agent.config.delegation
  const memory = agent.config.memoryPolicy

  return (
    <details className="rounded-[1.2rem] border border-stone-200 bg-stone-50 px-4 py-3" data-orchestration-advanced-foldout="">
      <summary className="cursor-pointer list-none text-sm font-semibold text-stone-900">
        {t("고급 펼치기", "Advanced")}
      </summary>

      <div className="mt-4 space-y-4">
        <div data-orchestration-advanced-id="">
          <OrchestrationIdField
            kind="agent"
            language={language}
            value={agent.agentId}
            locked={agent.lockedId}
            issues={idIssues}
            onChange={editingLocked ? undefined : (value) => onPatch({ agentId: value })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t("닉네임", "Nickname")}
            value={agent.config.nickname ?? ""}
            disabled={editingLocked}
            onChange={(value) => onPatch({ nickname: value })}
          />
          <Field
            label={t("전문 태그", "Specialties")}
            value={formatCommaList(agent.config.specialtyTags)}
            disabled={editingLocked}
            onChange={(value) => onPatch({ specialtyTags: parseCommaList(value) })}
          />
        </div>

        <TextAreaField
          label={t("가이드 노트", "Guidance note")}
          value={agent.config.personality}
          disabled={editingLocked}
          onChange={(value) => onPatch({ personality: value })}
        />

        <Field
          label={t("피할 작업", "Avoid tasks")}
          value={formatCommaList(agent.config.avoidTasks)}
          disabled={editingLocked}
          onChange={(value) => onPatch({ avoidTasks: parseCommaList(value) })}
        />

        <div className="rounded-[1.2rem] border border-stone-200 bg-white p-4" data-orchestration-advanced-capability="">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Capability flags", "Capability flags")}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <PreviewRow
              label={t("위험 한도", "Risk ceiling")}
              value={permission.riskCeiling}
            />
            <PreviewRow
              label={t("승인 경계", "Approval boundary")}
              value={permission.approvalRequiredFrom}
            />
          </div>

          <div className="mt-4 space-y-4">
            <Field
              label={t("허용 Skill", "Enabled skills")}
              value={formatCommaList(allowlist.enabledSkillIds)}
              disabled={editingLocked}
              onChange={(value) => onPatch({ enabledSkillIds: parseCommaList(value) })}
            />
            <Field
              label={t("허용 MCP 서버", "Enabled MCP servers")}
              value={formatCommaList(allowlist.enabledMcpServerIds)}
              disabled={editingLocked}
              onChange={(value) => onPatch({ enabledMcpServerIds: parseCommaList(value) })}
            />
            <Field
              label={t("허용 도구", "Enabled tools")}
              value={formatCommaList(allowlist.enabledToolNames)}
              disabled={editingLocked}
              onChange={(value) => onPatch({ enabledToolNames: parseCommaList(value) })}
            />
            <Field
              label={t("허용 경로", "Allowed paths")}
              value={formatCommaList(permission.allowedPaths)}
              disabled={editingLocked}
              onChange={(value) => onPatch({ allowedPaths: parseCommaList(value) })}
            />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Toggle
              label={t("외부 네트워크", "External network")}
              checked={permission.allowExternalNetwork}
              disabled={editingLocked}
              onChange={(checked) => onPatch({ allowExternalNetwork: checked })}
            />
            <Toggle
              label={t("파일 쓰기", "Filesystem write")}
              checked={permission.allowFilesystemWrite}
              disabled={editingLocked}
              onChange={(checked) => onPatch({ allowFilesystemWrite: checked })}
            />
            <Toggle
              label={t("쉘 실행", "Shell execution")}
              checked={permission.allowShellExecution}
              disabled={editingLocked}
              onChange={(checked) => onPatch({ allowShellExecution: checked })}
            />
            <Toggle
              label={t("화면 제어", "Screen control")}
              checked={permission.allowScreenControl}
              disabled={editingLocked}
              onChange={(checked) => onPatch({ allowScreenControl: checked })}
            />
          </div>
        </div>

        <div className="rounded-[1.2rem] border border-stone-200 bg-white p-4" data-orchestration-policy-overlay="">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("Policy overlay", "Policy overlay")}
          </div>
          <div className="mt-4 space-y-2">
            <PreviewRow
              label={t("메모리 범위", "Memory scope")}
              value={`${memory.owner.ownerType}:${memory.owner.ownerId} / ${formatMemoryVisibility(memory.visibility, language)}`}
            />
            <PreviewRow
              label={t("읽기 범위", "Read scopes")}
              value={memory.readScopes.map((scope) => `${scope.ownerType}:${scope.ownerId}`).join(", ") || "-"}
            />
            <PreviewRow
              label={t("쓰기 범위", "Write scope")}
              value={`${memory.writeScope.ownerType}:${memory.writeScope.ownerId}`}
            />
            <PreviewRow
              label={t("위임", "Delegation")}
              value={delegation.enabled
                ? `${t("활성", "enabled")} / ${t("병렬", "parallel")} ${delegation.maxParallelSessions} / retry ${delegation.retryBudget}`
                : `${t("비활성", "disabled")} / ${t("병렬", "parallel")} ${delegation.maxParallelSessions} / retry ${delegation.retryBudget}`}
            />
            <PreviewRow
              label={t("Rate limit", "Rate limit")}
              value={rateLimit.maxCallsPerMinute
                ? `${t("동시", "concurrent")} ${rateLimit.maxConcurrentCalls} / ${t("분당", "per minute")} ${rateLimit.maxCallsPerMinute}`
                : `${t("동시", "concurrent")} ${rateLimit.maxConcurrentCalls}`}
            />
            <PreviewRow
              label={t("Secret scope", "Secret scope")}
              value={allowlist.secretScopeId ?? "-"}
            />
            <PreviewRow
              label={t("비활성 도구", "Disabled tools")}
              value={formatCommaList(allowlist.disabledToolNames) || "-"}
            />
          </div>
        </div>
      </div>
    </details>
  )
}

function Field({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none focus:border-stone-400 disabled:opacity-60"
      />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</span>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-2 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none focus:border-stone-400 disabled:opacity-60"
      />
    </label>
  )
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function PreviewRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2" data-orchestration-policy-overlay-row="">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-1 text-sm leading-6 text-stone-800">{value}</div>
    </div>
  )
}
