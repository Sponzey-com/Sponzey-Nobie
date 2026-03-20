import { useState } from "react"
import { api } from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

export function TelegramCheckPanel({
  botToken,
}: {
  botToken: string
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const { text, displayText } = useUiI18n()

  async function runCheck() {
    setLoading(true)
    setResult(null)
    try {
      const response = await api.testTelegram(botToken)
      setResult(response)
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("Telegram 연결 점검", "Telegram Connection Check")}</div>
        </div>
        <button
          onClick={() => void runCheck()}
          disabled={!botToken.trim() || loading}
          className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("점검 중...", "Checking...") : text("연결 테스트", "Test Connection")}
        </button>
      </div>
      {result ? (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {displayText(result.message)}
        </div>
      ) : null}
    </div>
  )
}
