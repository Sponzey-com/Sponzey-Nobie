import { useState } from "react"
import { useUiI18n } from "../lib/ui-i18n"

interface Props {
  onLogin: (token: string) => void
}

export function LoginPage({ onLogin }: Props) {
  const { text } = useUiI18n()
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const t = token.trim()
    if (!t) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/status", {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (res.ok) {
        localStorage.setItem("nobie_token", t)
        localStorage.setItem("wizby_token", t)
        localStorage.setItem("howie_token", t)
        localStorage.setItem("nobie_token", t)
        onLogin(t)
      } else if (res.status === 429) {
        const data = await res.json() as { retryAfter?: number }
        setError(text(`너무 많은 실패. ${data.retryAfter ?? 300}초 후 재시도하세요.`, `Too many failed attempts. Try again after ${data.retryAfter ?? 300} seconds.`))
      } else {
        setError(text("토큰이 올바르지 않습니다.", "The token is invalid."))
      }
    } catch {
      setError(text("서버에 연결할 수 없습니다.", "Cannot connect to the server."))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">스폰지 노비 · Sponzey Nobie</h1>
          <p className="mt-1 text-sm text-gray-500">{text("액세스 토큰을 입력하세요", "Enter the access token")}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{text("토큰", "Token")}</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••••••••••"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
            />
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? text("확인 중...", "Checking...") : text("연결", "Connect")}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-400">
          {text("로컬(127.0.0.1) 접근 시 토큰 불필요", "No token is required for local access (127.0.0.1)")}
        </p>
      </div>
    </div>
  )
}
