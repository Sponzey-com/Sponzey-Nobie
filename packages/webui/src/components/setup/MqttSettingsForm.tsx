import type { SetupMqttDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function MqttSettingsForm({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: SetupMqttDraft
  onChange: (patch: Partial<SetupMqttDraft>) => void
  disabled?: boolean
  errors?: Partial<Record<"enabled" | "host" | "port" | "username" | "password", string>>
}) {
  const { text } = useUiI18n()
  const canEnable = value.username.trim().length > 0 && value.password.trim().length > 0

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 disabled:opacity-60">
      <div>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={!canEnable && !value.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          {text("MQTT 브로커 활성화", "Enable MQTT broker")}
        </label>
        <div className="mt-2 text-xs leading-5 text-stone-500">
          {text(
            "연장이 접속할 브로커를 Nobie 안에서 직접 실행합니다. 아이디와 비밀번호를 모두 입력해야 켤 수 있습니다.",
            "Run the broker inside Nobie so extensions can connect. You must enter both username and password before enabling it.",
          )}
        </div>
        {errors?.enabled ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.enabled}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("호스트 (Host) *", "Host *")}</label>
          <input
            className="input font-mono"
            value={value.host}
            onChange={(event) => onChange({ host: event.target.value })}
            placeholder="0.0.0.0"
          />
          <div className="mt-2 text-xs leading-5 text-stone-500">
            {text("`0.0.0.0`이면 외부 네트워크에서도 연장이 접속할 수 있습니다.", "`0.0.0.0` lets extensions connect from external networks as well.")}
          </div>
          {errors?.host ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.host}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("포트 (Port) *", "Port *")}</label>
          <input
            type="number"
            className="input"
            value={value.port}
            onChange={(event) => onChange({ port: Number(event.target.value) })}
            placeholder="1883"
          />
          {errors?.port ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.port}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("아이디 (Username) *", "Username *")}</label>
          <input
            className="input font-mono"
            value={value.username}
            onChange={(event) => onChange({ username: event.target.value })}
            placeholder="nobie"
          />
          {errors?.username ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.username}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("비밀번호 (Password) *", "Password *")}</label>
          <input
            type="password"
            className="input font-mono"
            value={value.password}
            onChange={(event) => onChange({ password: event.target.value })}
            placeholder="change-me"
          />
          {errors?.password ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.password}</p> : null}
        </div>
      </div>
    </fieldset>
  )
}
