import { EmptyState } from "../components/EmptyState"
import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

export function AuditPage() {
  const { text } = useUiI18n()

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Audit</div>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("감사 로그 뷰어", "Audit log viewer")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
          {text("실제 gateway audit API가 연결되면 이 화면에서 감사 로그를 확인할 수 있습니다.", "Audit logs will appear here when the real gateway audit API is connected.")}
        </p>
      </div>

      <div className="mt-6">
        <FeatureGate capabilityKey="audit.viewer" title={text("감사 로그 뷰어", "Audit Viewer")}>
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            <EmptyState
              title={text("감사 로그가 아직 없습니다", "No audit logs yet")}
              description={text(
                "연결이 완료되면 실제 감사 로그만 이 화면에 표시됩니다.",
                "Only real audit logs will appear here after the connection is ready.",
              )}
            />
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
