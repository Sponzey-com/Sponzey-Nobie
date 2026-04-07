import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { detectAvailableProvider, getDefaultModel, getProvider } from "../packages/core/src/ai/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousAnthropicApiKey = process.env["ANTHROPIC_API_KEY"]
const previousOpenAIKey = process.env["OPENAI_API_KEY"]
const previousGeminiKey = process.env["GEMINI_API_KEY"]
const previousCodexHome = process.env["CODEX_HOME"]

afterEach(() => {
  process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousAnthropicApiKey === undefined) delete process.env["ANTHROPIC_API_KEY"]
  else process.env["ANTHROPIC_API_KEY"] = previousAnthropicApiKey
  if (previousOpenAIKey === undefined) delete process.env["OPENAI_API_KEY"]
  else process.env["OPENAI_API_KEY"] = previousOpenAIKey
  if (previousGeminiKey === undefined) delete process.env["GEMINI_API_KEY"]
  else process.env["GEMINI_API_KEY"] = previousGeminiKey
  if (previousCodexHome === undefined) delete process.env["CODEX_HOME"]
  else process.env["CODEX_HOME"] = previousCodexHome
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("ai provider configuration", () => {
  it("does not auto-select an unconfigured external AI backend", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    process.env["ANTHROPIC_API_KEY"] = ""
    process.env["OPENAI_API_KEY"] = ""
    process.env["GEMINI_API_KEY"] = ""
    process.env["CODEX_HOME"] = stateDir
    reloadConfig()

    expect(detectAvailableProvider()).toBe("")
    expect(getDefaultModel()).toBe("")
    expect(() => getProvider()).toThrow("No configured AI backend is available")
  })

  it("does not read removed legacy llm provider settings", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        llm: {
          defaultProvider: "openai",
          defaultModel: "gpt-5",
          providers: {
            openai: {
              apiKeys: ["sk-test"]
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    expect(detectAvailableProvider()).toBe("")
    expect(getDefaultModel()).toBe("")
    expect(() => getProvider()).toThrow("No configured AI backend is available")
  })

  it("derives a single ai connection from legacy builtin backend cards", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        ai: {
          backends: {
            openai: {
              enabled: true,
              providerType: "openai",
              authMode: "api_key",
              credentials: {
                apiKey: "sk-backend"
              },
              defaultModel: "gpt-4.1"
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    expect(detectAvailableProvider()).toBe("openai")
    expect(getDefaultModel()).toBe("gpt-4.1")
    expect(() => getProvider()).not.toThrow()
  })

  it("extracts only one active ai connection from legacy multi-backend config", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        ai: {
          backends: {
            openai: {
              enabled: true,
              providerType: "openai",
              authMode: "api_key",
              credentials: {
                apiKey: "sk-openai"
              },
              defaultModel: "gpt-5"
            },
            gemini: {
              enabled: true,
              providerType: "gemini",
              credentials: {
                apiKey: "gm-test"
              },
              defaultModel: "gemini-2.5-pro"
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    expect(detectAvailableProvider()).toBe("openai")
    expect(getDefaultModel()).toBe("gpt-5")
    expect(() => getProvider()).not.toThrow()
  })

  it("does not invent a fallback model when the configured single ai connection has no model", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        ai: {
          connection: {
            provider: "openai",
            model: "",
            auth: {
              apiKey: "sk-test"
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    expect(detectAvailableProvider()).toBe("openai")
    expect(getDefaultModel()).toBe("")
  })

  it("allows an ollama connection without requiring an OpenAI API key", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        ai: {
          connection: {
            provider: "ollama",
            model: "gemma4:26b",
            endpoint: "http://127.0.0.1:11434",
            auth: {
              mode: "api_key"
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    expect(detectAvailableProvider()).toBe("ollama")
    expect(getDefaultModel()).toBe("gemma4:26b")
    expect(() => getProvider()).not.toThrow()
  })

  it("normalizes an ollama endpoint to /v1 for OpenAI-compatible requests", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-ai-config-"))
    tempDirs.push(stateDir)
    process.env["NOBIE_STATE_DIR"] = stateDir
    writeFileSync(join(stateDir, "config.json5"), `
      {
        ai: {
          connection: {
            provider: "ollama",
            model: "gemma4:26b",
            endpoint: "http://127.0.0.1:11434",
            auth: {
              mode: "api_key"
            }
          }
        }
      }
    `, "utf-8")

    reloadConfig()

    const provider = getProvider() as { baseUrl?: string }
    expect(provider.baseUrl).toBe("http://127.0.0.1:11434/v1")
  })
})
