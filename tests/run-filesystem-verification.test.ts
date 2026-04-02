import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildFilesystemVerificationPrompt,
  verifyFilesystemTargets,
} from "../packages/core/src/runs/filesystem-verification.ts"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("filesystem verification helpers", () => {
  it("builds a prompt with the original request and mutation paths", () => {
    const prompt = buildFilesystemVerificationPrompt(
      "Downloads에 \"달력\" 폴더를 만들어줘",
      ["/tmp/work/Downloads/달력", "/tmp/work/Downloads/달력/index.html"],
    )

    expect(prompt).toContain("[Filesystem Verification]")
    expect(prompt).toContain("원래 사용자 요청: Downloads에 \"달력\" 폴더를 만들어줘")
    expect(prompt).toContain("- /tmp/work/Downloads/달력/index.html")
  })

  it("verifies created files and directories from explicit mutation paths", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-fs-verify-"))
    tempDirs.push(root)

    const folderPath = join(root, "output")
    const filePath = join(folderPath, "index.html")
    mkdirSync(folderPath, { recursive: true })
    writeFileSync(filePath, "<html>Hello</html>", "utf-8")

    const result = verifyFilesystemTargets({
      originalRequest: "\"output\" 폴더를 만들고 index.html 파일을 생성해줘",
      mutationPaths: [folderPath, filePath],
      workDir: root,
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain("실제 파일/폴더 생성 검증 완료")
    expect(result.message).toContain("폴더 확인")
    expect(result.message).toContain("읽기 확인")
  })

  it("reports missing evidence when inferred targets do not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-fs-verify-"))
    tempDirs.push(root)

    const result = verifyFilesystemTargets({
      originalRequest: "Downloads에 \"달력\" 폴더를 만들어줘",
      mutationPaths: [],
      workDir: root,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("실제 생성 증거가 충분하지 않습니다.")
    expect(result.remainingItems?.[0]).toContain("경로를 다시 확인")
  })
})
