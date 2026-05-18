import React from "react"
import type {
  UiMode,
  MemoryInspectorControlAction,
  MemoryInspectorControlResult,
  MemoryInspectorSnapshot,
} from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

function formatAgo(value: number | null): string {
  if (value == null) return "-"
  const seconds = Math.max(0, Math.floor(value / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatAt(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "-"
}

function displayControlLabel(text: (ko: string, en: string) => string, action: MemoryInspectorControlAction): string {
  switch (action) {
    case "dry_run_compaction":
      return text("dry-run compact", "Dry-run compact")
    case "latest_capsule_inspect":
      return text("최신 capsule", "Latest capsule")
    case "rollup_inspect":
      return text("rollup 보기", "Inspect rollup")
    case "safe_restore":
      return text("safe restore", "Safe restore")
    case "force_compaction":
      return text("강제 compact", "Force compact")
    case "capsule_invalidate":
      return text("capsule 무효화", "Invalidate capsule")
    default:
      return action
  }
}

export function MemoryInspectorPanel({
  mode,
  snapshot,
  loading,
  error,
  actionLoading,
  actionError,
  actionResult,
  onRefresh,
  onControl,
}: {
  mode: UiMode
  snapshot: MemoryInspectorSnapshot | null
  loading: boolean
  error: string
  actionLoading: boolean
  actionError: string
  actionResult: MemoryInspectorControlResult | null
  onRefresh: () => void
  onControl: (action: MemoryInspectorControlAction) => void
}) {
  const { text, displayText } = useUiI18n()
  if (mode === "beginner") return null
  const isAdmin = mode === "admin"
  const ownerCards = snapshot?.ownerCards ?? []
  const selected = ownerCards[0]

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("Memory inspector", "Memory inspector")}</div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {text(
              "compact 상태, capsule chain, recall trace, compaction audit를 운영 화면에서 확인합니다.",
              "Inspect compact state, capsule chain, recall trace, and compaction audit from the operations screen.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("불러오는 중", "Loading") : text("새로고침", "Refresh")}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("Owner", "Owner")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.summary.owners ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">warning {snapshot?.summary.warningOwners ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("Recall", "Recall")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.summary.recallEvents ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">quality {snapshot?.summary.qualityStatus ?? "-"}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("Compact runs", "Compact runs")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{snapshot?.summary.compactionRuns ?? 0}</div>
          <div className="mt-1 text-xs text-stone-500">{text("정책 최소 토큰", "Min tokens")} {snapshot?.configuredPolicy.minContextTokens ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("Latest capsule", "Latest capsule")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{selected ? formatAgo(selected.latestCapsuleAgeMs) : "-"}</div>
          <div className="mt-1 text-xs text-stone-500">{text("chain", "chain")} {selected?.activeCapsuleChainDepth ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("Latest rollup", "Latest rollup")}</div>
          <div className="mt-2 text-sm font-semibold text-stone-900">{selected ? formatAgo(selected.latestRollupAgeMs) : "-"}</div>
          <div className="mt-1 text-xs text-stone-500">{displayText(selected?.lastCompactionReason ?? "-")}</div>
        </div>
      </div>

      {ownerCards.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="grid grid-cols-[1fr_0.9fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-2 border-b border-stone-200 bg-stone-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
            <span>{text("Agent", "Agent")}</span>
            <span>{text("raw tokens", "raw tokens")}</span>
            <span>{text("pending", "pending")}</span>
            <span>{text("recall", "recall")}</span>
            <span>{text("capsule", "capsule")}</span>
            <span>{text("drift", "drift")}</span>
          </div>
          {ownerCards.map((card) => (
            <div key={card.ownerScopeKey} className="grid grid-cols-[1fr_0.9fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-2 border-b border-stone-100 px-4 py-2 text-xs text-stone-600 last:border-b-0">
              <span className="min-w-0">
                <span className="font-semibold text-stone-900">{displayText(card.nicknameSnapshot || card.ownerId)}</span>
                <span className="ml-2 text-stone-400">{card.ownerType}</span>
              </span>
              <span>{card.currentRawTokenEstimate}</span>
              <span>{card.pendingPreservationCount}</span>
              <span>{card.recallHitCount}</span>
              <span>{formatAgo(card.latestCapsuleAgeMs)}</span>
              <span className={card.driftWarningState === "warning" ? "font-semibold text-amber-700" : "text-emerald-700"}>
                {card.driftWarningState}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {snapshot?.compactPreview ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-semibold text-stone-500">{text("Compact preview", "Compact preview")}</div>
            <div className="text-xs text-stone-500">
              {text("head 범위와 preserved pinned 항목만 보여주고 실제 write는 하지 않습니다.", "Shows the head range and preserved pinned items without writing state.")}
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">source {snapshot.compactPreview.sourceMessageCount}</div>
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">tail {snapshot.compactPreview.tailMessageCount}</div>
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">drop {snapshot.compactPreview.droppedRawCount}</div>
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
              {snapshot.compactPreview.headRange
                ? `head ${snapshot.compactPreview.headRange.start}-${snapshot.compactPreview.headRange.end}`
                : "head -"}
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
            {displayText(snapshot.compactPreview.capsuleSummary || "-")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.compactPreview.preservedPinnedItems.slice(0, 8).map((item) => (
              <span key={item} className="rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-700">{displayText(item)}</span>
            ))}
          </div>
        </div>
      ) : null}

      {snapshot?.maintenanceRestorePromptBlock ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="text-xs font-semibold text-stone-500">{text("Restore trace", "Restore trace")}</div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-950/95 px-4 py-3 text-[11px] leading-5 text-stone-100">
            {snapshot.maintenanceRestorePromptBlock}
          </pre>
        </div>
      ) : null}

      {snapshot?.recentCompactionRuns.length ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="text-xs font-semibold text-stone-500">{text("Compaction audit", "Compaction audit")}</div>
          <div className="mt-3 space-y-2">
            {snapshot.recentCompactionRuns.slice(0, 6).map((run) => (
              <div key={run.id} className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <div className="font-semibold text-stone-900">{displayText(run.modelId || "-")} · {run.status}</div>
                <div className="mt-1">{formatAt(run.createdAt)} · {displayText(run.triggerReasonCodes.join(", ") || "-")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="text-xs font-semibold text-stone-500">{text("Manual controls", "Manual controls")}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(snapshot?.controls ?? []).map((control) => (
              <button
                key={control.action}
                type="button"
                onClick={() => onControl(control.action)}
                disabled={!control.enabled || actionLoading}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {displayControlLabel(text, control.action)}
              </button>
            ))}
          </div>
          {actionError ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              {displayText(actionError)}
            </div>
          ) : null}
          {actionResult ? (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
              <div className="font-semibold text-stone-900">{displayControlLabel(text, actionResult.action)}</div>
              <div className="mt-1 text-xs text-stone-500">{displayText(actionResult.reason)}</div>
              {actionResult.compactPreview ? (
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <div className="rounded-xl bg-white px-3 py-2 text-xs text-stone-600">
                    source {actionResult.compactPreview.sourceMessageCount}
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2 text-xs text-stone-600">
                    tail {actionResult.compactPreview.tailMessageCount}
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2 text-xs text-stone-600">
                    drop {actionResult.compactPreview.droppedRawCount}
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2 text-xs text-stone-600">
                    {actionResult.compactPreview.headRange
                      ? `head ${actionResult.compactPreview.headRange.start}-${actionResult.compactPreview.headRange.end}`
                      : "head -"}
                  </div>
                  <div className="md:col-span-4 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-stone-600">
                    {displayText(actionResult.compactPreview.capsuleSummary || "-")}
                  </div>
                </div>
              ) : null}
              {actionResult.latestCapsule ? (
                <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-stone-600">
                  <div className="font-semibold text-stone-900">{displayText(actionResult.latestCapsule.summary)}</div>
                  <div className="mt-1 text-stone-500">
                    {text("pending", "pending")} {actionResult.latestCapsule.pendingItems.length} ·
                    {" "}
                    {text("facts", "facts")} {actionResult.latestCapsule.confirmedFacts.length}
                  </div>
                </div>
              ) : null}
              {actionResult.latestRollup ? (
                <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-stone-600">
                  <div className="font-semibold text-stone-900">
                    {text("rollup capsule", "Rollup capsule")} {displayText(actionResult.latestRollup.resultRollupCapsuleId)}
                  </div>
                  <div className="mt-1 text-stone-500">
                    source {actionResult.latestRollup.sourceCapsuleCount} ·
                    {" "}
                    {displayText(actionResult.latestRollup.reasonCode)}
                  </div>
                </div>
              ) : null}
              {actionResult.maintenanceRestorePromptBlock ? (
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-950/95 px-4 py-3 text-[11px] leading-5 text-stone-100">
                  {actionResult.maintenanceRestorePromptBlock}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
