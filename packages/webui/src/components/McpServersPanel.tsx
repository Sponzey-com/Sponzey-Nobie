import { useEffect, useState } from "react"
import { api } from "../api/client"
import type { McpServersResponse } from "../contracts/mcp"
import { useUiI18n } from "../lib/ui-i18n"

export function McpServersPanel() {
  const { text, displayText } = useUiI18n()
  const [data, setData] = useState<McpServersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await api.mcpServers()
      setData(response)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function reload() {
    setReloading(true)
    setError(null)
    try {
      const response = await api.reloadMcpServers()
      setData(response)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : String(reloadError))
    } finally {
      setReloading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">MCP Servers</div>
          <div className="mt-1 text-xs text-stone-500">{text("stdio 기반 MCP server 연결 상태와 discovery된 도구", "The stdio-based MCP server status and the discovered tools")}</div>
        </div>
        <button
          onClick={() => void reload()}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={reloading}
        >
          {reloading ? text("새로고침 중...", "Reloading...") : text("MCP 재로드", "Reload MCP")}
        </button>
      </div>

      {loading ? <div className="mt-4 text-sm text-stone-500">{text("불러오는 중...", "Loading...")}</div> : null}
      {error ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{displayText(error)}</div> : null}

      {!loading && !error && data ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryCard label={text("설정 수", "Configured")} value={String(data.summary.serverCount)} />
            <SummaryCard label={text("준비됨", "Ready")} value={String(data.summary.readyCount)} />
            <SummaryCard label={text("도구 수", "Tools")} value={String(data.summary.toolCount)} />
            <SummaryCard label={text("필수 실패", "Required Failures")} value={String(data.summary.requiredFailures)} />
          </div>

          {data.servers.length > 0 ? (
            <div className="space-y-3">
              {data.servers.map((server) => (
                <div key={server.name} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">{server.name}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-stone-500">
                        <span className="rounded-full bg-white px-2 py-1">{server.transport}</span>
                        <span className="rounded-full bg-white px-2 py-1">{server.ready ? text("준비됨", "Ready") : text("준비 안 됨", "Not ready")}</span>
                        <span className="rounded-full bg-white px-2 py-1">{text(`도구 ${server.registeredToolCount}`, `tools ${server.registeredToolCount}`)}</span>
                        {server.required ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">{text("필수", "Required")}</span> : null}
                      </div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${server.ready ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"}`}>
                      {server.ready ? text("준비됨", "READY") : text("비활성", "DISABLED")}
                    </div>
                  </div>

                  {server.command ? <DetailRow label="Command" value={server.command} mono /> : null}
                  {server.url ? <DetailRow label="URL" value={server.url} mono /> : null}
                  {server.error ? <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{displayText(server.error)}</div> : null}

                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text("도구", "Tools")}</div>
                    {server.tools.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {server.tools.map((tool) => (
                          <div key={tool.registeredName} className="rounded-xl border border-stone-200 bg-white px-3 py-3">
                            <div className="text-sm font-semibold text-stone-900">{tool.name}</div>
                            <div className="mt-1 break-all font-mono text-xs text-stone-500">{tool.registeredName}</div>
                            {tool.description ? <div className="mt-2 text-sm leading-6 text-stone-600">{displayText(tool.description)}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-xl border border-dashed border-stone-200 bg-white px-3 py-4 text-sm text-stone-500">
                        {text("discovery된 MCP 도구가 없습니다.", "No MCP tools were discovered.")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-500">
              {text("설정된 MCP 서버가 없습니다.", "There are no configured MCP servers.")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm text-stone-600">
      <span>{label}</span>
      <span className={`break-all text-right text-stone-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</span>
    </div>
  )
}
