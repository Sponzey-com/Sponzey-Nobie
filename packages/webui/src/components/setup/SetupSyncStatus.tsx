import { useUiI18n } from "../../lib/ui-i18n"

export function SetupSyncStatus({
  saving,
  lastSavedAt,
  lastError,
}: {
  saving: boolean
  lastSavedAt: number | null
  lastError: string
}) {
  const { text, displayText, formatTime } = useUiI18n()

  if (!saving && !lastSavedAt && !lastError) return null

  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${saving ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {saving ? text("저장 중", "Saving") : text("로컬 저장 연결됨", "Local save connected")}
        </span>
        {lastSavedAt ? (
          <span className="text-stone-500">{text("마지막 저장", "Last saved")} {formatTime(lastSavedAt, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        ) : null}
      </div>
      {lastError ? (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {displayText(lastError)}
        </div>
      ) : null}
    </div>
  )
}
