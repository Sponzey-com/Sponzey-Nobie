import type { SetupRemoteAccessDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function RemoteAccessForm({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: SetupRemoteAccessDraft
  onChange: (patch: Partial<SetupRemoteAccessDraft>) => void
  disabled?: boolean
  errors?: Partial<Record<"authToken" | "host" | "port", string>>
}) {
  const { text } = useUiI18n()

  return (
    <fieldset disabled={disabled} className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5 disabled:opacity-60">
      <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
        <input
          type="checkbox"
          checked={value.authEnabled}
          onChange={(event) => onChange({ authEnabled: event.target.checked })}
        />
        {text("WebUI 인증 사용", "Use WebUI authentication")}
      </label>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">
          {text("인증 토큰", "Auth Token")}{value.authEnabled ? " *" : ""}
        </label>
        <input
          className="input font-mono"
          value={value.authToken}
          onChange={(event) => onChange({ authToken: event.target.value })}
          placeholder="nobie-local-token"
        />
        {errors?.authToken ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.authToken}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("호스트 (Host) *", "Host *")}</label>
          <input
            className="input font-mono"
            value={value.host}
            onChange={(event) => onChange({ host: event.target.value })}
          />
          {errors?.host ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.host}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("포트 (Port) *", "Port *")}</label>
          <input
            type="number"
            className="input"
            value={value.port}
            onChange={(event) => onChange({ port: Number(event.target.value) })}
          />
          {errors?.port ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.port}</p> : null}
        </div>
      </div>
    </fieldset>
  )
}
