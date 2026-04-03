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
        id: "provider:anthropic",
        label: "Anthropic 추론",
        kind: "provider",
        providerType: "anthropic",
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
      { id: "coding", label: "코딩", targets: ["provider:anthropic", "provider:openai"] },
      { id: "review", label: "리뷰", targets: ["provider:anthropic", "provider:openai"] },
      { id: "research", label: "리서치", targets: ["provider:gemini", "provider:openai"] },
      { id: "private_local", label: "로컬 우선", targets: ["provider:ollama", "provider:openai"] },
      { id: "summarization", label: "요약", targets: ["provider:ollama", "provider:openai"] },
      { id: "operations", label: "운영", targets: ["provider:anthropic", "provider:openai"] },
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
  it("uses the configured default routing target even for coding tasks", () => {
    const route = resolveRunRouteFromDraft(
      createDraft(),
      { taskProfile: "coding" },
    )

    expect(route.targetId).toBe("provider:openai")
    expect(route.workerRuntime).toBeUndefined()
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })

  it("returns no configured backend when the configured default target is unavailable", () => {
    const draft = createDraft()
    draft.aiBackends = draft.aiBackends.map((backend) => (
      backend.id === "provider:openai"
        ? { ...backend, enabled: false, credentials: {}, defaultModel: "" }
        : backend
    ))

    const route = resolveRunRouteFromDraft(
      draft,
      { taskProfile: "coding" },
    )

    expect(route.targetId).toBeUndefined()
    expect(route.workerRuntime).toBeUndefined()
    expect(route.providerId).toBeUndefined()
    expect(route.reason).toBe("routing:no-configured-ai-backend")
  })

  it("does not invent a fallback model for the selected backend", () => {
    const draft = createDraft()
    draft.aiBackends = draft.aiBackends.map((backend) => (
      backend.id === "provider:openai"
        ? { ...backend, defaultModel: "" }
        : backend
    ))

    const route = resolveRunRouteFromDraft(draft, { taskProfile: "general_chat" })

    expect(route.targetId).toBeUndefined()
    expect(route.providerId).toBeUndefined()
    expect(route.model).toBeUndefined()
    expect(route.reason).toBe("routing:no-configured-ai-backend")
  })

  it("does not switch to another backend only because the task profile changed", () => {
    const route = resolveRunRouteFromDraft(createDraft(), { taskProfile: "private_local" })

    expect(route.targetId).toBe("provider:openai")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })

  it("keeps the configured default target even when another preferred target is requested", () => {
    const route = resolveRunRouteFromDraft(createDraft(), {
      preferredTarget: "provider:anthropic",
      taskProfile: "coding",
    })

    expect(route.targetId).toBe("provider:openai")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })

  it("uses the default target for planning tasks instead of profile-specific alternatives", () => {
    const route = resolveRunRouteFromDraft(createDraft(), { taskProfile: "planning" })

    expect(route.targetId).toBe("provider:openai")
    expect(route.providerId).toBe("openai")
    expect(route.model).toBe("gpt-4o-mini")
  })

  it("does not fall back to an unconfigured anthropic backend", () => {
    const draft = createDraft()
    draft.aiBackends = draft.aiBackends.map((backend) => ({
      ...backend,
      enabled: false,
      credentials: {},
      ...(backend.providerType === "openai" || backend.providerType === "gemini" || backend.providerType === "ollama"
        ? { defaultModel: "", endpoint: undefined }
        : { defaultModel: backend.defaultModel }),
    }))

    const route = resolveRunRouteFromDraft(
      draft,
      { taskProfile: "coding" },
    )

    expect(route.targetId).toBeUndefined()
    expect(route.workerRuntime).toBeUndefined()
    expect(route.providerId).toBeUndefined()
  })
})
