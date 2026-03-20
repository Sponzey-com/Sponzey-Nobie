import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { buildSetupDraft, saveSetupDraft } from "../packages/core/src/control-plane/index.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]

afterEach(() => {
  process.env["NOBIE_STATE_DIR"] = previousStateDir
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("setup backend merge", () => {
  it("clears stale endpoint and credentials when a builtin backend changes provider type", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-setup-backend-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    reloadConfig()

    const initialDraft = buildSetupDraft()
    saveSetupDraft({
      ...initialDraft,
      aiBackends: initialDraft.aiBackends.map((backend) => (
        backend.id === "provider:openai"
          ? {
            ...backend,
            providerType: "openai",
            endpoint: "https://api.openai.com/v1",
            credentials: { apiKey: "sk-test" },
            defaultModel: "gpt-4.1",
            enabled: true,
          }
          : backend
      )),
    })

    const configuredDraft = buildSetupDraft()
    saveSetupDraft({
      ...configuredDraft,
      aiBackends: configuredDraft.aiBackends.map((backend) => (
        backend.id === "provider:openai"
          ? {
            ...backend,
            providerType: "gemini",
            endpoint: "",
            credentials: {},
            availableModels: [],
            defaultModel: "",
            enabled: false,
          }
          : backend
      )),
    })

    const nextDraft = buildSetupDraft()
    const changed = nextDraft.aiBackends.find((backend) => backend.id === "provider:openai")

    expect(changed?.providerType).toBe("gemini")
    expect(changed?.endpoint).toBeUndefined()
    expect(changed?.credentials).toEqual({})
    expect(changed?.defaultModel).toBe("")
  })
})
