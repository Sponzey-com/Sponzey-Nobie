import { getConfig } from "../config/index.js"

function normalize(value: string | undefined): string {
  return value?.trim() ?? ""
}

export function buildUserProfilePromptContext(): string {
  const profile = getConfig().profile
  const lines: string[] = []

  const displayName = normalize(profile.displayName)
  const profileName = normalize(profile.profileName)
  const language = normalize(profile.language)
  const timezone = normalize(profile.timezone)
  const workspace = normalize(profile.workspace)

  if (displayName) lines.push(`- 표시 이름: ${displayName}`)
  if (profileName) lines.push(`- 사용자 이름: ${profileName}`)
  if (language) lines.push(`- 기본 언어: ${language}`)
  if (timezone) lines.push(`- 기본 시간대: ${timezone}`)
  if (workspace) lines.push(`- 기본 작업 위치: ${workspace}`)

  if (lines.length === 0) return ""

  return [
    "[사용자 기본정보]",
    "다음 정보는 사용자가 설정 화면에서 입력한 기본 정보입니다.",
    "사용자가 새 지시로 덮어쓰지 않는 한 호칭, 기본 언어, 시간대, 작업 위치를 해석할 때 이 정보를 우선 참고하세요.",
    ...lines,
  ].join("\n")
}
