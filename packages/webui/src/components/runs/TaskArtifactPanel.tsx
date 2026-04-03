import { getStoredToken } from "../../api/client"
import type { TaskArtifactModel } from "../../contracts/tasks"

function resolveArtifactUrl(url: string): string {
  if (!url.startsWith("/")) return url
  const token = getStoredToken()
  if (!token || url.includes("token=")) return url
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}

export function TaskArtifactPanel(params: {
  artifact: TaskArtifactModel
  title: string
  text: (ko: string, en: string) => string
}): JSX.Element {
  const { artifact, title, text } = params
  const artifactUrl = artifact.url ? resolveArtifactUrl(artifact.url) : ""
  const isImage = typeof artifact.mimeType === "string" && artifact.mimeType.startsWith("image/")

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{title}</div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        {artifactUrl && isImage ? (
          <a href={artifactUrl} target="_blank" rel="noreferrer">
            <img
              src={artifactUrl}
              alt={artifact.fileName}
              className="block max-h-[24rem] w-full bg-stone-50 object-contain"
              loading="lazy"
            />
          </a>
        ) : null}
        <div className="px-4 py-3">
          {artifactUrl ? (
            <a
              href={artifactUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-blue-700 underline"
            >
              {artifact.fileName}
            </a>
          ) : (
            <div className="text-sm font-medium text-stone-900">{artifact.fileName}</div>
          )}
          <div className="mt-1 break-words text-xs text-stone-500 [overflow-wrap:anywhere]">
            {artifact.filePath}
          </div>
          {!artifactUrl ? (
            <div className="mt-2 text-xs text-amber-700">
              {text(
                "이 파일은 WebUI 직접 미리보기 경로가 없어 링크를 만들지 못했습니다.",
                "This file does not have a direct WebUI preview path, so a link could not be created.",
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
