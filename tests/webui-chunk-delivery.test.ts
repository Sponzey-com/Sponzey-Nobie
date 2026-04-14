import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWebUiChunkDeliveryHandler } from "../packages/core/src/api/ws/chunk-delivery.ts"
import { PATHS } from "../packages/core/src/config/index.js"
import { eventBus, type NobieEvents } from "../packages/core/src/events/index.js"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"

afterEach(() => {
  resetArtifactDeliveryDedupeForTest()
})

describe("webui chunk delivery helper", () => {
  it("uses isolated Yeonjang tool output instead of buffered AI text", async () => {
    const onChunk = createWebUiChunkDeliveryHandler({
      sessionId: "session-1",
      runId: "run-1",
    })

    await onChunk?.({ type: "text", delta: "먼저 들어온 AI 안내문" })
    await onChunk?.({
      type: "tool_end",
      toolName: "yeonjang_camera_list",
      success: true,
      output: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
      details: {
        via: "yeonjang",
        responseOwnership: "final_text",
      },
    })
    await onChunk?.({ type: "text", delta: "나중에 생성된 AI 요약문" })
    await onChunk?.({ type: "error", message: "late failure" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "webui",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
      }],
    })
  })

  it("uses explicit final-text ownership for Yeonjang-backed action output", async () => {
    const onChunk = createWebUiChunkDeliveryHandler({
      sessionId: "session-2",
      runId: "run-2",
    })

    await onChunk?.({ type: "text", delta: "AI가 먼저 만든 안내문" })
    await onChunk?.({
      type: "tool_end",
      toolName: "mouse_click",
      success: true,
      output: "(120, 240) 클릭 완료",
      details: {
        via: "yeonjang",
        responseOwnership: "final_text",
        x: 120,
        y: 240,
        button: "left",
      },
    })
    await onChunk?.({ type: "text", delta: "나중에 생성된 AI 설명" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "webui",
        text: "(120, 240) 클릭 완료",
      }],
    })
  })

  it("does not emit the same artifact twice for one WebUI run", async () => {
    const artifacts: NobieEvents["agent.artifact"][] = []
    const unsubscribe = eventBus.on("agent.artifact", (artifact) => {
      artifacts.push(artifact)
    })
    const onChunk = createWebUiChunkDeliveryHandler({
      sessionId: "session-webui-artifact",
      runId: "run-webui-artifact",
    })
    const filePath = join(PATHS.stateDir, "artifacts", "screens", "duplicate.png")
    const chunk = {
      type: "tool_end" as const,
      toolName: "screen_capture",
      success: true,
      output: "captured",
      details: {
        kind: "artifact_delivery" as const,
        channel: "webui" as const,
        filePath,
        caption: "메인 화면",
        size: 123,
        source: "webui",
      },
    }

    try {
      const firstReceipt = await onChunk?.(chunk)
      const secondReceipt = await onChunk?.(chunk)

      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]?.filePath).toBe(filePath)
      expect(firstReceipt?.artifactDeliveries?.[0]).toMatchObject({
        toolName: "screen_capture",
        channel: "webui",
        filePath,
        caption: "메인 화면",
        url: "/api/artifacts/screens/duplicate.png",
        previewUrl: "/api/artifacts/screens/duplicate.png",
        downloadUrl: "/api/artifacts/screens/duplicate.png?download=1",
        previewable: true,
        mimeType: "image/png",
        sizeBytes: 123,
      })
      expect(secondReceipt).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })
})
