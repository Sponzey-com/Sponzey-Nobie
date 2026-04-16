import { useEffect, useState } from "react"
import { api } from "../api/client"
import type { PromptSourceDocument, PromptSourceDryRunResult, PromptSourceLocaleParityResult, PromptSourceMetadata, PromptSourceRegressionResult, PromptSourceWriteResult } from "../api/client"
import type { ActiveInstructionsResponse } from "../contracts/instructions"
import { useUiI18n } from "../lib/ui-i18n"

export function ActiveInstructionsPanel() {
  const { text, displayText } = useUiI18n()
  const [data, setData] = useState<ActiveInstructionsResponse | null>(null)
  const [promptSources, setPromptSources] = useState<PromptSourceMetadata[]>([])
  const [promptSourcesWorkDir, setPromptSourcesWorkDir] = useState("")
  const [promptDryRun, setPromptDryRun] = useState<PromptSourceDryRunResult | null>(null)
  const [promptParity, setPromptParity] = useState<PromptSourceLocaleParityResult | null>(null)
  const [promptRegression, setPromptRegression] = useState<PromptSourceRegressionResult | null>(null)
  const [selectedPromptSourceKey, setSelectedPromptSourceKey] = useState("")
  const [promptSourceDocument, setPromptSourceDocument] = useState<PromptSourceDocument | null>(null)
  const [promptSourceDraft, setPromptSourceDraft] = useState("")
  const [promptSourceResult, setPromptSourceResult] = useState<PromptSourceWriteResult | null>(null)
  const [promptSourceAction, setPromptSourceAction] = useState<"loading" | "saving" | "rollback" | null>(null)
  const [promptSourceError, setPromptSourceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [response, promptSourceResponse, promptDryRunResponse, promptParityResponse, promptRegressionResponse] = await Promise.all([
        api.instructionsActive(),
        api.promptSources(),
        api.promptSourcesDryRun(),
        api.promptSourcesParity(),
        api.promptSourcesRegression(),
      ])
      setData(response)
      const nextSources = promptSourceResponse.sources
      setPromptSources(nextSources)
      setPromptSourcesWorkDir(promptSourceResponse.workDir)
      setSelectedPromptSourceKey((current) => {
        if (current && nextSources.some((source) => promptSourceKey(source) === current)) return current
        return nextSources[0] ? promptSourceKey(nextSources[0]) : ""
      })
      setPromptDryRun(promptDryRunResponse.dryRun)
      setPromptParity(promptParityResponse.parity)
      setPromptRegression(promptRegressionResponse.regression)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selectedPromptSourceKey) {
      setPromptSourceDocument(null)
      setPromptSourceDraft("")
      return
    }
    void loadPromptSourceDocument(selectedPromptSourceKey)
  }, [selectedPromptSourceKey, promptSourcesWorkDir])

  async function loadPromptSourceDocument(key = selectedPromptSourceKey) {
    const parsed = parsePromptSourceKey(key)
    if (!parsed) return
    setPromptSourceAction("loading")
    setPromptSourceError(null)
    try {
      const response = await api.promptSource(parsed.sourceId, parsed.locale, promptSourcesWorkDir || undefined)
      setPromptSourceDocument(response.source)
      setPromptSourceDraft(response.source.content)
    } catch (sourceError) {
      setPromptSourceError(sourceError instanceof Error ? sourceError.message : String(sourceError))
    } finally {
      setPromptSourceAction(null)
    }
  }

  async function savePromptSource() {
    if (!promptSourceDocument) return
    setPromptSourceAction("saving")
    setPromptSourceError(null)
    try {
      const result = await api.writePromptSource(promptSourceDocument.sourceId, promptSourceDocument.locale, {
        workDir: promptSourcesWorkDir || undefined,
        content: promptSourceDraft,
        createBackup: true,
      })
      setPromptSourceResult(result)
      setPromptSourceDocument({ ...result.source, content: promptSourceDraft.trimEnd() })
      setPromptSources((sources) => sources.map((source) => promptSourceKey(source) === promptSourceKey(result.source) ? result.source : source))
      await load()
    } catch (saveError) {
      setPromptSourceError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setPromptSourceAction(null)
    }
  }

  async function rollbackPromptSource() {
    const backup = promptSourceResult?.backup
    if (!backup) return
    setPromptSourceAction("rollback")
    setPromptSourceError(null)
    try {
      await api.rollbackPromptSource({ sourcePath: backup.sourcePath, backupPath: backup.backupPath })
      setPromptSourceResult(null)
      await load()
      await loadPromptSourceDocument(selectedPromptSourceKey)
    } catch (rollbackError) {
      setPromptSourceError(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
    } finally {
      setPromptSourceAction(null)
    }
  }

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
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text("프롬프트 소스", "Prompt Sources")}</div>
                  <div className="mt-1 text-xs text-stone-500">
                    {text("runtime dry-run 순서와 checksum", "Runtime dry-run order and checksums")}: {promptDryRun?.totalChars ?? 0} chars
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className={`rounded-full px-2 py-1 text-xs font-semibold ${promptParity?.ok === false ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {promptParity?.ok === false ? text("locale 점검 필요", "Locale check needed") : text("locale 정상", "Locale OK")}
                  </div>
                  <div className={`rounded-full px-2 py-1 text-xs font-semibold ${promptRegression?.ok === false ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {promptRegression?.ok === false ? text("regression 실패", "Regression failed") : text("regression 정상", "Regression OK")}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {promptSources.map((source) => (
                  <div key={`${source.sourceId}-${source.locale}`} className="rounded-lg bg-white px-3 py-2 text-xs text-stone-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-stone-900">{source.sourceId}:{source.locale}</span>
                      <span className="font-mono text-[11px] text-stone-500">{source.checksum.slice(0, 12)}</span>
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] text-stone-400">{source.path}</div>
                  </div>
                ))}
              </div>
              {promptParity?.issues.length ? (
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {promptParity.issues.slice(0, 5).map((issue) => issue.message).join(" / ")}
                </div>
              ) : null}
              {promptRegression ? (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${promptRegression.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                  <div className="font-semibold">
                    {text("프롬프트 회귀 검증", "Prompt regression")}: {promptRegression.issues.length} {text("개 이슈", "issues")}
                  </div>
                  {promptRegression.issues.length ? (
                    <div className="mt-1 space-y-1">
                      {promptRegression.issues.slice(0, 6).map((issue, index) => (
                        <div key={`${issue.code}-${issue.sourceId ?? "assembly"}-${issue.locale ?? "all"}-${index}`}>
                          {issue.sourceId ? `${issue.sourceId}:${issue.locale ?? "all"} · ` : ""}{displayText(issue.message)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1">
                      {text("책임 중복, locale parity, impact marker가 모두 통과했습니다.", "Responsibility split, locale parity, and impact markers passed.")}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-stone-200 bg-white px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="min-w-0 flex-1 text-xs font-semibold text-stone-600">
                    {text("소스 편집", "Source editor")}
                    <select
                      value={selectedPromptSourceKey}
                      onChange={(event) => {
                        setPromptSourceResult(null)
                        setSelectedPromptSourceKey(event.target.value)
                      }}
                      className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
                    >
                      {promptSources.map((source) => (
                        <option key={promptSourceKey(source)} value={promptSourceKey(source)}>
                          {source.sourceId}:{source.locale} · {source.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void loadPromptSourceDocument()}
                      disabled={!selectedPromptSourceKey || promptSourceAction !== null}
                      className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50"
                    >
                      {text("다시 불러오기", "Reload")}
                    </button>
                    <button
                      onClick={() => void savePromptSource()}
                      disabled={!promptSourceDocument || promptSourceAction !== null || promptSourceDraft.trim() === promptSourceDocument.content.trim()}
                      className="rounded-xl bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {promptSourceAction === "saving" ? text("저장 중", "Saving") : text("백업 후 저장", "Save with backup")}
                    </button>
                    <button
                      onClick={() => void rollbackPromptSource()}
                      disabled={!promptSourceResult?.backup || promptSourceAction !== null}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-40"
                    >
                      {promptSourceAction === "rollback" ? text("복구 중", "Rolling back") : text("직전 백업 복구", "Rollback")}
                    </button>
                  </div>
                </div>

                {promptSourceError ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{displayText(promptSourceError)}</div> : null}
                {promptSourceAction === "loading" ? <div className="mt-3 text-xs text-stone-500">{text("소스 불러오는 중...", "Loading source...")}</div> : null}

                {promptSourceDocument ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500">
                      <span className="rounded-full bg-stone-50 px-2 py-1">{promptSourceDocument.sourceId}:{promptSourceDocument.locale}</span>
                      <span className="rounded-full bg-stone-50 px-2 py-1 font-mono">{promptSourceDocument.checksum.slice(0, 12)}</span>
                      <span className="rounded-full bg-stone-50 px-2 py-1">{promptSourceDocument.usageScope}</span>
                    </div>
                    <textarea
                      value={promptSourceDraft}
                      onChange={(event) => setPromptSourceDraft(event.target.value)}
                      className="mt-3 min-h-56 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 font-mono text-xs leading-5 text-stone-800 outline-none focus:border-stone-400"
                      spellCheck={false}
                    />
                  </>
                ) : null}

                {promptSourceResult ? (
                  <div className="mt-4 rounded-xl bg-stone-50 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                      <span className="font-semibold text-stone-900">{text("Diff 결과", "Diff result")}</span>
                      <span className="font-mono">{promptSourceResult.diff.beforeChecksum.slice(0, 12)} → {promptSourceResult.diff.afterChecksum.slice(0, 12)}</span>
                    </div>
                    <div className="mt-3 max-h-64 overflow-auto rounded-lg bg-white p-2 font-mono text-[11px] leading-5 text-stone-700">
                      {promptSourceResult.diff.lines.filter((line) => line.kind !== "unchanged").slice(0, 80).map((line, index) => (
                        <div key={`${line.kind}-${line.beforeLine ?? ""}-${line.afterLine ?? ""}-${index}`} className={line.kind === "added" ? "text-emerald-700" : line.kind === "removed" ? "text-red-700" : "text-amber-700"}>
                          {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : "~"} {line.after ?? line.before ?? ""}
                        </div>
                      ))}
                      {promptSourceResult.diff.lines.every((line) => line.kind === "unchanged") ? <div>{text("변경 없음", "No changes")}</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

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

function promptSourceKey(source: { sourceId: string; locale: "ko" | "en" }): string {
  return `${source.sourceId}::${source.locale}`
}

function parsePromptSourceKey(key: string): { sourceId: string; locale: "ko" | "en" } | null {
  const [sourceId, locale] = key.split("::")
  if (!sourceId || (locale !== "ko" && locale !== "en")) return null
  return { sourceId, locale }
}
