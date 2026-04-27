import type { SetupSecurityDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function SecuritySettingsForm({
  value,
  onChange,
  errors,
}: {
  value: SetupSecurityDraft
  onChange: (patch: Partial<SetupSecurityDraft>) => void
  errors?: Partial<Record<"approvalTimeout", string>>
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
    </div>
  )
}
