import type { SetupSecurityDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function SecuritySettingsForm({
  value,
  onChange,
  errors,
}: {
  value: SetupSecurityDraft
  onChange: (patch: Partial<SetupSecurityDraft>) => void
  errors?: Partial<Record<"approvalTimeout" | "maxDelegationTurns", string>>
}) {
  const { text } = useUiI18n()

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("승인 모드", "Approval Mode")}</label>
        <select
          className="input"
          value={value.approvalMode}
          onChange={(event) => onChange({ approvalMode: event.target.value as SetupSecurityDraft["approvalMode"] })}
        >
          <option value="always">{text("항상 승인 요청", "Always ask for approval")}</option>
          <option value="on-miss">{text("필요 시만 승인", "Ask only when needed")}</option>
          <option value="off">{text("승인 사용 안 함", "Disable approvals")}</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("승인 타임아웃 *", "Approval Timeout *")}</label>
        <input
          type="number"
          min={5}
          max={300}
          className="input"
          value={value.approvalTimeout}
          onChange={(event) => onChange({ approvalTimeout: Number(event.target.value) })}
        />
        {errors?.approvalTimeout ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.approvalTimeout}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("타임아웃 후 기본 동작", "Fallback After Timeout")}</label>
        <select
          className="input"
          value={value.approvalTimeoutFallback}
          onChange={(event) => onChange({ approvalTimeoutFallback: event.target.value as SetupSecurityDraft["approvalTimeoutFallback"] })}
        >
          <option value="deny">{text("거부", "Deny")}</option>
          <option value="allow">{text("허용", "Allow")}</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("자동 후속 처리 최대 횟수 *", "Maximum Automatic Follow-up Count *")}</label>
        <input
          type="number"
          min={0}
          max={20}
          className="input"
          value={value.maxDelegationTurns}
          onChange={(event) => onChange({ maxDelegationTurns: Number(event.target.value) })}
        />
        {errors?.maxDelegationTurns ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.maxDelegationTurns}</p> : null}
        <div className="mt-2 text-xs leading-5 text-stone-500">
          {text("`0`이면 제한 없이 계속 진행합니다. `1` 이상이면 지정한 횟수만큼만 자동 후속 처리를 수행합니다.", "`0` means no limit. `1` or higher runs automatic follow-up only that many times.")}
        </div>
        <div className="mt-1 text-xs leading-5 text-amber-700">
          {text("주의: 무제한으로 두면 같은 후속 작업이 길게 반복될 수 있고, 모델 호출 비용과 실행 시간이 크게 늘어날 수 있습니다.", "Warning: unlimited mode can repeat the same follow-up work for a long time and increase model cost and runtime significantly.")}
        </div>
      </div>
    </div>
  )
}
