import { useEffect, useState } from "react"
import { api } from "../api/client"
import type { ActiveInstructionsResponse } from "../contracts/instructions"
import { useUiI18n } from "../lib/ui-i18n"

export function ActiveInstructionsPanel() {
  const { text, displayText } = useUiI18n()
  const [data, setData] = useState<ActiveInstructionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await api.instructionsActive()
      setData(response)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("활성 지침", "Active Instructions")}</div>
          <div className="mt-1 text-xs text-stone-500">{text("현재 gateway가 실제로 합쳐서 사용하는 instruction chain", "The instruction chain currently merged and used by the gateway")}</div>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700"
        >
          {text("새로고침", "Refresh")}
        </button>
      </div>

      {loading ? <div className="mt-4 text-sm text-stone-500">{text("불러오는 중...", "Loading...")}</div> : null}
      {error ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{displayText(error)}</div> : null}

      {!loading && !error && data ? (
        <div className="mt-4 space-y-4">
          <div className="space-y-2 text-sm text-stone-600">
            <StatusRow label="Work Dir" value={data.workDir} mono />
            <StatusRow label="Git Root" value={data.gitRoot ?? ""} mono />
            <StatusRow label={text("불러온 소스 수", "Loaded sources")} value={String(data.sources.length)} />
          </div>

          <div className="space-y-3">
            {data.sources.length > 0 ? (
              data.sources.map((source) => (
                <div key={`${source.path}-${source.level}`} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">{source.scope}</div>
                      <div className="mt-1 break-all font-mono text-xs text-stone-500">{source.path}</div>
                    </div>
                    <div className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-stone-700">
                      L{source.level}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                    <span className="rounded-full bg-white px-2 py-1">{source.loaded ? text("불러옴", "Loaded") : text("오류", "Error")}</span>
                    <span className="rounded-full bg-white px-2 py-1">{source.size} bytes</span>
                  </div>
                  {source.error ? <div className="mt-3 text-xs leading-5 text-red-700">{displayText(source.error)}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-500">
                {text("활성 instruction 파일이 없습니다.", "There are no active instruction files.")}
              </div>
            )}
          </div>

          {data.mergedText.trim() ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text("병합 미리보기", "Merged Preview")}</div>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-stone-700">
                {data.mergedText.slice(0, 2000)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StatusRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2">
      <span className="text-stone-500">{label}</span>
      <span className={`break-all text-right font-medium text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}
