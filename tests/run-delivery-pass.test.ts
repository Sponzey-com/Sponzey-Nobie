import { describe, expect, it } from "vitest"
import { runDeliveryPass } from "../packages/core/src/runs/delivery-pass.ts"

describe("delivery pass", () => {
  it("builds a completion application when direct artifact delivery is satisfied", () => {
    const result = runDeliveryPass({
      preview: "캡처를 완료했습니다.",
      wantsDirectArtifactDelivery: true,
      successfulFileDeliveries: [
        {
          toolName: "telegram_send_file",
          channel: "telegram",
          filePath: "/tmp/capture.png",
        },
      ],
      successfulTools: [],
      sawRealFilesystemMutation: false,
      source: "telegram",
      seenDeliveryRecoveryKeys: new Set<string>(),
      canRetry: true,
      maxTurns: 3,
      deliveryBudgetLimit: 3,
      originalRequest: "캡처해서 보내줘",
      previousResult: "캡처를 완료했습니다.",
    })

    expect(result.deliveryOutcome.deliverySatisfied).toBe(true)
    expect(result.preview).toContain("캡처를 완료했습니다.")
    expect(result.directDeliveryApplication.kind).toBe("complete")
  })

  it("builds a retry application when direct artifact delivery still needs recovery", () => {
    const result = runDeliveryPass({
      preview: "",
      wantsDirectArtifactDelivery: true,
      successfulFileDeliveries: [],
      successfulTools: [{ toolName: "screencapture" }],
      sawRealFilesystemMutation: false,
      source: "telegram",
      seenDeliveryRecoveryKeys: new Set<string>(),
      canRetry: true,
      maxTurns: 2,
      deliveryBudgetLimit: 2,
      originalRequest: "캡처해서 보내줘",
      previousResult: "스크린샷을 만들었습니다.",
    })

    expect(result.deliveryOutcome.requiresDirectArtifactRecovery).toBe(true)
    expect(result.preview).toContain("screencapture")
    expect(result.directDeliveryApplication.kind).toBe("retry")
  })
})
