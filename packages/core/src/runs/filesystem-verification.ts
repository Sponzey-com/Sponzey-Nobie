import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { displayHomePath } from "./delivery.js"
import { inferFilesystemKindFromPath, normalizeFilesystemPath } from "./execution.js"

export interface FilesystemVerificationResult {
  ok: boolean
  summary: string
  message: string
  reason?: string
  remainingItems?: string[]
}

interface FilesystemVerificationTarget {
  path: string
  kind: "file" | "dir"
  expect: "exists" | "missing"
}

export function buildFilesystemVerificationPrompt(originalRequest: string, mutationPaths: string[]): string {
  const lines = [
    "[Filesystem Verification]",
    `원래 사용자 요청: ${originalRequest}`,
  ]
  if (mutationPaths.length > 0) {
    lines.push("검증 대상 경로:")
    for (const mutationPath of mutationPaths) lines.push(`- ${mutationPath}`)
  }
  return lines.join("\n")
}

export function verifyFilesystemTargets(params: {
  originalRequest: string
  mutationPaths: string[]
  workDir: string
}): FilesystemVerificationResult {
  const targets = inferFilesystemVerificationTargets(params.originalRequest, params.mutationPaths, params.workDir)
  if (targets.length === 0) {
    return {
      ok: false,
      summary: "생성 결과를 검증할 경로를 찾지 못했습니다.",
      message: "검증 결과:\n- 검증할 파일 또는 폴더 경로를 자동으로 추론하지 못했습니다.",
      reason: "검증 대상 경로 추론 실패",
      remainingItems: ["생성 또는 수정이 일어난 경로를 다시 확인해 주세요."],
    }
  }

  const confirmed: string[] = []
  const missing: string[] = []
  const readableSummaries: string[] = []

  for (const target of targets) {
    if (!existsSync(target.path)) {
      if (target.expect === "exists") missing.push(`${displayHomePath(target.path)} (${target.kind})`)
      else confirmed.push(`삭제 확인: ${displayHomePath(target.path)}`)
      continue
    }

    const stat = safeStat(target.path)
    if (!stat) {
      missing.push(`${displayHomePath(target.path)} (${target.kind})`)
      continue
    }

    if (target.expect === "missing") {
      missing.push(`${displayHomePath(target.path)} (삭제되어야 함)`)
      continue
    }

    if (target.kind === "dir" && !stat.isDirectory()) {
      missing.push(`${displayHomePath(target.path)} (폴더가 아님)`)
      continue
    }
    if (target.kind === "file" && !stat.isFile()) {
      missing.push(`${displayHomePath(target.path)} (파일이 아님)`)
      continue
    }

    confirmed.push(`${target.kind === "dir" ? "폴더 확인" : "파일 확인"}: ${displayHomePath(target.path)}`)
    if (target.kind === "file" && readableSummaries.length < 2) {
      const snippet = safeReadSnippet(target.path)
      if (snippet) readableSummaries.push(`읽기 확인: ${displayHomePath(target.path)} -> ${snippet}`)
    }
  }

  if (missing.length > 0) {
    const remainingItems = missing.map((item) => `${item} 경로를 다시 확인해야 합니다.`)
    const lines = [
      "검증 결과:",
      ...confirmed.map((item) => `- ${item}`),
      ...readableSummaries.map((item) => `- ${item}`),
      ...missing.map((item) => `- 누락: ${item}`),
    ]
    return {
      ok: false,
      summary: "생성된 파일 또는 폴더를 자동 검증하지 못했습니다.",
      message: lines.join("\n"),
      reason: "실제 생성 증거가 충분하지 않습니다.",
      remainingItems,
    }
  }

  const lines = [
    "검증 결과:",
    ...confirmed.map((item) => `- ${item}`),
    ...readableSummaries.map((item) => `- ${item}`),
  ]
  const firstConfirmed = confirmed[0]
  return {
    ok: true,
    summary: firstConfirmed
      ? `실제 파일/폴더 생성 검증 완료: ${firstConfirmed.replace(/^.+?:\s*/, "")}`
      : "실제 파일/폴더 생성 검증을 완료했습니다.",
    message: lines.join("\n"),
  }
}

function inferFilesystemVerificationTargets(
  originalRequest: string,
  mutationPaths: string[],
  workDir: string,
): FilesystemVerificationTarget[] {
  const targets = new Map<string, FilesystemVerificationTarget>()
  const requestForInference = originalRequest.trim()
  const normalizedMutationPaths = mutationPaths
    .map((item) => normalizeFilesystemPath(item, workDir))
    .filter((item): item is string => Boolean(item))

  const expectsDeletion = /(삭제|지워|remove|delete)/iu.test(requestForInference)
  for (const mutationPath of normalizedMutationPaths) {
    const normalized = mutationPath.replace(/\/$/, "")
    if (!normalized) continue
    const kind = inferFilesystemKindFromPath(normalized)
    targets.set(normalized, { path: normalized, kind, expect: expectsDeletion ? "missing" : "exists" })
    if (kind === "file") {
      const parent = resolve(normalized, "..")
      if (!targets.has(parent) && !expectsDeletion) {
        targets.set(parent, { path: parent, kind: "dir", expect: "exists" })
      }
    }
  }

  const baseDir = inferFilesystemBaseDir(requestForInference)
  const quotedNames = extractQuotedFilesystemNames(requestForInference)
  const mentionsFolder = /(폴더|디렉터리|folder|directory)/iu.test(requestForInference)
  const mentionsWebProgram = /(웹\s*(달력|계산기|페이지|프로그램)|html|css|js|javascript|web\s*(app|page)|calendar|calculator)/iu.test(requestForInference)

  if (baseDir && quotedNames.length > 0) {
    for (const name of quotedNames) {
      if (!name.includes("/")) {
        const dirPath = resolve(join(baseDir, name))
        if (mentionsFolder || mentionsWebProgram) {
          targets.set(dirPath, { path: dirPath, kind: "dir", expect: expectsDeletion ? "missing" : "exists" })
          if (mentionsWebProgram && !expectsDeletion) {
            const indexPath = join(dirPath, "index.html")
            targets.set(indexPath, { path: indexPath, kind: "file", expect: "exists" })
          }
        }
      }
      if (/\.[a-z0-9]+$/iu.test(name)) {
        const filePath = resolve(join(baseDir, name))
        targets.set(filePath, { path: filePath, kind: "file", expect: expectsDeletion ? "missing" : "exists" })
      }
    }
  }

  return [...targets.values()]
}

function extractQuotedFilesystemNames(value: string): string[] {
  const names = new Set<string>()

  for (const quote of ['"', "'"]) {
    let cursor = 0
    while (cursor < value.length) {
      const startIndex = value.indexOf(quote, cursor)
      if (startIndex < 0) break
      const endIndex = value.indexOf(quote, startIndex + 1)
      if (endIndex < 0) break

      const token = value.slice(startIndex + 1, endIndex).trim()
      if (token && isSafeFilesystemLiteral(token)) names.add(token)
      cursor = endIndex + 1
    }
  }

  return [...names]
}

function isSafeFilesystemLiteral(value: string): boolean {
  if (!value) return false

  for (const blockedCharacter of ["\r", "\n", "\t", "<", ">"] as const) {
    if (value.includes(blockedCharacter)) return false
  }

  const lowered = value.toLowerCase()
  const blockedPrefixes = [
    "context",
    "goal",
    "success criteria",
    "\uc6d0\ub798 \uc0ac\uc6a9\uc790 \uc694\uccad",
    "\ubb38\ub9e5",
    "\ubaa9\ud45c",
    "\uc81c\uc57d \uc0ac\ud56d",
  ]

  if (blockedPrefixes.some((prefix) => lowered.startsWith(prefix.toLowerCase()))) {
    return false
  }

  const wordCount = value.trim().split(" ").filter(Boolean).length
  if (wordCount > 6 && !value.includes("/") && !value.includes("\\")) {
    return false
  }

  return true
}

function inferFilesystemBaseDir(originalRequest: string): string | undefined {
  const lowered = originalRequest.toLowerCase()

  if (lowered.includes("downloads") || originalRequest.includes("\ub2e4\uc6b4\ub85c\ub4dc")) {
    return join(homedir(), "Downloads")
  }

  if (lowered.includes("desktop") || originalRequest.includes("\ubc14\ud0d5\ud654\uba74")) {
    return join(homedir(), "Desktop")
  }

  if (lowered.includes("documents") || originalRequest.includes("\ubb38\uc11c")) {
    return join(homedir(), "Documents")
  }

  return undefined
}

function safeStat(value: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(value)
  } catch {
    return undefined
  }
}

function safeReadSnippet(value: string): string | undefined {
  try {
    const raw = readFileSync(value, "utf-8").replace(/\s+/g, " ").trim()
    if (!raw) return undefined
    return raw.length > 120 ? `${raw.slice(0, 119)}...` : raw
  } catch {
    return undefined
  }
}
