import type { SetupChannelDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function DiscordSettingsForm({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: SetupChannelDraft
  onChange: (patch: Partial<SetupChannelDraft>) => void
  disabled?: boolean
  errors?: Partial<Record<"discordEnabled" | "discordBotToken" | "discordApplicationId" | "discordPublicKey", string>>
}) {
  const { text } = useUiI18n()

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 disabled:opacity-60">
      <div>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.discordEnabled}
            onChange={(event) => onChange({ discordEnabled: event.target.checked })}
          />
          {text("Discord 입력 채널 활성화 *", "Enable Discord input channel *")}
        </label>
        {errors?.discordEnabled ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.discordEnabled}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Bot Token *", "Bot Token *")}</label>
        <input
          className="input font-mono"
          value={value.discordBotToken}
          onChange={(event) => onChange({ discordBotToken: event.target.value })}
          placeholder="MTA..."
        />
        {errors?.discordBotToken ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.discordBotToken}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Application ID *", "Application ID *")}</label>
        <input
          className="input font-mono"
          value={value.discordApplicationId}
          onChange={(event) => onChange({ discordApplicationId: event.target.value })}
          placeholder="123456789012345678"
        />
        {errors?.discordApplicationId ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.discordApplicationId}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("Interaction Public Key", "Interaction Public Key")}</label>
        <input
          className="input font-mono"
          value={value.discordPublicKey}
          onChange={(event) => onChange({ discordPublicKey: event.target.value })}
          placeholder="32-byte Ed25519 public key hex"
        />
        {errors?.discordPublicKey ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.discordPublicKey}</p> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 사용자 ID", "Allowed User IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordAllowedUserIds}
            onChange={(event) => onChange({ discordAllowedUserIds: event.target.value })}
            placeholder="123456789012345678"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 Guild ID", "Allowed Guild IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordAllowedGuildIds}
            onChange={(event) => onChange({ discordAllowedGuildIds: event.target.value })}
            placeholder="987654321098765432"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 Channel ID", "Allowed Channel IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordAllowedChannelIds}
            onChange={(event) => onChange({ discordAllowedChannelIds: event.target.value })}
            placeholder="111122223333444455"
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Granted Intents", "Granted Intents")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordGrantedIntents}
            onChange={(event) => onChange({ discordGrantedIntents: event.target.value })}
            placeholder="GuildMessages&#10;MessageContent&#10;DirectMessages"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Bot Permissions", "Bot Permissions")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordBotPermissions}
            onChange={(event) => onChange({ discordBotPermissions: event.target.value })}
            placeholder="SendMessages&#10;ReadMessageHistory&#10;UseApplicationCommands"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Installed Guild IDs", "Installed Guild IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.discordInstalledGuildIds}
            onChange={(event) => onChange({ discordInstalledGuildIds: event.target.value })}
            placeholder="987654321098765432"
          />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
        <input
          type="checkbox"
          checked={value.discordLargeGuildMode}
          onChange={(event) => onChange({ discordLargeGuildMode: event.target.checked })}
        />
        {text("대형 Guild 보수 모드", "Conservative large guild mode")}
      </label>
    </fieldset>
  )
}
