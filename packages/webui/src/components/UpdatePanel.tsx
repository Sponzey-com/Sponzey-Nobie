import { useEffect, useState } from "react"
import { api } from "../api/client"
import type { UpdateSnapshot } from "../contracts/update"
import { useUiI18n } from "../lib/ui-i18n"

export function UpdatePanel() {
  const { text, displayText, formatDateTime } = useUiI18n()
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await api.updateStatus()
      setSnapshot(response)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function check() {
    setChecking(true)
    setError(null)
    try {
      const response = await api.checkForUpdates()
      setSnapshot(response)
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const tone =
    snapshot?.status === "update_available"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : snapshot?.status === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : snapshot?.status === "unsupported"
          ? "border-stone-200 bg-stone-100 text-stone-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{text("업데이트", "Updates")}</div>
          <div className="mt-1 text-xs text-stone-500">{text("현재 버전과 최신 버전을 확인하고, 새 버전이 있으면 수동 업데이트 안내를 제공합니다.", "Check the current and latest versions, then show manual update guidance when a newer version is available.")}</div>
        </div>
        <button
          onClick={() => void check()}
          disabled={checking}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? text("확인 중...", "Checking...") : text("업데이트 확인", "Check for updates")}
        </button>
      </div>

      {loading ? <div className="mt-4 text-sm text-stone-500">{text("불러오는 중...", "Loading...")}</div> : null}
      {error ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{displayText(error)}</div> : null}

      {!loading && !error && snapshot ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label={text("현재 버전", "Current version")} value={snapshot.currentVersion} />
            <SummaryCard label={text("최신 버전", "Latest version")} value={snapshot.latestVersion ?? text("확인 전", "Not checked")} />
            <SummaryCard label={text("마지막 확인", "Last checked")} value={formatCheckedAt(snapshot.checkedAt, text, formatDateTime)} />
          </div>

          <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
            <div className="text-sm font-semibold">
              {snapshot.status === "update_available"
                ? text("새 버전이 있습니다", "A new version is available")
                : snapshot.status === "latest"
                  ? text("최신 버전입니다", "You are up to date")
                  : snapshot.status === "unsupported"
                    ? text("자동 확인 미지원", "Automatic check unsupported")
                    : snapshot.status === "error"
                      ? text("업데이트 확인 실패", "Update check failed")
                      : text("업데이트 확인 전", "Update not checked")}
            </div>
            <div className="mt-1 text-sm leading-6">{displayText(snapshot.message)}</div>
          </div>

          <div className="space-y-3 text-sm text-stone-600">
            <DetailRow label={text("원격 저장소", "Repository")} value={snapshot.repositoryUrl ?? text("자동 감지 안 됨", "Not detected automatically")} mono />
            <DetailRow label={text("확인 방식", "Source")} value={formatSource(snapshot.source, text)} />
          </div>

          {snapshot.updateAvailable ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">{text("수동 업데이트 안내", "Manual update guidance")}</div>
              <div className="mt-2 leading-6">
                {text("자동 적용은 아직 없습니다. 변경사항을 백업한 뒤 새 릴리즈 설치 또는 저장소 업데이트 후 재빌드를 진행해 주세요.", "Automatic install is not available yet. Back up your changes, then install the new release or update the repository and rebuild.")}
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-xl bg-white/80 px-3 py-3 font-mono text-xs text-stone-700">git pull --ff-only{"\n"}pnpm -r build</div>
              {snapshot.releaseUrl ? (
                <a
                  href={snapshot.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex rounded-xl border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900"
                >
                  {text("릴리즈 페이지 열기", "Open release page")}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-2 break-all text-sm font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2">
      <span className="text-stone-500">{label}</span>
      <span className={`break-all text-right text-stone-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</span>
    </div>
  )
}

function formatCheckedAt(
  value: number | null,
  text: (ko: string, en: string) => string,
  formatDateTime: (value: number, options?: Intl.DateTimeFormatOptions) => string,
): string {
  if (!value) return text("아직 확인 안 함", "Not checked yet")
  return formatDateTime(value)
}

function formatSource(value: string | null, text: (ko: string, en: string) => string): string {
  switch (value) {
    case "github_release":
      return text("GitHub 릴리즈", "GitHub release")
    case "github_tag":
      return text("GitHub 태그", "GitHub tag")
    default:
      return text("미확인", "Unknown")
  }
}
