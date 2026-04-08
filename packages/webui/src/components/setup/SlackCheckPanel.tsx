import { useState } from "react"
import { api } from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

export function SlackCheckPanel({
  botToken,
  appToken,
}: {
  botToken: string
  appToken: string
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const { text, displayText } = useUiI18n()

  async function runCheck() {
    setLoading(true)
    setResult(null)
    try {
      const response = await api.testSlack(botToken, appToken)
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
          <div className="text-sm font-semibold text-stone-900">{text("Slack 연결 점검", "Slack Connection Check")}</div>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            {text(
              "이 점검은 토큰과 Socket Mode 연결만 확인합니다. 실제 대화 반응에는 Slack 앱의 Event Subscriptions(app_mention, message.im)과 채널 초대가 추가로 필요합니다.",
              "This check only verifies the tokens and Socket Mode connection. Actual chat replies also require Slack Event Subscriptions (app_mention, message.im) and inviting the bot to the channel.",
            )}
          </p>
        </div>
        <button
          onClick={() => void runCheck()}
          disabled={!botToken.trim() || !appToken.trim() || loading}
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
