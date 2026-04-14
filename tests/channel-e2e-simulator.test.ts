import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWebUiChunkDeliveryHandler } from "../packages/core/src/api/ws/chunk-delivery.ts"
import {
  registerApprovalFromWs,
  resetWebUiApprovalStateForTest,
  resolveWebUiApprovalResponse,
} from "../packages/core/src/api/ws/stream.ts"
import { createSlackChunkDeliveryHandler } from "../packages/core/src/channels/slack/chunk-delivery.ts"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"
import { PATHS } from "../packages/core/src/config/index.js"
import { eventBus, type ApprovalDecision, type ApprovalResolutionReason, type NobieEvents } from "../packages/core/src/events/index.js"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"
import {
  createSlackInboundSimulation,
  createTelegramInboundSimulation,
  createDuplicateInboundEventGate,
  createWebUiInboundSimulation,
  createYeonjangCapabilityMqttMock,
} from "./fixtures/channel-e2e-simulator.ts"

const getRootRunMock = vi.fn()
const listRunsForActiveRequestGroupsMock = vi.fn(() => [])

vi.mock("../packages/core/src/runs/store.js", () => ({
  getRootRun: (...args: unknown[]) => getRootRunMock(...args),
  listRunsForActiveRequestGroups: (...args: unknown[]) => listRunsForActiveRequestGroupsMock(...args),
}))

const {
  handleSlackApprovalAction,
  registerSlackApprovalHandler,
  resetSlackApprovalStateForTest,
  setActiveSlackConversationForSession,
} = await import("../packages/core/src/channels/slack/approval-handler.ts")

const {
  registerApprovalHandler: registerTelegramApprovalHandler,
  resetTelegramApprovalStateForTest,
  setActiveChatForSession,
} = await import("../packages/core/src/channels/telegram/approval-handler.ts")

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("channel E2E simulator", () => {
  beforeEach(() => {
    vi.useRealTimers()
    getRootRunMock.mockReset()
    listRunsForActiveRequestGroupsMock.mockReset().mockReturnValue([])
    resetArtifactDeliveryDedupeForTest()
    resetSlackApprovalStateForTest()
    resetTelegramApprovalStateForTest()
    resetWebUiApprovalStateForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetArtifactDeliveryDedupeForTest()
    resetSlackApprovalStateForTest()
    resetTelegramApprovalStateForTest()
    resetWebUiApprovalStateForTest()
  })

  it("keeps Slack approval state in the originating thread and ignores duplicate actions", async () => {
    const slack = createSlackInboundSimulation()
    const sendApprovalRequest = vi.fn(async () => undefined)
    const reply = vi.fn(async () => undefined)
    const resolve = vi.fn()

    getRootRunMock.mockReturnValue({
      source: "slack",
      sessionId: slack.sessionId,
    })


    registerSlackApprovalHandler({ sendApprovalRequest })
    setActiveSlackConversationForSession(slack.sessionId, slack.channelId, slack.userId, slack.threadTs)

    eventBus.emit("approval.request", {
      runId: slack.runId,
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      resolve,
    })
    await flushMicrotasks()

    expect(sendApprovalRequest).toHaveBeenCalledWith({
      channelId: slack.channelId,
      threadTs: slack.threadTs,
      runId: slack.runId,
      text: expect.stringContaining("screen_capture"),
    })

    await expect(handleSlackApprovalAction({
      runId: slack.runId,
      decision: "allow_once",
      channelId: slack.channelId,
      threadTs: slack.threadTs,
      userId: slack.userId,
      reply,
    })).resolves.toBe(true)

    await expect(handleSlackApprovalAction({
      runId: slack.runId,
      decision: "allow_run",
      channelId: slack.channelId,
      threadTs: slack.threadTs,
      userId: slack.userId,
      reply,
    })).resolves.toBe(false)

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith("allow_once", "user")
    expect(reply).toHaveBeenCalledTimes(1)
  })

  it("keeps Telegram approval state in the originating chat/topic and rejects late approval after timeout", async () => {
    vi.useFakeTimers()
    const telegram = createTelegramInboundSimulation()
    const callbackHandlers: Array<(ctx: {
      callbackQuery: { data: string }
      from: { id: number; first_name?: string; username?: string }
      answerCallbackQuery: (text?: string) => Promise<void>
    }) => Promise<void>> = []
    const bot = {
      api: {
        sendMessage: vi.fn(async () => ({ message_id: 313 })),
        editMessageReplyMarkup: vi.fn(async () => undefined),
      },
      on: vi.fn((event: string, handler: (typeof callbackHandlers)[number]) => {
        if (event === "callback_query:data") callbackHandlers.push(handler)
      }),
    }
    const resolve = vi.fn()
    const timedOutResolve = vi.fn()
    const approvalResolved: NobieEvents["approval.resolved"][] = []
    const off = eventBus.on("approval.resolved", (event) => approvalResolved.push(event))

    try {
      getRootRunMock.mockImplementation((runId: string) => ({
        source: "telegram",
        sessionId: runId === telegram.runId ? telegram.sessionId : `${telegram.sessionId}-timeout`,
      }))

      registerTelegramApprovalHandler(bot as never)
      setActiveChatForSession(telegram.sessionId, telegram.chatId, telegram.userId, telegram.threadId)

      eventBus.emit("approval.request", {
        runId: telegram.runId,
        toolName: "screen_capture",
        params: { extensionId: "yeonjang-main" },
        kind: "approval",
        resolve,
      })
      await flushMicrotasks()

      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        telegram.chatId,
        expect.stringContaining("screen_capture"),
        expect.objectContaining({ message_thread_id: telegram.threadId }),
      )

      const answerCallbackQuery = vi.fn(async () => undefined)
      await callbackHandlers[0]?.({
        callbackQuery: { data: `deny:${telegram.runId}` },
        from: { id: telegram.userId, first_name: "Tester" },
        answerCallbackQuery,
      })

      expect(resolve).toHaveBeenCalledTimes(1)
      expect(resolve).toHaveBeenCalledWith("deny", "user")
      expect(answerCallbackQuery).toHaveBeenCalledWith("❌ 거부 후 취소")

      await callbackHandlers[0]?.({
        callbackQuery: { data: `approve:${telegram.runId}:all` },
        from: { id: telegram.userId, first_name: "Tester" },
        answerCallbackQuery,
      })
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(answerCallbackQuery).toHaveBeenLastCalledWith("이미 처리된 요청입니다.")

      const timeoutRun = "run-telegram-timeout"
      setActiveChatForSession(`${telegram.sessionId}-timeout`, telegram.chatId, telegram.userId, telegram.threadId)
      eventBus.emit("approval.request", {
        runId: timeoutRun,
        toolName: "screen_capture",
        params: { extensionId: "yeonjang-main" },
        kind: "approval",
        resolve: timedOutResolve,
      })
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(timedOutResolve).toHaveBeenCalledTimes(1)
      expect(timedOutResolve).toHaveBeenCalledWith("deny", "timeout")

      await callbackHandlers[0]?.({
        callbackQuery: { data: `approve:${timeoutRun}:once` },
        from: { id: telegram.userId, first_name: "Tester" },
        answerCallbackQuery,
      })
      expect(timedOutResolve).toHaveBeenCalledTimes(1)
      expect(answerCallbackQuery).toHaveBeenLastCalledWith("이미 처리된 요청입니다.")
      expect(approvalResolved).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: telegram.runId, decision: "deny", reason: "user" }),
        expect.objectContaining({ runId: timeoutRun, decision: "deny", reason: "timeout" }),
      ]))
    } finally {
      off()
    }
  })

  it("keeps WebUI approval state in the WebSocket session and ignores duplicate responses", () => {
    const webui = createWebUiInboundSimulation()
    const resolve = vi.fn()

    registerApprovalFromWs(webui.runId, resolve)

    expect(resolveWebUiApprovalResponse({
      type: "approval.respond",
      runId: webui.runId,
      decision: "allow_run",
      toolName: "screen_capture",
    })).toBe(true)
    expect(resolveWebUiApprovalResponse({
      type: "approval.respond",
      runId: webui.runId,
      decision: "deny",
      toolName: "screen_capture",
    })).toBe(false)

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith("allow_run", "user")
  })

  it("routes artifacts only to the originating channel and dedupes repeated artifact chunks", async () => {
    getRootRunMock.mockReturnValue(undefined)
    const slack = createSlackInboundSimulation({ runId: "run-slack-routing" })
    const telegram = createTelegramInboundSimulation({ runId: "run-telegram-routing" })
    const webui = createWebUiInboundSimulation({ runId: "run-webui-routing" })
    const slackResponder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(async () => "slack-file-ts"),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const telegramResponder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(async () => 909),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const artifacts: NobieEvents["agent.artifact"][] = []
    const off = eventBus.on("agent.artifact", (artifact) => artifacts.push(artifact))

    try {
      const slackHandler = createSlackChunkDeliveryHandler({
        responder: slackResponder,
        sessionId: slack.sessionId,
        channelId: slack.channelId,
        threadTs: slack.threadTs,
        getRunId: () => slack.runId,
        recordOutgoingMessageRef: vi.fn(),
        logError: vi.fn(),
      })
      const telegramHandler = createTelegramChunkDeliveryHandler({
        responder: telegramResponder,
        sessionId: telegram.sessionId,
        chatId: telegram.chatId,
        threadId: telegram.threadId,
        getRunId: () => telegram.runId,
        recordOutgoingMessageRef: vi.fn(),
        logError: vi.fn(),
      })
      const webuiHandler = createWebUiChunkDeliveryHandler({
        sessionId: webui.sessionId,
        runId: webui.runId,
      })

      const slackChunk = {
        type: "tool_end" as const,
        toolName: "screen_capture",
        success: true,
        output: "captured",
        details: {
          kind: "artifact_delivery" as const,
          channel: "slack" as const,
          filePath: "/tmp/slack-routing.png",
          caption: "Slack capture",
          size: 10,
          source: "slack",
        },
      }
      await slackHandler(slackChunk)
      await slackHandler(slackChunk)
      await telegramHandler(slackChunk)
      await webuiHandler(slackChunk)
      expect(slackResponder.sendFile).toHaveBeenCalledTimes(1)
      expect(telegramResponder.sendFile).not.toHaveBeenCalled()
      expect(artifacts).toHaveLength(0)

      const telegramChunk = {
        ...slackChunk,
        details: {
          kind: "artifact_delivery" as const,
          channel: "telegram" as const,
          filePath: "/tmp/telegram-routing.png",
          caption: "Telegram capture",
          size: 10,
          source: "telegram",
        },
      }
      await telegramHandler(telegramChunk)
      await telegramHandler(telegramChunk)
      await slackHandler(telegramChunk)
      await webuiHandler(telegramChunk)
      expect(telegramResponder.sendFile).toHaveBeenCalledTimes(1)
      expect(slackResponder.sendFile).toHaveBeenCalledTimes(1)
      expect(artifacts).toHaveLength(0)

      const webuiFilePath = join(PATHS.stateDir, "artifacts", "screens", "webui-routing.png")
      const webuiChunk = {
        ...slackChunk,
        details: {
          kind: "artifact_delivery" as const,
          channel: "webui" as const,
          filePath: webuiFilePath,
          caption: "WebUI capture",
          size: 10,
          source: "webui",
        },
      }
      await webuiHandler(webuiChunk)
      await webuiHandler(webuiChunk)
      await slackHandler(webuiChunk)
      await telegramHandler(webuiChunk)

      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toEqual(expect.objectContaining({
        sessionId: webui.sessionId,
        runId: webui.runId,
        url: "/api/artifacts/screens/webui-routing.png",
        filePath: webuiFilePath,
      }))
      expect(slackResponder.sendFile).toHaveBeenCalledTimes(1)
      expect(telegramResponder.sendFile).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it("dedupes duplicate inbound events before they can create another run", () => {
    const gate = createDuplicateInboundEventGate()
    const slack = createSlackInboundSimulation()
    const telegram = createTelegramInboundSimulation()

    expect(gate.accept({ source: slack.source, eventId: `${slack.channelId}:${slack.threadTs}` })).toBe(true)
    expect(gate.accept({ source: slack.source, eventId: `${slack.channelId}:${slack.threadTs}` })).toBe(false)
    expect(gate.accept({ source: telegram.source, eventId: `${telegram.chatId}:${telegram.threadId ?? 0}:42` })).toBe(true)
    expect(gate.accept({ source: telegram.source, eventId: `${telegram.chatId}:${telegram.threadId ?? 0}:42` })).toBe(false)
    expect(gate.accept({ source: slack.source, eventId: `${slack.channelId}:other-thread` })).toBe(true)
  })

  it("simulates Yeonjang capability and MQTT transitions before execution", () => {
    const yeonjang = createYeonjangCapabilityMqttMock({
      extensionId: "yeonjang-dongwooshinc28b-92049",
      connected: true,
      methods: ["screen.capture"],
    })

    expect(yeonjang.evaluate("screen.capture")).toEqual({
      available: true,
      extensionId: "yeonjang-dongwooshinc28b-92049",
      reason: "available",
    })
    expect(yeonjang.evaluate("system.exec")).toEqual({
      available: false,
      extensionId: "yeonjang-dongwooshinc28b-92049",
      reason: "capability_missing",
    })

    yeonjang.setMqttConnected(false)
    expect(yeonjang.evaluate("screen.capture")).toEqual({
      available: false,
      extensionId: "yeonjang-dongwooshinc28b-92049",
      reason: "mqtt_disconnected",
    })

    yeonjang.setMqttConnected(true)
    yeonjang.setCapability("system.exec", true)
    expect(yeonjang.evaluate("system.exec")).toEqual({
      available: true,
      extensionId: "yeonjang-dongwooshinc28b-92049",
      reason: "available",
    })
  })
})
