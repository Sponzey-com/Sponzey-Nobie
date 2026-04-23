import type { SetupChannelDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function TelegramSettingsForm({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: SetupChannelDraft
  onChange: (patch: Partial<SetupChannelDraft>) => void
  disabled?: boolean
  errors?: Partial<Record<"telegramEnabled" | "botToken", string>>
}) {
  const { text } = useUiI18n()

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 disabled:opacity-60">
      <div>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.telegramEnabled}
            onChange={(event) => onChange({ telegramEnabled: event.target.checked })}
          />
          {text("Telegram 입력 채널 활성화 *", "Enable Telegram input channel *")}
        </label>
        {errors?.telegramEnabled ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.telegramEnabled}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Bot Token *", "Bot Token *")}</label>
        <input
          className="input font-mono"
          value={value.botToken}
          onChange={(event) => onChange({ botToken: event.target.value })}
          placeholder="123456789:ABCDEF..."
        />
        {errors?.botToken ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.botToken}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 사용자 ID", "Allowed User IDs")}</label>
        <textarea
          className="input min-h-[72px] font-mono text-sm"
          value={value.allowedUserIds}
          onChange={(event) => onChange({ allowedUserIds: event.target.value })}
          placeholder="123456789"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 그룹 ID", "Allowed Group IDs")}</label>
        <textarea
          className="input min-h-[72px] font-mono text-sm"
          value={value.allowedGroupIds}
          onChange={(event) => onChange({ allowedGroupIds: event.target.value })}
          placeholder="-1001234567890"
        />
      </div>
    </fieldset>
  )
}
