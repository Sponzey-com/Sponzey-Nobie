import { describe, expect, it } from "vitest"
import { decideDirectArtifactDeliveryApplication } from "../packages/core/src/runs/delivery-application.ts"

describe("delivery application helpers", () => {
  it("passes through completion outcomes", () => {
    const result = decideDirectArtifactDeliveryApplication({
      kind: "complete",
      deliverySummary: "텔레그램 파일 전달 완료: ~/a.png",
      finalText: "캡처 완료",
      eventLabel: "직접 파일 전달 요청 완료",
    })

    expect(result.kind).toBe("complete")
    if (result.kind === "complete") {
      expect(result.summary).toContain("전달 완료")
      expect(result.finalText).toBe("캡처 완료")
    }
  })

  it("maps retry outcomes to structured retry application", () => {
    const result = decideDirectArtifactDeliveryApplication({
      kind: "retry",
      recoveryKey: "delivery:telegram",
      summary: "메신저 결과 전달을 다시 시도합니다.",
      reason: "직접 전달이 완료되지 않았습니다.",
      alternatives: [{ kind: "other_channel", label: "같은 결과를 다른 채널로 전달" }],
      nextMessage: "[Direct Artifact Delivery Recovery]",
      eventLabel: "메신저 결과 전달 재시도",
    })

    expect(result.kind).toBe("retry")
    if (result.kind === "retry") {
      expect(result.title).toBe("direct_artifact_delivery_recovery")
      expect(result.clearWorkerRuntime).toBe(true)
      expect(result.nextMessage).toContain("[Direct Artifact Delivery Recovery]")
    }
  })

  it("passes stop outcomes through unchanged", () => {
    const result = decideDirectArtifactDeliveryApplication({
      kind: "stop",
      summary: "전달 복구 재시도 한도에 도달했습니다.",
      reason: "사용자가 결과물 자체 전달을 요청했습니다.",
      remainingItems: ["결과물 자체를 메신저로 전달"],
    })

    expect(result.kind).toBe("stop")
    if (result.kind === "stop") {
      expect(result.remainingItems[0]).toContain("메신저")
    }
  })
})
