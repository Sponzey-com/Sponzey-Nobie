import type { SetupChannelDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

export function IMessageLocalBridgeSettingsForm({
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
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 disabled:opacity-60">
      <label className="flex items-center gap-3 text-sm font-medium text-amber-950">
        <input type="checkbox" checked={value.imessageEnabled} onChange={(event) => onChange({ imessageEnabled: event.target.checked })} />
        {text("iMessage local bridge 활성화", "Enable iMessage local bridge")}
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm font-medium text-amber-950">
          {text("모드", "Mode")}
          <select className="input mt-1" value={value.imessageMode} onChange={(event) => onChange({ imessageMode: event.target.value as SetupChannelDraft["imessageMode"] })}>
            <option value="manual_confirm">{text("수동 확인", "Manual confirm")}</option>
            <option value="outgoing_only">{text("발신 전용", "Outgoing only")}</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-amber-950">
          {text("허용 수신자 ID", "Allowed recipient IDs")}
          <textarea
            className="input mt-1 min-h-[72px] font-mono text-sm"
            value={value.imessageAllowedRecipientIds}
            onChange={(event) => onChange({ imessageAllowedRecipientIds: event.target.value })}
            placeholder="+15551234567&#10;user@example.com"
          />
        </label>
      </div>
      <LocalBridgeChecks
        values={[
          ["imessageRiskAcknowledged", value.imessageRiskAcknowledged, text("위험 확인", "Risk acknowledged")],
          ["imessageLocalBridgeEnabled", value.imessageLocalBridgeEnabled, text("local bridge 사용", "Local bridge enabled")],
          ["imessageYeonjangBridgeEnabled", value.imessageYeonjangBridgeEnabled, text("Yeonjang bridge 사용", "Yeonjang bridge enabled")],
          ["imessageMessagesAppAvailable", value.imessageMessagesAppAvailable, text("Messages.app 접근 가능", "Messages.app available")],
          ["imessageUserSessionActive", value.imessageUserSessionActive, text("사용자 세션 활성", "User session active")],
          ["imessageAutomationPermissionGranted", value.imessageAutomationPermissionGranted, text("자동화 권한 허용", "Automation permission granted")],
          ["imessageManualConfirmationRequired", value.imessageManualConfirmationRequired, text("수동 확인 필수", "Manual confirmation required")],
        ]}
        onChange={onChange}
      />
    </fieldset>
  )
}

export function KakaoTalkSettingsForm({
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
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 disabled:opacity-60">
      <label className="flex items-center gap-3 text-sm font-medium text-amber-950">
        <input type="checkbox" checked={value.kakaoTalkEnabled} onChange={(event) => onChange({ kakaoTalkEnabled: event.target.checked })} />
        {text("KakaoTalk 채널 활성화", "Enable KakaoTalk channel")}
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm font-medium text-amber-950">
          {text("모드", "Mode")}
          <select className="input mt-1" value={value.kakaoTalkMode} onChange={(event) => onChange({ kakaoTalkMode: event.target.value as SetupChannelDraft["kakaoTalkMode"] })}>
            <option value="official">{text("Official/Business API", "Official/Business API")}</option>
            <option value="local_bridge">{text("Local bridge", "Local bridge")}</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-amber-950">
          {text("Business Channel ID", "Business Channel ID")}
          <input className="input mt-1 font-mono" value={value.kakaoTalkChannelId} onChange={(event) => onChange({ kakaoTalkChannelId: event.target.value })} />
        </label>
        <label className="block text-sm font-medium text-amber-950">
          {text("분당 제한", "Rate limit/min")}
          <input
            type="number"
            min={1}
            className="input mt-1"
            value={value.kakaoTalkRateLimitPerMinute}
            onChange={(event) => onChange({ kakaoTalkRateLimitPerMinute: Number(event.target.value) })}
          />
        </label>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-amber-950">{text("Business API Key", "Business API Key")}</label>
        <input className="input font-mono" value={value.kakaoTalkBusinessApiKey} onChange={(event) => onChange({ kakaoTalkBusinessApiKey: event.target.value })} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm font-medium text-amber-950">
          {text("허용 사용자 ID", "Allowed user IDs")}
          <textarea className="input mt-1 min-h-[72px] font-mono text-sm" value={value.kakaoTalkAllowedUserIds} onChange={(event) => onChange({ kakaoTalkAllowedUserIds: event.target.value })} />
        </label>
        <label className="block text-sm font-medium text-amber-950">
          {text("허용 방 ID", "Allowed room IDs")}
          <textarea className="input mt-1 min-h-[72px] font-mono text-sm" value={value.kakaoTalkAllowedRoomIds} onChange={(event) => onChange({ kakaoTalkAllowedRoomIds: event.target.value })} />
        </label>
      </div>
      <LocalBridgeChecks
        values={[
          ["kakaoTalkBusinessApiEnabled", value.kakaoTalkBusinessApiEnabled, text("Business API 사용", "Business API enabled")],
          ["kakaoTalkRiskAcknowledged", value.kakaoTalkRiskAcknowledged, text("local bridge 위험 확인", "Local bridge risk acknowledged")],
          ["kakaoTalkLocalBridgeEnabled", value.kakaoTalkLocalBridgeEnabled, text("local bridge 사용", "Local bridge enabled")],
          ["kakaoTalkYeonjangBridgeEnabled", value.kakaoTalkYeonjangBridgeEnabled, text("Yeonjang bridge 사용", "Yeonjang bridge enabled")],
          ["kakaoTalkAppAvailable", value.kakaoTalkAppAvailable, text("KakaoTalk 앱 접근 가능", "KakaoTalk app available")],
          ["kakaoTalkUserSessionActive", value.kakaoTalkUserSessionActive, text("사용자 세션 활성", "User session active")],
          ["kakaoTalkAutomationPermissionGranted", value.kakaoTalkAutomationPermissionGranted, text("자동화 권한 허용", "Automation permission granted")],
          ["kakaoTalkManualConfirmationRequired", value.kakaoTalkManualConfirmationRequired, text("수동 확인 필수", "Manual confirmation required")],
        ]}
        onChange={onChange}
      />
    </fieldset>
  )
}

function LocalBridgeChecks({
  values,
  onChange,
}: {
  values: Array<[keyof SetupChannelDraft, boolean, string]>
  onChange: (patch: Partial<SetupChannelDraft>) => void
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {values.map(([key, checked, label]) => (
        <label key={String(key)} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-950">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange({ [key]: event.target.checked } as Partial<SetupChannelDraft>)}
          />
          {label}
        </label>
      ))}
    </div>
  )
}
