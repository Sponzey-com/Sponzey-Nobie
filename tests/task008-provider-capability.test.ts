import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildProviderProfileId,
  clearProviderCapabilityCache,
  getProviderCapabilityMatrix,
} from "../packages/core/src/ai/capabilities.ts"
import { resolveProviderResolutionSnapshot, resetAIProviderCache } from "../packages/core/src/ai/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { discoverModelsFromEndpoint } from "../packages/core/src/control-plane/index.ts"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.ts"
import { buildAiRecoveryKey } from "../packages/core/src/runs/recovery.ts"
import { buildSetupDraft } from "../packages/core/src/control-plane/index.ts"
import { resolveRunRouteFromDraft } from "../packages/core/src/runs/routing.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousCodexHome = process.env["CODEX_HOME"]

afterEach(() => {
  vi.unstubAllGlobals()
  process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousCodexHome === undefined) delete process.env["CODEX_HOME"]
  else process.env["CODEX_HOME"] = previousCodexHome
  reloadConfig()
  resetAIProviderCache()
  clearProviderCapabilityCache()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function useTempState(configText: string): string {
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task008-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  writeFileSync(join(stateDir, "config.json5"), configText, "utf-8")
  reloadConfig()
  resetAIProviderCache()
  clearProviderCapabilityCache()
  return stateDir
}

function writeCodexAuth(stateDir: string): string {
  const codexHome = join(stateDir, "codex")
  mkdirSync(codexHome, { recursive: true })
  const authPath = join(codexHome, "auth.json")
  writeFileSync(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "header.payload.signature",
      refresh_token: "refresh-token",
    },
  }), "utf-8")
  process.env["CODEX_HOME"] = codexHome
  return authPath
}

describe("task008 provider capability matrix", () => {
  it("marks ChatGPT OAuth as chat-capable through responses while embeddings stay separate", () => {
    const stateDir = useTempState(`
      {
        ai: {
          connection: {
            provider: "openai",
            model: "gpt-5.4",
            endpoint: "https://chatgpt.com/backend-api/codex",
            auth: { mode: "chatgpt_oauth" }
          }
        }
      }
    `)
    const authPath = writeCodexAuth(stateDir)

    const matrix = getProviderCapabilityMatrix({
      connection: {
        provider: "openai",
        model: "gpt-5.4",
        endpoint: "https://chatgpt.com/backend-api/codex",
        auth: { mode: "chatgpt_oauth", oauthAuthFilePath: authPath },
      },
      memory: { sessionRetentionDays: 30 },
    })

    expect(matrix.adapterType).toBe("openai_codex_oauth")
    expect(matrix.responsesApi.status).toBe("supported")
    expect(matrix.chatCompletions.status).toBe("unsupported")
    expect(matrix.embeddings.status).toBe("warning")
    expect(matrix.modelListing.status).toBe("warning")
    expect(matrix.authRefresh.status).toBe("supported")
  })

  it("records Ollama as a local OpenAI-compatible chat provider with model listing", () => {
    const connection = {
      provider: "ollama" as const,
      model: "llama3.2",
      endpoint: "http://127.0.0.1:11434",
      auth: { mode: "api_key" as const },
    }
    const matrix = getProviderCapabilityMatrix({
      connection,
      memory: {
        sessionRetentionDays: 30,
        embedding: { provider: "ollama", model: "nomic-embed-text", baseUrl: "http://127.0.0.1:11434" },
      },
    })

    expect(matrix.profileId).toBe(buildProviderProfileId({
      connection,
      embedding: { provider: "ollama", model: "nomic-embed-text", baseUrl: "http://127.0.0.1:11434" },
    }))
    expect(matrix.adapterType).toBe("openai_compatible")
    expect(matrix.baseUrlClass).toBe("local")
    expect(matrix.modelListing.status).toBe("supported")
    expect(matrix.embeddings.status).toBe("supported")
  })

  it("does not block an OpenAI-compatible endpoint only because model listing is unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })))

    const result = await discoverModelsFromEndpoint("http://127.0.0.1:8080/v1", "custom", {}, "api_key")

    expect(result.models).toEqual([])
    expect(result.capabilityMatrix.lastCheckResult.status).toBe("warning")
    expect(result.capabilityMatrix.modelListing.status).toBe("warning")
    expect(result.sourceUrl).toContain("/v1/models")
  })

  it("adds resolver evidence to runtime route traces and doctor output", () => {
    useTempState(`
      {
        ai: {
          connection: {
            provider: "ollama",
            model: "llama3.2",
            endpoint: "http://127.0.0.1:11434"
          }
        }
      }
    `)

    const draft = buildSetupDraft()
    const route = resolveRunRouteFromDraft(draft, {})
    const snapshot = resolveProviderResolutionSnapshot()
    const doctor = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const resolverCheck = doctor.checks.find((check) => check.name === "provider.resolver")

    expect(route.providerTrace).toMatchObject({
      profileId: expect.any(String),
      resolverPath: "ai.connection.ollama",
      credentialSourceKind: "local_endpoint",
      endpointMismatch: false,
    })
    expect(snapshot.providerId).toBe("ollama")
    expect(resolverCheck?.status).toBe("ok")
    expect(resolverCheck?.detail.profileId).toBe(route.providerTrace?.profileId)
  })

  it("keeps OAuth and API key provider failures on different recovery keys", () => {
    const base = {
      targetId: "provider:openai",
      workerRuntimeKind: undefined,
      providerId: "openai",
      model: "gpt-5.4",
      reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
    }
    const oauthKey = buildAiRecoveryKey({
      ...base,
      message: "ChatGPT OAuth refresh token이 없습니다. codex login을 다시 실행해 주세요.",
    })
    const apiKey = buildAiRecoveryKey({
      ...base,
      message: "No available OpenAI API keys (all on cooldown)",
    })

    expect(oauthKey).toContain("auth=chatgpt-oauth")
    expect(apiKey).toContain("auth=api-key")
    expect(oauthKey).not.toBe(apiKey)
  })
})
