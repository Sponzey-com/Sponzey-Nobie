import * as React from "react"
import type {
  EnterpriseTopologyGuiDraftCompiledPreviewResponse,
  EnterpriseTopologyRuntimeProfilePreview,
} from "../../lib/enterprise-topology-operations"
import { useUiI18n } from "../../lib/ui-i18n"

export function compiledDelegationNodeIds(
  preview: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null | undefined,
): string[] {
  if (!preview?.ok) return []
  return Object.keys(preview.delegationTree.edges)
    .flatMap((parentId) => [parentId, ...(preview.delegationTree.edges[parentId] ?? [])])
    .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
}

function RuntimeProfileCard({ profile }: { profile: EnterpriseTopologyRuntimeProfilePreview }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="text-xs font-semibold text-stone-950">{profile.name}</div>
      <div className="mt-1 text-[11px] text-stone-500">{profile.nodeType}</div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] font-semibold text-stone-600">
        <span className="rounded-md bg-white px-2 py-1">children {profile.childNodeIds.length}</span>
        <span className="rounded-md bg-white px-2 py-1">tools {profile.allowedToolIds.length}</span>
        <span className="rounded-md bg-white px-2 py-1">systems {profile.allowedSystemIds.length}</span>
        <span className="rounded-md bg-white px-2 py-1">failure {profile.failureReportRequired ? "on" : "off"}</span>
      </div>
    </div>
  )
}

export function TopologyCompilePreview({
  preview,
  loading = false,
}: {
  preview?: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  loading?: boolean
}) {
  const { text } = useUiI18n()

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="enterprise-topology-compile-preview"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {text("Compile Preview", "Compile Preview")}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {text("실행 전 delegation tree와 runtime profile을 읽기 전용으로 확인합니다.", "Read-only delegation tree and runtime profile before execution.")}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          preview?.ok
            ? "bg-emerald-100 text-emerald-800"
            : preview
              ? "bg-amber-100 text-amber-800"
              : "bg-stone-100 text-stone-700"
        }`}>
          {loading
            ? text("로딩", "Loading")
            : preview?.ok
              ? text("컴파일 가능", "Compilable")
              : preview
                ? text("차단", "Blocked")
                : text("대기", "Waiting")}
        </span>
      </div>

      {!preview ? (
        <div className="mt-3 rounded-lg border border-dashed border-stone-200 p-3 text-xs leading-5 text-stone-500">
          {text("검증 후 preview가 표시됩니다.", "Preview appears after validation.")}
        </div>
      ) : preview.ok ? (
        <div className="mt-3 grid gap-3">
          <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
            <div className="text-xs font-semibold text-sky-900">
              {text("Compiled Delegation Tree", "Compiled Delegation Tree")}
            </div>
            <div className="mt-2 grid gap-1 text-[11px] font-semibold text-sky-900">
              <span>{text("Entry", "Entry")}: {preview.delegationTree.entryNodeId ?? "-"}</span>
              <span>{text("Roots", "Roots")}: {preview.delegationTree.rootNodeIds.join(", ") || "-"}</span>
              <span>{text("Exits", "Exits")}: {preview.delegationTree.exitNodeIds.join(", ") || "-"}</span>
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-sky-800">
              {Object.entries(preview.delegationTree.edges).map(([parentId, childIds]) => (
                <div key={parentId} data-testid="compiled-delegation-edge">
                  {parentId} -&gt; {childIds.join(", ") || "-"}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase text-stone-500">
              {text("Runtime profile snapshot", "Runtime profile snapshot")}
            </div>
            <div className="mt-2 grid gap-2">
              {preview.runtimeProfiles.slice(0, 3).map((profile) => (
                <RuntimeProfileCard key={profile.nodeId} profile={profile} />
              ))}
            </div>
          </div>

          {preview.workOrderPreview ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="text-xs font-semibold text-stone-950">
                {text("WorkOrder Preview", "WorkOrder Preview")}
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-stone-600">
                <span>{text("Target", "Target")}: {preview.workOrderPreview.to.id}</span>
                <span>{text("Objective", "Objective")}: {preview.workOrderPreview.objective}</span>
                <span>{text("Criteria", "Criteria")}: {preview.workOrderPreview.successCriteria.length}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          data-testid="enterprise-topology-compile-blocked"
        >
          <div className="font-semibold">
            {text("Compile이 GUI issue로 차단되었습니다.", "Compile is blocked by GUI issues.")}
          </div>
          <div className="mt-1">
            {preview.issues.map((issue) => issue.message).slice(0, 2).join(" / ")}
          </div>
        </div>
      )}
    </section>
  )
}
