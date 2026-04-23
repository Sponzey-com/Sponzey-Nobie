import { useEffect, useState } from "react"
import { api } from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

export function TelegramCheckPanel({
  botToken,
  result,
  onResult,
}: {
  botToken: string
  result?: { ok: boolean; message: string } | null
  onResult?: (result: { ok: boolean; message: string } | null) => void
}) {
  const [loading, setLoading] = useState(false)
  const [internalResult, setInternalResult] = useState<{ ok: boolean; message: string } | null>(null)
  const { text, displayText } = useUiI18n()
  const activeResult = result ?? internalResult

  useEffect(() => {
    if (result !== undefined) return
    setInternalResult(null)
  }, [botToken, result])

  async function runCheck() {
    setLoading(true)
    setInternalResult(null)
    onResult?.(null)
    try {
      const response = await api.testTelegram(botToken)
      setInternalResult(response)
      onResult?.(response)
    } catch (error) {
      const failedResult = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
      setInternalResult(failedResult)
      onResult?.(failedResult)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("Telegram 연결 점검", "Telegram Connection Check")}</div>
        </div>
        <button
          onClick={() => void runCheck()}
          disabled={!botToken.trim() || loading}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("점검 중...", "Checking...") : text("연결 테스트", "Test Connection")}
        </button>
      </div>
      {activeResult ? (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${activeResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {displayText(activeResult.message)}
        </div>
      ) : null}
    </div>
  )
}
