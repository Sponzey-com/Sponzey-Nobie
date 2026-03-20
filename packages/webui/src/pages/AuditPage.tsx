import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

const MOCK_ROWS = [
  { time: "10:31:02", action: "tool.before", summaryKo: "bash 실행 승인 요청 예정", summaryEn: "Pending approval request for bash execution", result: "planned" },
  { time: "10:31:09", action: "approval.requested", summaryKo: "사용자 승인 대기", summaryEn: "Waiting for user approval", result: "planned" },
  { time: "10:31:44", action: "tool.after", summaryKo: "실행 결과 기록", summaryEn: "Execution result recorded", result: "planned" },
]

export function AuditPage() {
  const { text } = useUiI18n()

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Audit</div>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("감사 로그 뷰어", "Audit log viewer")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
          {text("phase0001에서는 실제 gateway audit API 대신, 향후 어떤 형태로 로그가 보일지를 UI로 먼저 고정합니다.", "In phase0001, the UI first fixes how the audit log should look before the real gateway audit API is connected.")}
        </p>
      </div>

      <div className="mt-6">
        <FeatureGate capabilityKey="audit.viewer" title={text("감사 로그 뷰어", "Audit Viewer")}>
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-900">{text("예상 로그 레이아웃", "Expected log layout")}</div>
              <div className="text-xs text-stone-500">{text("미리보기", "Mock Preview")}</div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-stone-200">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-4 py-3 text-left">{text("시간", "Time")}</th>
                    <th className="px-4 py-3 text-left">{text("이벤트", "Event")}</th>
                    <th className="px-4 py-3 text-left">{text("요약", "Summary")}</th>
                    <th className="px-4 py-3 text-left">{text("상태", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ROWS.map((row) => (
                    <tr key={`${row.time}-${row.action}`} className="border-t border-stone-200">
                      <td className="px-4 py-3 font-mono text-xs text-stone-500">{row.time}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-stone-900">{row.action}</td>
                      <td className="px-4 py-3 text-sm text-stone-600">{text(row.summaryKo, row.summaryEn)}</td>
                      <td className="px-4 py-3 text-xs uppercase tracking-wide text-stone-500">{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
