import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PATHS } from "../config/paths.js"
import { createLogger } from "../logger/index.js"

const log = createLogger("update:service")
const DEFAULT_GITHUB_REPOSITORY_URL = "https://github.com/Sponzey-com/Sponzey-Nobie"

type UpdateStatus = "idle" | "latest" | "update_available" | "unsupported" | "error"

export interface UpdateSnapshot {
  currentVersion: string
  latestVersion: string | null
  checkedAt: number | null
  updateAvailable: boolean
  status: UpdateStatus
  message: string
  source: string | null
  repositoryUrl: string | null
  releaseUrl: string | null
}

interface GithubRepoRef {
  owner: string
  repo: string
}

function getWorkspacePackageJsonPath(): string {
  return fileURLToPath(new URL("../../../package.json", import.meta.url))
}

function getGitConfigPath(): string {
  return fileURLToPath(new URL("../../../.git/config", import.meta.url))
}

function getUpdateStateFilePath(): string {
  return `${PATHS.stateDir}/update-state.json`
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/^v/i, "")
}

function parseVersionParts(version: string): number[] {
  return normalizeVersion(version)
    ?.split(/[.+-]/)
    .flatMap((part) => part.split("."))
    .map((part) => Number.parseInt(part.replace(/[^0-9]/g, ""), 10))
    .filter((part) => Number.isFinite(part)) ?? []
}

function compareVersions(left: string, right: string): number {
  const a = parseVersionParts(left)
  const b = parseVersionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

export function getCurrentAppVersion(): string {
  try {
    const raw = readFileSync(getWorkspacePackageJsonPath(), "utf-8")
    const parsed = JSON.parse(raw) as { version?: string }
    return normalizeVersion(parsed.version) ?? "0.1.0"
  } catch {
    return "0.1.0"
  }
}

function buildSnapshot(partial: Partial<UpdateSnapshot>): UpdateSnapshot {
  return {
    currentVersion: partial.currentVersion ?? getCurrentAppVersion(),
    latestVersion: partial.latestVersion ?? null,
    checkedAt: partial.checkedAt ?? null,
    updateAvailable: partial.updateAvailable ?? false,
    status: partial.status ?? "idle",
    message: partial.message ?? "아직 업데이트 확인을 실행하지 않았습니다.",
    source: partial.source ?? null,
    repositoryUrl: partial.repositoryUrl ?? null,
    releaseUrl: partial.releaseUrl ?? null,
  }
}

function readStoredSnapshot(): UpdateSnapshot | null {
  const path = getUpdateStateFilePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<UpdateSnapshot>
    return buildSnapshot({
      currentVersion: typeof parsed.currentVersion === "string" ? parsed.currentVersion : getCurrentAppVersion(),
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : null,
      checkedAt: typeof parsed.checkedAt === "number" ? parsed.checkedAt : null,
      updateAvailable: parsed.updateAvailable === true,
      status: typeof parsed.status === "string" ? parsed.status as UpdateStatus : "idle",
      message: typeof parsed.message === "string" ? parsed.message : "아직 업데이트 확인을 실행하지 않았습니다.",
      source: typeof parsed.source === "string" ? parsed.source : null,
      repositoryUrl: typeof parsed.repositoryUrl === "string" ? parsed.repositoryUrl : null,
      releaseUrl: typeof parsed.releaseUrl === "string" ? parsed.releaseUrl : null,
    })
  } catch {
    return null
  }
}

function writeStoredSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  const path = getUpdateStateFilePath()
  ensureParentDir(path)
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8")
  return snapshot
}

function sanitizeRepositoryUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    parsed.username = ""
    parsed.password = ""
    return parsed.toString().replace(/\/$/, "").replace(/\.git$/i, "")
  } catch {
    return trimmed.replace(/\.git$/i, "")
  }
}

function getConfiguredRepositoryUrl(): string {
  const explicit = process.env["NOBIE_UPDATE_REPOSITORY"] ?? process.env["WIZBY_UPDATE_REPOSITORY"] ?? process.env["HOWIE_UPDATE_REPOSITORY"]
  const explicitRepository = sanitizeRepositoryUrl(explicit)
  if (explicitRepository) return explicitRepository

  const gitConfigPath = getGitConfigPath()
  if (existsSync(gitConfigPath)) {
    try {
      const raw = readFileSync(gitConfigPath, "utf-8")
      const match = raw.match(/\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+)/)
      const remoteRepository = sanitizeRepositoryUrl(match?.[1] ?? null)
      if (remoteRepository) return remoteRepository
    } catch {
      // fall through to default GitHub repository
    }
  }

  return DEFAULT_GITHUB_REPOSITORY_URL
}

function parseGithubRepository(repositoryUrl: string | null): GithubRepoRef | null {
  if (!repositoryUrl) return null
  const normalized = repositoryUrl.trim().replace(/\.git$/i, "")
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/i)
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/i)
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] }
  }
  return null
}

async function fetchGithubLatestRelease(ref: GithubRepoRef, currentVersion: string, repositoryUrl: string): Promise<UpdateSnapshot> {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `Sponzey-Nobie/${currentVersion}`,
  }

  const releaseResponse = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`, { headers })
  if (releaseResponse.ok) {
    const payload = await releaseResponse.json() as {
      tag_name?: string
      name?: string
      html_url?: string
    }
    const latestVersion = normalizeVersion(payload.tag_name ?? payload.name)
    if (!latestVersion) {
      return buildSnapshot({
        currentVersion,
        checkedAt: Date.now(),
        status: "error",
        message: "최신 릴리즈 응답에서 버전 값을 찾지 못했습니다.",
        source: "github_release",
        repositoryUrl,
        releaseUrl: payload.html_url ?? null,
      })
    }

    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
    return buildSnapshot({
      currentVersion,
      latestVersion,
      checkedAt: Date.now(),
      updateAvailable,
      status: updateAvailable ? "update_available" : "latest",
      message: updateAvailable
        ? `새 버전 ${latestVersion} 이(가) 확인되었습니다. 자동 적용은 아직 없어서 수동 업데이트가 필요합니다.`
        : "현재 최신 버전을 사용 중입니다.",
      source: "github_release",
      repositoryUrl,
      releaseUrl: payload.html_url ?? `${repositoryUrl.replace(/\.git$/i, "")}/releases/latest`,
    })
  }

  if (releaseResponse.status != 404) {
    const detail = await releaseResponse.text().catch(() => "")
    throw new Error(detail.trim() || `GitHub release API ${releaseResponse.status}`)
  }

  const tagsResponse = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/tags?per_page=1`, { headers })
  if (!tagsResponse.ok) {
    const detail = await tagsResponse.text().catch(() => "")
    throw new Error(detail.trim() || `GitHub tags API ${tagsResponse.status}`)
  }

  const tags = await tagsResponse.json() as Array<{ name?: string }>
  const latestVersion = normalizeVersion(tags[0]?.name)
  if (!latestVersion) {
    return buildSnapshot({
      currentVersion,
      checkedAt: Date.now(),
      status: "unsupported",
      message: "릴리즈나 태그 정보를 찾지 못해 업데이트 여부를 판단할 수 없습니다.",
      source: "github_tag",
      repositoryUrl,
      releaseUrl: `${repositoryUrl.replace(/\.git$/i, "")}/tags`,
    })
  }

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
  return buildSnapshot({
    currentVersion,
    latestVersion,
    checkedAt: Date.now(),
    updateAvailable,
    status: updateAvailable ? "update_available" : "latest",
    message: updateAvailable
      ? `새 버전 ${latestVersion} 이(가) 태그 기준으로 확인되었습니다. 자동 적용은 아직 없어서 수동 업데이트가 필요합니다.`
      : "현재 최신 버전을 사용 중입니다.",
    source: "github_tag",
    repositoryUrl,
    releaseUrl: `${repositoryUrl.replace(/\.git$/i, "")}/tags`,
  })
}

export function getUpdateSnapshot(): UpdateSnapshot {
  const currentVersion = getCurrentAppVersion()
  const stored = readStoredSnapshot()
  if (!stored) {
    return buildSnapshot({
      currentVersion,
      repositoryUrl: getConfiguredRepositoryUrl(),
      message: "아직 업데이트 확인을 실행하지 않았습니다.",
    })
  }
  return buildSnapshot({ ...stored, currentVersion })
}

export async function checkForUpdates(): Promise<UpdateSnapshot> {
  const currentVersion = getCurrentAppVersion()
  const repositoryUrl = getConfiguredRepositoryUrl()
  const githubRef = parseGithubRepository(repositoryUrl)

  if (!githubRef) {
    const snapshot = buildSnapshot({
      currentVersion,
      checkedAt: Date.now(),
      status: "unsupported",
      updateAvailable: false,
      repositoryUrl,
      message: "GitHub 저장소 정보를 해석하지 못했습니다. 업데이트 대상 저장소 설정을 확인해 주세요.",
    })
    return writeStoredSnapshot(snapshot)
  }

  try {
    const snapshot = await fetchGithubLatestRelease(githubRef, currentVersion, repositoryUrl)
    return writeStoredSnapshot(snapshot)
  } catch (error) {
    log.error("update check failed", error)
    const snapshot = buildSnapshot({
      currentVersion,
      checkedAt: Date.now(),
      status: "error",
      updateAvailable: false,
      repositoryUrl,
      message: error instanceof Error ? error.message : String(error),
      source: "github_release",
    })
    return writeStoredSnapshot(snapshot)
  }
}
