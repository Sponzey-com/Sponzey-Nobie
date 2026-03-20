import { describe, expect, it } from "vitest"
import type { SetupDraft } from "../packages/core/src/control-plane/index.ts"
import { resolveRunRouteFromDraft } from "../packages/core/src/runs/routing.ts"

function createDraft(): SetupDraft {
  return {
    aiBackends: [
      {
        id: "provider:openai",
        label: "범용 원격 추론",
        kind: "provider",
        providerType: "openai",
        credentials: { apiKey: "sk-openai" },
        local: false,
        enabled: true,
        availableModels: [],
        defaultModel: "gpt-4o-mini",
        status: "ready",
        summary: "",
        tags: ["general"],
        endpoint: "https://api.openai.com/v1",
      },
      {
        id: "provider:ollama",
        label: "로컬 모델 우선",
        kind: "provider",
        providerType: "ollama",
        credentials: {},
        local: true,
        enabled: true,
        availableModels: [],
        defaultModel: "llama3.1:8b",
        status: "ready",
        summary: "",
        tags: ["local"],
        endpoint: "http://127.0.0.1:11434/v1",
      },
      {
        id: "worker:claude_code",
        label: "코드 작업 세션",
        kind: "worker",
        providerType: "claude",
        credentials: { apiKey: "sk-ant-test" },
        local: false,
        enabled: true,
        availableModels: [],
        defaultModel: "claude-3-5-haiku-20241022",
        status: "ready",
        summary: "",
        tags: ["coding"],
      },
      {
        id: "provider:gemini",
        label: "계획·리서치 특화",
        kind: "provider",
        providerType: "gemini",
        credentials: { apiKey: "gemini-key" },
        local: false,
        enabled: true,
        availableModels: [],
        defaultModel: "gemini-2.5-pro",
        status: "ready",
        summary: "",
        tags: ["planning"],
        endpoint: "https://generativelanguage.googleapis.com",
      },
    ],
    routingProfiles: [
      { id: "default", label: "기본", targets: ["provider:openai"] },
      { id: "general_chat", label: "일반 대화", targets: ["provider:openai"] },
      { id: "planning", label: "계획/설계", targets: ["provider:gemini", "provider:openai"] },
      { id: "coding", label: "코딩", targets: ["worker:claude_code", "provider:openai"] },
      { id: "review", label: "리뷰", targets: ["worker:claude_code", "provider:openai"] },
      { id: "research", label: "리서치", targets: ["provider:gemini", "provider:openai"] },
      { id: "private_local", label: "로컬 우선", targets: ["provider:ollama", "provider:openai"] },
      { id: "summarization", label: "요약", targets: ["provider:ollama", "provider:openai"] },
      { id: "operations", label: "운영", targets: ["worker:claude_code", "provider:openai"] },
    ],
    security: {
      approvalMode: "on-miss",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny",
    },
    channels: {
      telegramEnabled: false,
      botToken: "",
      allowedUserIds: "",
      allowedGroupIds: "",
    },
    remoteAccess: {
      authEnabled: false,
      authToken: "",
      host: "127.0.0.1",
      port: 18888,
    },
  }
}

describe("resolveRunRouteFromDraft", () => {
  it("prefers coding worker runtime for coding tasks when available", () => {
    const route = resolveRunRouteFromDraft(
      createDraft(),
      { taskProfile: "coding" },
      { workerAvailability: { claude_code: true } },
    )

    expect(route.targetId).toBe("worker:claude_code")
    expect(route.workerRuntime?.kind).toBe("claude_code")
    expect(route.providerId).toBe("anthropic")
    expect(route.model).toBe("claude-3-5-haiku-20241022")
  })

  it("falls back to provider execution when worker runtime is unavailable", () => {
    const route = resolveRunRouteFromDraft(
      createDraft(),
      { taskProfile: "coding" },
      { workerAvailability: { claude_code: false } },
    )

    expect(route.targetId).toBe("worker:claude_code")
    expect(route.workerRuntime).toBeUndefined()
    expect(route.providerId).toBe("anthropic")
    expect(route.model).toBe("claude-3-5-haiku-20241022")
  })

  it("prefers local ollama route for private_local tasks", () => {
    const route = resolveRunRouteFromDraft(createDraft(), { taskProfile: "private_local" })

    expect(route.targetId).toBe("provider:ollama")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("llama3.1:8b")
  })

  it("uses preferred target when provided", () => {
    const route = resolveRunRouteFromDraft(createDraft(), {
      preferredTarget: "provider:openai",
      taskProfile: "coding",
    })

    expect(route.targetId).toBe("provider:openai")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })

  it("falls back past unsupported gemini target to an executable backend", () => {
    const route = resolveRunRouteFromDraft(createDraft(), { taskProfile: "planning" })

    expect(route.targetId).toBe("provider:openai")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })
})
