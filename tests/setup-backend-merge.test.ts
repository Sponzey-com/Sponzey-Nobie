import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildSetupDraft, saveSetupDraft } from "../packages/core/src/control-plane/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"

function parseJsonLike(text: string): Record<string, any> {
  return Function(`"use strict"; return (${text});`)() as Record<string, any>
}

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
  it("does not enable anthropic provider only from the default anthropic model", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-setup-backend-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    reloadConfig()

    const draft = buildSetupDraft()
    const anthropicProvider = draft.aiBackends.find((backend) => backend.id === "provider:anthropic")

    expect(anthropicProvider?.defaultModel).toBe("")
    expect(anthropicProvider?.enabled).toBe(false)
    expect(anthropicProvider?.status).toBe("planned")
  })

  it("keeps builtin backend identity while clearing stale endpoint and credentials", () => {
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

    expect(changed?.providerType).toBe("openai")
    expect(changed?.endpoint).toBeUndefined()
    expect(changed?.credentials).toEqual({ apiKey: "", oauthAuthFilePath: "" })
    expect(changed?.defaultModel).toBe("")
  })

  it("rejects drafts that enable more than one active ai connection", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-setup-backend-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    reloadConfig()

    const draft = buildSetupDraft()

    expect(() => saveSetupDraft({
      ...draft,
      aiBackends: draft.aiBackends.map((backend) => (
        backend.id === "provider:openai" || backend.id === "provider:gemini"
          ? {
              ...backend,
              enabled: true,
              defaultModel: backend.id === "provider:openai" ? "gpt-5" : "gemini-2.5-pro",
              credentials: backend.id === "provider:openai"
                ? { apiKey: "sk-test", oauthAuthFilePath: "" }
                : { apiKey: "gemini-key" },
            }
          : backend
      )),
    })).toThrow("Only one active AI connection can be enabled.")
  })

  it("persists the active ai connection and drops legacy multi-provider config", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-setup-backend-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    reloadConfig()

    const draft = buildSetupDraft()
    saveSetupDraft({
      ...draft,
      aiBackends: draft.aiBackends.map((backend) => (
        backend.id === "provider:openai"
          ? {
            ...backend,
            enabled: true,
            authMode: "chatgpt_oauth",
            endpoint: "https://chatgpt.com/backend-api/codex",
            defaultModel: "gpt-5",
          }
          : backend
      )),
    })

    const raw = parseJsonLike(readFileSync(join(stateDir, "config.json5"), "utf-8"))

    expect(raw.ai?.connection?.provider).toBe("openai")
    expect(raw.ai?.connection?.model).toBe("gpt-5")
    expect(raw.ai?.connection?.endpoint).toBe("https://chatgpt.com/backend-api/codex")
    expect(raw.ai?.connection?.auth?.mode).toBe("chatgpt_oauth")
    expect(raw.ai?.providers).toBeUndefined()
    expect(raw.llm).toBeUndefined()
  })

  it("rebuilds builtin cards from the active single ai connection", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-setup-backend-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    reloadConfig()

    const draft = buildSetupDraft()
    saveSetupDraft({
      ...draft,
      aiBackends: draft.aiBackends.map((backend) => (
        backend.id === "provider:openai"
          ? {
            ...backend,
            enabled: true,
            authMode: "chatgpt_oauth",
            endpoint: "https://chatgpt.com/backend-api/codex",
            defaultModel: "gpt-5",
          }
          : backend
      )),
    })

    const raw = parseJsonLike(readFileSync(join(stateDir, "config.json5"), "utf-8"))
    raw.ai.connection = {
      provider: "gemini",
      model: "gemini-2.5-pro",
      endpoint: "https://generativelanguage.googleapis.com",
      auth: { apiKey: "gemini-key" },
    }
    writeFileSync(join(stateDir, "config.json5"), JSON.stringify(raw, null, 2), "utf-8")

    reloadConfig()

    const nextDraft = buildSetupDraft()
    const gemini = nextDraft.aiBackends.find((backend) => backend.id === "provider:gemini")
    const openai = nextDraft.aiBackends.find((backend) => backend.id === "provider:openai")

    expect(gemini?.providerType).toBe("gemini")
    expect(gemini?.enabled).toBe(true)
    expect(gemini?.defaultModel).toBe("gemini-2.5-pro")
    expect(openai?.enabled).toBe(false)
  })
})
