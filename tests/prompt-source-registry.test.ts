import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chdir, cwd } from "node:process"
import { afterEach, describe, expect, it } from "vitest"
import { bootstrap } from "../packages/core/src/index.ts"
import {
  detectPromptSourceSecretMarkers,
  ensurePromptSourceFiles,
  loadFirstRunPromptSourceAssembly,
  loadPromptSourceRegistry,
  loadSystemPromptSourceAssembly,
} from "../packages/core/src/memory/nobie-md.ts"
import { closeDb, getDb, getPromptSourceStates } from "../packages/core/src/db/index.ts"
import { sanitizeUserFacingError } from "../packages/core/src/runs/error-sanitizer.js"

const tempDirs: string[] = []
const originalCwd = cwd()
const originalStateDir = process.env["NOBIE_STATE_DIR"]

function createPromptFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-prompt-sources-"))
  tempDirs.push(root)
  const promptsDir = join(root, "prompts")
  mkdirSync(promptsDir)
  for (const filename of [
    "definitions.md",
    "identity.md",
    "user.md",
    "soul.md",
    "planner.md",
    "memory_policy.md",
    "tool_policy.md",
    "web_retrieval_planner.md",
    "recovery_policy.md",
    "completion_policy.md",
    "output_policy.md",
    "channel.md",
    "bootstrap.md",
  ]) {
    writeFileSync(join(promptsDir, filename), `# ${filename}\n\n${filename} content`, "utf-8")
  }
  return root
}

afterEach(() => {
  closeDb()
  chdir(originalCwd)
  if (originalStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = originalStateDir
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("prompt source registry", () => {
  it("loads prompt sources and excludes only bootstrap from default runtime assembly", () => {
    const root = createPromptFixture()

    const registry = loadPromptSourceRegistry(root)
    expect(registry.map((source) => source.sourceId)).toEqual([
      "definitions",
      "identity",
      "user",
      "soul",
      "planner",
      "memory_policy",
      "tool_policy",
      "web_retrieval_planner",
      "recovery_policy",
      "completion_policy",
      "output_policy",
      "channel",
      "bootstrap",
    ])

    const assembly = loadSystemPromptSourceAssembly(root)
    expect(assembly?.snapshot.sources.map((source) => source.sourceId)).toEqual([
      "definitions",
      "identity",
      "user",
      "soul",
      "planner",
      "memory_policy",
      "tool_policy",
      "recovery_policy",
      "completion_policy",
      "output_policy",
      "channel",
    ])
    expect(assembly?.snapshot.diagnostics).toEqual([])
    expect(assembly?.text).toContain("definitions.md content")
    expect(assembly?.text).toContain("identity.md content")
    expect(assembly?.text).toContain("soul.md content")
    expect(assembly?.text).toContain("planner.md content")
    expect(assembly?.text).toContain("output_policy.md content")
    expect(assembly?.text).not.toContain("bootstrap.md content")
    expect(assembly?.snapshot.sources.every((source) => source.checksum.length === 64)).toBe(true)
  })

  it("keeps required runtime sources in the assembly even when a stored state is disabled", () => {
    const root = createPromptFixture()

    const assembly = loadSystemPromptSourceAssembly(root, "ko", [
      { sourceId: "identity", locale: "ko", enabled: false },
    ])
    const identity = assembly?.snapshot.sources.find((source) => source.sourceId === "identity")

    expect(identity).toBeTruthy()
    expect(identity?.enabled).toBe(false)
  })

  it("excludes disabled optional runtime sources from the assembly", () => {
    const root = createPromptFixture()

    const assembly = loadSystemPromptSourceAssembly(root, "ko", [
      { sourceId: "output_policy", locale: "ko", enabled: false },
    ])

    expect(assembly?.snapshot.sources.map((source) => source.sourceId)).not.toContain("output_policy")
    expect(assembly?.text).not.toContain("output_policy.md content")
  })

  it("records a diagnostic when a required runtime source is missing", () => {
    const root = createPromptFixture()
    rmSync(join(root, "prompts", "definitions.md"), { force: true })

    const assembly = loadSystemPromptSourceAssembly(root)

    expect(assembly?.snapshot.sources.map((source) => source.sourceId)).not.toContain("definitions")
    expect(assembly?.snapshot.diagnostics).toContainEqual({
      severity: "error",
      code: "required_prompt_source_missing",
      sourceId: "definitions",
      locale: "ko",
      message: "Required prompt source 'definitions' is missing for runtime assembly.",
    })
  })

  it("reuses cached runtime prompt assembly when source checksums and states do not change", () => {
    const root = createPromptFixture()

    const first = loadSystemPromptSourceAssembly(root)
    const second = loadSystemPromptSourceAssembly(root)

    expect(second).toBe(first)
  })

  it("seeds missing prompt sources idempotently without overwriting user edits", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-prompt-seed-"))
    tempDirs.push(root)

    const first = ensurePromptSourceFiles(root)
    expect(first.created).toContain("definitions.md")
    expect(first.created).toContain("identity.md")
    expect(first.created).toContain("user.md")
    expect(first.created).toContain("planner.md")
    expect(first.created).toContain("memory_policy.md")
    expect(first.created).toContain("tool_policy.md")
    expect(first.created).toContain("web_retrieval_planner.md")
    expect(first.created).toContain("recovery_policy.md")
    expect(first.created).toContain("completion_policy.md")
    expect(first.created).toContain("output_policy.md")
    expect(first.created).toContain("channel.md")
    expect(first.created).toContain("bootstrap.md")
    expect(existsSync(join(first.promptsDir, "user.md.en"))).toBe(true)
    expect(existsSync(join(first.promptsDir, "web_retrieval_planner.md.en"))).toBe(true)
    expect(existsSync(join(first.promptsDir, "output_policy.md.en"))).toBe(true)

    const userPromptPath = join(first.promptsDir, "user.md")
    writeFileSync(userPromptPath, "# 사용자\n\n- 선호 이름: custom-user-edit\n", "utf-8")

    const second = ensurePromptSourceFiles(root)
    expect(second.created).toEqual([])
    expect(readFileSync(userPromptPath, "utf-8")).toContain("custom-user-edit")
  })

  it("keeps first-run bootstrap isolated from normal runtime assembly", () => {
    const root = createPromptFixture()

    const runtime = loadSystemPromptSourceAssembly(root)
    const firstRun = loadFirstRunPromptSourceAssembly(root)

    expect(runtime?.snapshot.sources.map((source) => source.sourceId)).not.toContain("bootstrap")
    expect(firstRun?.snapshot.sources.map((source) => source.sourceId)).toEqual(["bootstrap"])
    expect(firstRun?.snapshot.diagnostics).toEqual([])
    expect(firstRun?.text).toContain("bootstrap.md content")
  })

  it("detects secret-like prompt source content and excludes it from the registry", () => {
    const root = createPromptFixture()
    const unsafe = "# identity\n\napi_key = sk-abcdefghijklmnopqrstuvwxyz123456"
    writeFileSync(join(root, "prompts", "identity.md"), unsafe, "utf-8")

    expect(detectPromptSourceSecretMarkers(unsafe)).toContain("api_key_assignment")
    expect(loadPromptSourceRegistry(root).some((source) => source.sourceId === "identity" && source.locale === "ko")).toBe(false)
  })

  it("bootstraps prompt source metadata into an empty DB without duplicate rows", () => {
    closeDb()
    const root = mkdtempSync(join(tmpdir(), "nobie-prompt-bootstrap-"))
    tempDirs.push(root)
    process.env["NOBIE_STATE_DIR"] = join(root, "state")
    chdir(root)

    bootstrap()
    const firstCount = (getDb().prepare("SELECT COUNT(*) AS count FROM prompt_sources").get() as { count: number }).count
    expect(firstCount).toBe(26)
    expect(getPromptSourceStates().some((source) => source.sourceId === "bootstrap" && source.locale === "ko")).toBe(true)

    bootstrap()
    const secondCount = (getDb().prepare("SELECT COUNT(*) AS count FROM prompt_sources").get() as { count: number }).count
    expect(secondCount).toBe(firstCount)
  })

  it("sanitizes provider HTML errors for user-facing output", () => {
    const sanitized = sanitizeUserFacingError("<!doctype html><html><title>403 Forbidden</title><body>Cloudflare challenge</body></html>")
    expect(sanitized.kind).toBe("access_blocked")
    expect(sanitized.userMessage).toBe("인증 또는 접근 차단 문제로 서버가 HTML 오류 페이지를 반환했습니다.")
    expect(sanitized.userMessage).not.toContain("<html")
  })
})
