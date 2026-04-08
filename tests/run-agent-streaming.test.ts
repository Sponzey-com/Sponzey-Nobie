import { describe, expect, it, vi } from "vitest"

const getAllMock = vi.fn(() => [])
const dispatchMock = vi.fn()
const getMessagesForRunMock = vi.fn(() => [])
const buildMemoryContextMock = vi.fn(async () => "")

vi.mock("../packages/core/src/db/index.js", () => ({
  getDb: () => ({
    prepare: () => ({ run: vi.fn() }),
  }),
  insertSession: vi.fn(),
  getSession: vi.fn(() => null),
  insertMessage: vi.fn(),
  getMessages: vi.fn(() => []),
  getMessagesForRequestGroup: vi.fn(() => []),
  getMessagesForRequestGroupWithRunMeta: vi.fn(() => []),
  getMessagesForRun: (...args: unknown[]) => getMessagesForRunMock(...args),
  insertMemoryItem: vi.fn(),
  markMessagesCompressed: vi.fn(),
}))

vi.mock("../packages/core/src/memory/store.js", () => ({
  buildMemoryContext: (...args: unknown[]) => buildMemoryContextMock(...args),
}))

vi.mock("../packages/core/src/memory/nobie-md.js", () => ({
  loadNobieMd: vi.fn(() => ""),
  loadSysPropMd: vi.fn(() => ""),
}))

vi.mock("../packages/core/src/instructions/merge.js", () => ({
  loadMergedInstructions: vi.fn(() => ({ mergedText: "" })),
}))

vi.mock("../packages/core/src/tools/dispatcher.js", () => ({
  toolDispatcher: {
    getAll: (...args: unknown[]) => getAllMock(...args),
    isToolAvailableForSource: () => true,
    dispatch: (...args: unknown[]) => dispatchMock(...args),
  },
}))

const { runAgent } = await import("../packages/core/src/agent/index.ts")

describe("runAgent streaming policy", () => {
  it("does not leak partial assistant text when the AI round fails", async () => {
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "text_delta", delta: "메인 화면을 지금 캡처해서 이 채팅에 바로 보여드릴게요." } as const
        throw new Error("403 forbidden")
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "메인 전체 화면 캡처",
      sessionId: "session-agent-streaming-failure",
      runId: "run-agent-streaming-failure",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: false,
    })) {
      chunks.push(chunk)
    }

    expect(chunks.some((chunk) => chunk.type === "text")).toBe(false)
    expect(chunks).toEqual([{
      type: "ai_recovery",
      summary: "AI 응답 생성 중 오류가 발생해 다른 방법을 다시 시도합니다.",
      reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
      message: "403 forbidden",
    }])
  })

  it("emits the buffered assistant text only after a successful non-tool round", async () => {
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "text_delta", delta: "작업을 완료했습니다." } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "상태 알려줘",
      sessionId: "session-agent-streaming-success",
      runId: "run-agent-streaming-success",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: false,
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: "text", delta: "작업을 완료했습니다." },
      { type: "done", totalTokens: 2 },
    ])
  })

  it("stops after a successful isolated Yeonjang camera list tool round", async () => {
    getAllMock.mockReturnValueOnce([{
      name: "yeonjang_camera_list",
      description: "camera list",
      parameters: { type: "object", properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: true,
      output: "연장 \"yeonjang-main\" 카메라 2개:\n- FaceTime HD Camera\n- iPhone Camera",
      details: {
        via: "yeonjang",
        responseOwnership: "final_text",
      },
    })

    const provider = {
      chat: vi.fn(async function* () {
        yield {
          type: "tool_use",
          id: "tool-1",
          name: "yeonjang_camera_list",
          input: {},
        } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "카메라 몇 개 있는지 알려줘",
      sessionId: "session-agent-camera-list",
      runId: "run-agent-camera-list",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([
      { type: "tool_start", toolName: "yeonjang_camera_list", params: {} },
      {
        type: "tool_end",
        toolName: "yeonjang_camera_list",
        success: true,
        output: "연장 \"yeonjang-main\" 카메라 2개:\n- FaceTime HD Camera\n- iPhone Camera",
        details: { via: "yeonjang", responseOwnership: "final_text" },
      },
      { type: "done", totalTokens: 2 },
    ])
  })

  it("stops after successful artifact delivery instead of asking the AI to send it again", async () => {
    getAllMock.mockReturnValueOnce([{
      name: "telegram_send_file",
      description: "send telegram file",
      parameters: { type: "object", properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: true,
      output: "텔레그램 파일 전송 요청을 생성했습니다.",
      details: {
        kind: "artifact_delivery",
        channel: "telegram",
        filePath: "/tmp/capture.jpg",
        size: 128,
        source: "telegram",
      },
    })

    const provider = {
      chat: vi.fn(async function* () {
        yield {
          type: "tool_use",
          id: "tool-3",
          name: "telegram_send_file",
          input: { filePath: "/tmp/capture.jpg" },
        } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "사진을 텔레그램으로 보내줘",
      sessionId: "session-agent-telegram-file-success",
      runId: "run-agent-telegram-file-success",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([
      {
        type: "tool_start",
        toolName: "telegram_send_file",
        params: { filePath: "/tmp/capture.jpg" },
      },
      {
        type: "tool_end",
        toolName: "telegram_send_file",
        success: true,
        output: "텔레그램 파일 전송 요청을 생성했습니다.",
        details: {
          kind: "artifact_delivery",
          channel: "telegram",
          filePath: "/tmp/capture.jpg",
          size: 128,
          source: "telegram",
        },
      },
      { type: "done", totalTokens: 2 },
    ])
  })

  it("stops after successful slack screen capture artifact delivery instead of continuing with extra tools", async () => {
    getAllMock.mockReturnValueOnce([{
      name: "screen_capture",
      description: "screen capture",
      parameters: { type: "object", properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: true,
      output: "Yeonjang 스크린샷 캡처 완료.",
      details: {
        kind: "artifact_delivery",
        channel: "slack",
        filePath: "/tmp/screen.png",
        size: 128,
        source: "slack",
      },
    })

    const provider = {
      chat: vi.fn(async function* () {
        yield {
          type: "tool_use",
          id: "tool-screen-slack-1",
          name: "screen_capture",
          input: { extensionId: "yeonjang-main" },
        } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "메인 화면 캡쳐해서 보여줘",
      sessionId: "session-agent-slack-screen-success",
      runId: "run-agent-slack-screen-success",
      model: "gpt-5",
      provider: provider as never,
      source: "slack",
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([
      {
        type: "tool_start",
        toolName: "screen_capture",
        params: { extensionId: "yeonjang-main" },
      },
      {
        type: "tool_end",
        toolName: "screen_capture",
        success: true,
        output: "Yeonjang 스크린샷 캡처 완료.",
        details: {
          kind: "artifact_delivery",
          channel: "slack",
          filePath: "/tmp/screen.png",
          size: 128,
          source: "slack",
        },
      },
      { type: "done", totalTokens: 2 },
    ])
  })

  it("stops after a terminal screen capture failure instead of exploring keyboard or shell fallbacks", async () => {
    getAllMock.mockReturnValueOnce([{
      name: 'screen_capture',
      description: 'screen capture',
      parameters: { type: 'object', properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: false,
      output: 'Windows 연장의 `screen.capture` 내부 경로 처리 오류 때문에 화면 캡처가 실패했습니다.\nWindows에서 `build-yeonjang-windows.bat`를 실행해 재빌드한 뒤 다시 시도해 주세요.',
      error: 'YEONJANG_SCREEN_CAPTURE_PATH_BUG',
      details: {
        via: 'yeonjang',
        stopAfterFailure: true,
        failureKind: 'path_bug',
        extensionId: 'yeonjang-windows',
      },
    })

    const provider = {
      chat: vi.fn(async function* () {
        yield {
          type: 'tool_use',
          id: 'tool-screen-1',
          name: 'screen_capture',
          input: { extensionId: 'yeonjang-windows' },
        } as const
        yield {
          type: 'message_stop',
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: '윈도우 메인화면 캡처해서 보여줘',
      sessionId: 'session-agent-screen-failure',
      runId: 'run-agent-screen-failure',
      model: 'gpt-5',
      provider: provider as never,
      source: 'telegram',
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([
      {
        type: 'tool_start',
        toolName: 'screen_capture',
        params: { extensionId: 'yeonjang-windows' },
      },
      {
        type: 'tool_end',
        toolName: 'screen_capture',
        success: false,
        output: 'Windows 연장의 `screen.capture` 내부 경로 처리 오류 때문에 화면 캡처가 실패했습니다.\nWindows에서 `build-yeonjang-windows.bat`를 실행해 재빌드한 뒤 다시 시도해 주세요.',
        details: {
          via: 'yeonjang',
          stopAfterFailure: true,
          failureKind: 'path_bug',
          extensionId: 'yeonjang-windows',
        },
      },
      {
        type: 'text',
        delta: 'Windows 연장의 `screen.capture` 내부 경로 처리 오류 때문에 화면 캡처가 실패했습니다.\nWindows에서 `build-yeonjang-windows.bat`를 실행해 재빌드한 뒤 다시 시도해 주세요.',
      },
      { type: 'done', totalTokens: 2 },
    ])
  })

  it("stops after telegram file send fails in the telegram channel instead of asking the AI again", async () => {
    getAllMock.mockReturnValueOnce([{
      name: "telegram_send_file",
      description: "send telegram file",
      parameters: { type: "object", properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: false,
      output: "단순 확인/요약/상태 결과는 파일 첨부가 아니라 일반 메시지로 전달해야 합니다.",
      error: "DOCUMENT_ATTACHMENT_NOT_REQUESTED",
    })

    const provider = {
      chat: vi.fn(async function* () {
        yield {
          type: "tool_use",
          id: "tool-2",
          name: "telegram_send_file",
          input: { filePath: "/tmp/result.txt" },
        } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "카메라 목록을 텔레그램으로 전달해줘",
      sessionId: "session-agent-telegram-file-failure",
      runId: "run-agent-telegram-file-failure",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([
      {
        type: "tool_start",
        toolName: "telegram_send_file",
        params: { filePath: "/tmp/result.txt" },
      },
      {
        type: "tool_end",
        toolName: "telegram_send_file",
        success: false,
        output: "단순 확인/요약/상태 결과는 파일 첨부가 아니라 일반 메시지로 전달해야 합니다.",
      },
      { type: "done", totalTokens: 2 },
    ])
  })

  it("does not emit execution recovery for unsupported continuity camera facing requests", async () => {
    getAllMock.mockReturnValueOnce([{
      name: "yeonjang_camera_capture",
      description: "camera capture",
      parameters: { type: "object", properties: {} },
    }])
    dispatchMock.mockResolvedValueOnce({
      success: false,
      output: [
        "선택한 카메라 \"SamJokO's iPhone-17 Pro Max\" 에서는 전면 카메라를 Nobie/Yeonjang에서 강제로 선택할 수 없습니다.",
        "iPhone 연속성 카메라는 현재 렌즈(전면/후면) 전환 제어를 노출하지 않습니다.",
      ].join("\n"),
      error: "CAMERA_FACING_SELECTION_UNSUPPORTED",
    })

    const provider = {
      chat: vi.fn()
        .mockImplementationOnce(async function* () {
          yield {
            type: "tool_use",
            id: "tool-unsupported-facing",
            name: "yeonjang_camera_capture",
            input: { deviceId: "iphone-camera" },
          } as const
          yield {
            type: "message_stop",
            usage: { input_tokens: 1, output_tokens: 1 },
          } as const
        })
        .mockImplementationOnce(async function* () {
          yield {
            type: "message_stop",
            usage: { input_tokens: 1, output_tokens: 1 },
          } as const
        }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "아이폰 전면 카메라로 한 장 찍어줘",
      sessionId: "session-agent-unsupported-facing",
      runId: "run-agent-unsupported-facing",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: true,
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      {
        type: "tool_start",
        toolName: "yeonjang_camera_capture",
        params: { deviceId: "iphone-camera" },
      },
      {
        type: "tool_end",
        toolName: "yeonjang_camera_capture",
        success: false,
        output: [
          "선택한 카메라 \"SamJokO's iPhone-17 Pro Max\" 에서는 전면 카메라를 Nobie/Yeonjang에서 강제로 선택할 수 없습니다.",
          "iPhone 연속성 카메라는 현재 렌즈(전면/후면) 전환 제어를 노출하지 않습니다.",
        ].join("\n"),
      },
      { type: "done", totalTokens: 4 },
    ])
  })

  it("uses run-local messages and scoped memory when context mode is handoff", async () => {
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "text_delta", delta: "handoff ok" } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "후속 작업 진행",
      sessionId: "session-handoff",
      requestGroupId: "group-handoff",
      runId: "run-handoff",
      model: "gpt-5",
      provider: provider as never,
      source: "webui",
      toolsEnabled: false,
      contextMode: "handoff",
    })) {
      chunks.push(chunk)
    }

    expect(getMessagesForRunMock).toHaveBeenCalledWith("session-handoff", "run-handoff")
    expect(buildMemoryContextMock).toHaveBeenCalledWith({
      query: "후속 작업 진행",
      sessionId: "session-handoff",
      requestGroupId: "group-handoff",
      runId: "run-handoff",
    })
    expect(chunks).toEqual([
      { type: "text", delta: "handoff ok" },
      { type: "done", totalTokens: 2 },
    ])
  })
})
