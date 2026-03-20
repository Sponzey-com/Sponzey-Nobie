import { useState } from "react"
import { api } from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

export function AuthTokenPanel({
  authEnabled,
  authToken,
  onGenerated,
}: {
  authEnabled: boolean
  authToken: string
  onGenerated: (token: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState("")
  const { text, displayText } = useUiI18n()

  async function generate() {
    setLoading(true)
    setResult("")
    try {
      const response = await api.generateAuthToken()
      onGenerated(response.token)
      setResult(text("새 로컬 auth token을 생성해 draft에 반영했습니다.", "Generated a new local auth token and applied it to the draft."))
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("WebUI 인증 토큰", "WebUI Auth Token")}</div>
        </div>
        <button
          onClick={() => void generate()}
          disabled={loading}
          className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text("생성 중...", "Generating...") : text("토큰 생성", "Generate Token")}
        </button>
      </div>
      <div className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text("현재 상태", "Current Status")}</div>
        <div className="mt-2">{authEnabled ? text("인증 사용", "Authentication enabled") : text("인증 비활성", "Authentication disabled")}</div>
        <div className="mt-2 break-all font-mono text-xs text-stone-600">{authToken}</div>
      </div>
      {result ? (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.includes(text("반영", "applied")) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {displayText(result)}
        </div>
      ) : null}
    </div>
  )
}
