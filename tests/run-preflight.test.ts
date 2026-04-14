import { beforeEach, describe, expect, it, vi } from "vitest"

const detectAvailableProviderMock = vi.fn(() => "openai")
const getDefaultModelMock = vi.fn(() => "gpt-5")
const getSlackRuntimeStatusMock = vi.fn(() => ({
  isRunning: true,
  lastStartedAt: 1,
  lastStoppedAt: null,
  lastError: null,
  lastErrorAt: null,
}))
const getTelegramRuntimeStatusMock = vi.fn(() => ({
  isRunning: true,
  lastStartedAt: 1,
  lastStoppedAt: null,
  lastError: null,
  lastErrorAt: null,
}))
const getMqttExtensionSnapshotsMock = vi.fn(() => [])

vi.mock("../packages/core/src/ai/index.js", () => ({
  detectAvailableProvider: (...args: unknown[]) => detectAvailableProviderMock(...args),
  getDefaultModel: (...args: unknown[]) => getDefaultModelMock(...args),
}))

vi.mock("../packages/core/src/channels/slack/runtime.js", () => ({
  getSlackRuntimeStatus: (...args: unknown[]) => getSlackRuntimeStatusMock(...args),
}))

vi.mock("../packages/core/src/channels/telegram/runtime.js", () => ({
  getTelegramRuntimeStatus: (...args: unknown[]) => getTelegramRuntimeStatusMock(...args),
}))

vi.mock("../packages/core/src/mqtt/broker.js", () => ({
  getMqttExtensionSnapshots: (...args: unknown[]) => getMqttExtensionSnapshotsMock(...args),
}))

const { resolveStartContextPlan, resolveStartPreflightFailure } = await import("../packages/core/src/runs/preflight.ts")

describe("start preflight", () => {
  beforeEach(() => {
    detectAvailableProviderMock.mockReset().mockReturnValue("openai")
    getDefaultModelMock.mockReset().mockReturnValue("gpt-5")
    getSlackRuntimeStatusMock.mockReset().mockReturnValue({
      isRunning: true,
      lastStartedAt: 1,
      lastStoppedAt: null,
      lastError: null,
      lastErrorAt: null,
    })
    getTelegramRuntimeStatusMock.mockReset().mockReturnValue({
      isRunning: true,
      lastStartedAt: 1,
      lastStoppedAt: null,
      lastError: null,
      lastErrorAt: null,
    })
    getMqttExtensionSnapshotsMock.mockReset().mockReturnValue([])
  })

  it("fails before execution when no AI connection is configured", () => {
    detectAvailableProviderMock.mockReturnValue("")

    expect(resolveStartPreflightFailure({
      source: "webui",
      message: "hello",
    })?.code).toBe("ai_connection_unavailable")
  })

  it("fails before execution when no default model is configured", () => {
    getDefaultModelMock.mockReturnValue("")

    expect(resolveStartPreflightFailure({
      source: "webui",
      message: "hello",
      providerId: "openai",
    })?.code).toBe("ai_model_unavailable")
  })

  it("fails Slack ingress before execution when the runtime is not running", () => {
    getSlackRuntimeStatusMock.mockReturnValue({
      isRunning: false,
      lastStartedAt: 1,
      lastStoppedAt: 2,
      lastError: "socket closed",
      lastErrorAt: 2,
    })

    const failure = resolveStartPreflightFailure({
      source: "slack",
      message: "hello",
      providerId: "openai",
      model: "gpt-5",
      onChunk: vi.fn(),
    })

    expect(failure?.code).toBe("channel_unavailable")
    expect(failure?.userMessage).toContain("socket closed")
  })

  it("fails Yeonjang-bound requests when no extension snapshot is connected", () => {
    const failure = resolveStartPreflightFailure({
      source: "webui",
      message: "메인 화면 캡쳐",
      providerId: "openai",
      model: "gpt-5",
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "direct",
        approvalRequired: false,
        approvalTool: "screen_capture",
      },
    })

    expect(failure?.code).toBe("yeonjang_unavailable")
  })

  it("allows Yeonjang-bound requests to reach request-time method refresh when a snapshot is connected", () => {
    getMqttExtensionSnapshotsMock.mockReturnValueOnce([{
      extensionId: "yeonjang-main",
      clientId: "client-1",
      displayName: "Yeonjang",
      state: "connected",
      message: null,
      version: "0.1.0",
      methods: ["screen.capture"],
      lastSeenAt: 1,
    }])

    expect(resolveStartPreflightFailure({
      source: "webui",
      message: "메인 화면 캡쳐",
      providerId: "openai",
      model: "gpt-5",
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "direct",
        approvalRequired: false,
        approvalTool: "screen_capture",
      },
    })).toBeNull()
  })

  it("builds a context plan before memory retrieval and execution", () => {
    getMqttExtensionSnapshotsMock.mockReturnValueOnce([{
      extensionId: "yeonjang-main",
      clientId: "client-1",
      displayName: "Yeonjang",
      state: "connected",
      message: null,
      version: "0.1.0",
      methods: ["screen.capture"],
      lastSeenAt: 1,
    }])

    const plan = resolveStartContextPlan({
      source: "slack",
      message: "메인 화면 캡쳐해서 보여줘",
      providerId: "openai",
      model: "gpt-5",
      onChunk: vi.fn(),
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "direct",
        approvalRequired: true,
        approvalTool: "screen_capture",
      },
    })

    expect(plan.preflightFailure).toBeNull()
    expect(plan.promptSources).toContain("channel:slack")
    expect(plan.memoryScopes).toEqual(["short-term", "flash-feedback", "task", "artifact", "long-term"])
    expect(plan.toolPolicy).toEqual({
      toolsEnabled: true,
      requiresApproval: true,
      requiresYeonjang: true,
    })
    expect(plan.retrieval.vectorOptional).toBe(true)
  })
})
