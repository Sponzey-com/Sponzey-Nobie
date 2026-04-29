import type { SetupChannelDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function GoogleChatSettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: SetupChannelDraft
  onChange: (patch: Partial<SetupChannelDraft>) => void
  disabled?: boolean
}) {
  const { text } = useUiI18n()

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 disabled:opacity-60">
      <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
        <input
          type="checkbox"
          checked={value.googleChatEnabled}
          onChange={(event) => onChange({ googleChatEnabled: event.target.checked })}
        />
        {text("Google Chat 입력 채널 활성화 *", "Enable Google Chat input channel *")}
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Project ID", "Project ID")}</label>
          <input
            className="input font-mono"
            value={value.googleChatProjectId}
            onChange={(event) => onChange({ googleChatProjectId: event.target.value })}
            placeholder="my-google-cloud-project"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Service Account Email", "Service Account Email")}</label>
          <input
            className="input font-mono"
            value={value.googleChatServiceAccountEmail}
            onChange={(event) => onChange({ googleChatServiceAccountEmail: event.target.value })}
            placeholder="nobie@project.iam.gserviceaccount.com"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("App Credential JSON", "App Credential JSON")}</label>
        <textarea
          className="input min-h-[92px] font-mono text-sm"
          value={value.googleChatAppCredentialJson}
          onChange={(event) => onChange({ googleChatAppCredentialJson: event.target.value })}
          placeholder='{"type":"service_account", ...}'
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Webhook/Event Endpoint", "Webhook/Event Endpoint")}</label>
          <input
            className="input font-mono"
            value={value.googleChatWebhookUrl}
            onChange={(event) => onChange({ googleChatWebhookUrl: event.target.value })}
            placeholder="https://example.com/api/channels/google-chat/events"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Verification Token *", "Verification Token *")}</label>
          <input
            className="input font-mono"
            value={value.googleChatVerificationToken}
            onChange={(event) => onChange({ googleChatVerificationToken: event.target.value })}
            placeholder="Google Chat request token"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 사용자 ID", "Allowed User IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.googleChatAllowedUserIds}
            onChange={(event) => onChange({ googleChatAllowedUserIds: event.target.value })}
            placeholder="users/123456789"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("허용 Space ID", "Allowed Space IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.googleChatAllowedSpaceIds}
            onChange={(event) => onChange({ googleChatAllowedSpaceIds: event.target.value })}
            placeholder="spaces/AAAA..."
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Deployed Space IDs", "Deployed Space IDs")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.googleChatDeployedSpaceIds}
            onChange={(event) => onChange({ googleChatDeployedSpaceIds: event.target.value })}
            placeholder="spaces/AAAA..."
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("Granted Scopes", "Granted Scopes")}</label>
          <textarea
            className="input min-h-[72px] font-mono text-sm"
            value={value.googleChatGrantedScopes}
            onChange={(event) => onChange({ googleChatGrantedScopes: event.target.value })}
            placeholder="chat.bot"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.googleChatAppPublished}
            onChange={(event) => onChange({ googleChatAppPublished: event.target.checked })}
          />
          {text("Workspace 앱 배포 확인", "Workspace app deployment confirmed")}
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={value.googleChatDomainWideDelegation}
            onChange={(event) => onChange({ googleChatDomainWideDelegation: event.target.checked })}
          />
          {text("Domain-wide delegation 사용", "Domain-wide delegation enabled")}
        </label>
      </div>
    </fieldset>
  )
}
