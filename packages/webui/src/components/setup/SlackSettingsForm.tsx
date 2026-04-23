import type { SetupChannelDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function SlackSettingsForm({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: SetupChannelDraft
  onChange: (patch: Partial<SetupChannelDraft>) => void
  disabled?: boolean
  errors?: Partial<Record<"slackEnabled" | "slackBotToken" | "slackAppToken", string>>
}) {
  const { text } = useUiI18n()

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 disabled:opacity-60">
      <div>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.slackEnabled}
            onChange={(event) => onChange({ slackEnabled: event.target.checked })}
          />
          {text("Slack 입력 채널 활성화 *", "Enable Slack input channel *")}
        </label>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Bot Token *", "Bot Token *")}</label>
        <input
          className="input font-mono"
          value={value.slackBotToken}
          onChange={(event) => onChange({ slackBotToken: event.target.value })}
          placeholder="xoxb-..."
        />
        {errors?.slackBotToken ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.slackBotToken}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("App Token *", "App Token *")}</label>
        <input
          className="input font-mono"
          value={value.slackAppToken}
          onChange={(event) => onChange({ slackAppToken: event.target.value })}
          placeholder="xapp-..."
        />
        {errors?.slackAppToken ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.slackAppToken}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 사용자 ID", "Allowed User IDs")}</label>
        <textarea
          className="input min-h-[72px] font-mono text-sm"
          value={value.slackAllowedUserIds}
          onChange={(event) => onChange({ slackAllowedUserIds: event.target.value })}
          placeholder="U12345678"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 채널 ID", "Allowed Channel IDs")}</label>
        <textarea
          className="input min-h-[72px] font-mono text-sm"
          value={value.slackAllowedChannelIds}
          onChange={(event) => onChange({ slackAllowedChannelIds: event.target.value })}
          placeholder="C12345678"
        />
      </div>
    </fieldset>
  )
}
