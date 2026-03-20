import { useUiI18n } from "../../lib/ui-i18n"

export function CancelRunButton({
  canCancel,
  onCancel,
}: {
  canCancel: boolean
  onCancel: () => void
}) {
  const { text } = useUiI18n()

  return (
    <button
      onClick={onCancel}
      disabled={!canCancel}
      className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {text("실행 취소", "Cancel Run")}
    </button>
  )
}
