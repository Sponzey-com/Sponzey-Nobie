import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"

const MAX_NOBIE_MD_SIZE = 8000
const MEMORY_FILENAMES = ["NOBIE.md", "WIZBY.md", "HOWIE.md"] as const

/**
 * Walk up from workDir (up to 3 parent levels) searching for NOBIE.md first,
 * then legacy WIZBY.md / HOWIE.md.
 * Returns the file contents (trimmed to 8KB) or null if not found.
 */
export function loadNobieMd(workDir: string): string | null {
  let current = workDir
  for (let i = 0; i < 4; i++) {
    for (const filename of MEMORY_FILENAMES) {
      const candidate = join(current, filename)
      if (existsSync(candidate)) {
        try {
          return readFileSync(candidate, "utf-8").slice(0, MAX_NOBIE_MD_SIZE)
        } catch {
          return null
        }
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

const TEMPLATE = `# 프로젝트 메모리

## 기술 스택
- (사용하는 언어, 프레임워크, 런타임 등을 기술)

## 코드 규칙
- (코딩 컨벤션, 포맷터, 린터 설정 등)

## 중요 경로
- (설정 파일, DB, 로그 등 주요 경로)

## 금지사항
- (절대로 하면 안 되는 작업)

## 기타 메모
- (에이전트가 알아야 할 기타 사항)
`

/** Write a NOBIE.md template to the given directory. */
export function initNobieMd(dir: string): string {
  const target = join(dir, "NOBIE.md")
  if (!existsSync(target)) {
    writeFileSync(target, TEMPLATE, "utf-8")
  }
  return target
}

export const loadWizbyMd = loadNobieMd
export const initWizbyMd = initNobieMd
export const loadHowieMd = loadNobieMd
export const initHowieMd = initNobieMd
