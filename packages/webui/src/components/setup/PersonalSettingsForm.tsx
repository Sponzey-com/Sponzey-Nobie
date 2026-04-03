import type { SetupPersonalDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"

const LANGUAGE_OPTIONS = [
  { value: "ko", labelKo: "한국어", labelEn: "Korean" },
  { value: "en", labelKo: "영어", labelEn: "English" },
  { value: "ja", labelKo: "일본어", labelEn: "Japanese" },
  { value: "zh-CN", labelKo: "중국어(간체)", labelEn: "Chinese (Simplified)" },
]

function getTimezoneOptions(current: string): string[] {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  return Array.from(
    new Set([
      current,
      detected,
      "Asia/Seoul",
      "Asia/Tokyo",
      "UTC",
      "America/Los_Angeles",
      "America/New_York",
      "Europe/London",
    ].filter((item) => item && item.trim().length > 0)),
  )
}

export function PersonalSettingsForm({
  value,
  onChange,
  errors,
}: {
  value: SetupPersonalDraft
  onChange: (patch: Partial<SetupPersonalDraft>) => void
  errors?: Partial<Record<keyof SetupPersonalDraft, string>>
}) {
  const timezoneOptions = getTimezoneOptions(value.timezone)
  const { text } = useUiI18n()

  return (
    <div className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("이름 (Profile Name) *", "Name (Profile Name) *")}</label>
          <input
            className="input"
            value={value.profileName}
            onChange={(event) => onChange({ profileName: event.target.value })}
            placeholder={text("사용할 이름을 적어주세요", "Enter the name to use")}
          />
          {errors?.profileName ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.profileName}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("표시 이름 (Display Name) *", "Display Name *")}</label>
          <input
            className="input"
            value={value.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
            placeholder={text("화면에 보여줄 이름을 적어주세요", "Enter the name shown on screen")}
          />
          {errors?.displayName ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.displayName}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("기본 언어 (Language) *", "Default Language *")}</label>
          <select
            className="input"
            value={value.language}
            onChange={(event) => onChange({ language: event.target.value })}
          >
            <option value="">{text("언어를 선택해 주세요", "Choose a language")}</option>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {text(option.labelKo, option.labelEn)}
              </option>
            ))}
          </select>
          {errors?.language ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.language}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("시간대 (Timezone) *", "Timezone *")}</label>
          <select
            className="input"
            value={value.timezone}
            onChange={(event) => onChange({ timezone: event.target.value })}
          >
            <option value="">{text("시간대를 선택해 주세요", "Choose a timezone")}</option>
            {timezoneOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {errors?.timezone ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.timezone}</p> : null}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">{text("기본 작업 폴더 (Workspace) *", "Default Workspace *")}</label>
        <input
          className="input font-mono"
          value={value.workspace}
          onChange={(event) => onChange({ workspace: event.target.value })}
          placeholder={text("예: ./Work", "Example: ./Work")}
        />
        {errors?.workspace ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.workspace}</p> : null}
      </div>

      <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
        <div className="font-medium text-stone-800">{text("이 값은 어디에 쓰이나요?", "Where is this used?")}</div>
        <div className="mt-2">{text("이름과 표시 이름은 Nobie가 사용자를 구분하고 화면에 보여줄 때 사용합니다.", "Name and display name are used when Nobie identifies you and shows your profile on screen.")}</div>
        <div>{text("기본 언어와 시간대는 이후 응답 언어, 일정 처리, 알림 시간 계산의 기준값이 됩니다.", "Default language and timezone are used for response language, scheduling, and notification timing.")}</div>
        <div>{text("기본 작업 폴더는 이후 파일 작업이나 자동화가 시작될 때 기본 위치로 재사용됩니다.", "The default workspace is reused as the starting location for later file work and automation.")}</div>
      </div>
    </div>
  )
}
