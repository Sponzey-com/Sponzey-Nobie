import { describe, expect, it } from "vitest"
import {
  buildDeliveryPostPassPreview,
  decideDirectArtifactDeliveryFlow,
} from "../packages/core/src/runs/delivery-postpass.ts"

describe("delivery post-pass helpers", () => {
  it("appends delivery summary to preview when artifact delivery succeeded", () => {
    const result = buildDeliveryPostPassPreview({
      preview: "기존 결과",
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: true,
        deliverySatisfied: true,
        deliverySummary: "텔레그램 파일 전달 완료: ~/a.png",
        requiresDirectArtifactRecovery: false,
      },
      successfulFileDeliveries: [],
      successfulTools: [],
      sawRealFilesystemMutation: false,
    })

    expect(result.preview).toContain("기존 결과")
    expect(result.preview).toContain("텔레그램 파일 전달 완료")
  })

  it("builds implicit preview when no preview exists but tools succeeded", () => {
    const result = buildDeliveryPostPassPreview({
      preview: "",
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      successfulFileDeliveries: [],
      successfulTools: [{ toolName: "screen_capture", output: "ok" }],
      sawRealFilesystemMutation: false,
    })

    expect(result.preview).toContain("screen_capture 실행을 완료했습니다.")
  })

  it("returns completion decision for satisfied direct delivery", () => {
    const decision = decideDirectArtifactDeliveryFlow({
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: true,
        deliverySatisfied: true,
        deliverySummary: "텔레그램 파일 전달 완료: ~/a.png",
        requiresDirectArtifactRecovery: false,
      },
      source: "telegram",
      successfulFileDeliveries: [],
      seenKeys: new Set(),
      canRetry: false,
      maxTurns: 5,
      deliveryBudgetLimit: 5,
      originalRequest: "보여줘",
      previousResult: "캡처 완료",
      successfulTools: [],
    })

    expect(decision.kind).toBe("complete")
  })

  it("returns retry decision when direct delivery still needs recovery", () => {
    const decision = decideDirectArtifactDeliveryFlow({
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: true,
      },
      source: "telegram",
      successfulFileDeliveries: [],
      seenKeys: new Set(),
      canRetry: true,
      maxTurns: 5,
      deliveryBudgetLimit: 5,
      originalRequest: "보여줘",
      previousResult: "캡처 완료",
      successfulTools: [{ toolName: "screen_capture", output: "ok" }],
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.nextMessage).toContain("[Direct Artifact Delivery Recovery]")
    }
  })

  it("completes mistaken direct delivery for plain text information answers", () => {
    const decision = decideDirectArtifactDeliveryFlow({
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: true,
      },
      source: "telegram",
      successfulFileDeliveries: [],
      seenKeys: new Set(),
      canRetry: true,
      maxTurns: 5,
      deliveryBudgetLimit: 5,
      originalRequest: "현재 동천동의 날씨는 어때?",
      previousResult: "동천동은 현재 대체로 맑습니다.",
      successfulTools: [{ toolName: "web_search", output: "ok" }],
    })

    expect(decision.kind).toBe("complete")
    if (decision.kind === "complete") {
      expect(decision.finalText).toContain("동천동")
      expect(decision.eventLabel).toBe("텍스트 결과 전달 요청 완료")
    }
  })
})
