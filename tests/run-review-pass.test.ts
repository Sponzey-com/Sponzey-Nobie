import { describe, expect, it, vi } from "vitest"
import { runReviewPass } from "../packages/core/src/runs/review-pass.ts"

describe("run review pass", () => {
  it("returns review and synthetic approval together", async () => {
    const reviewTaskCompletion = vi.fn().mockResolvedValue({
      status: "ask_user",
      summary: "화면 캡처 진행 전 승인이 필요합니다.",
      reason: "권한이 필요합니다.",
      userMessage: "화면 기록 권한을 허용해 주세요.",
      remainingItems: ["화면 기록 권한 허용"],
    })

    const result = await runReviewPass({
      executionProfile: {
        approvalRequired: true,
        approvalTool: "screen_capture",
      },
      originalRequest: "메인 화면을 캡처해서 보여줘",
      preview: "스크린샷 캡처 권한이 필요합니다.",
      priorAssistantMessages: [],
      usesWorkerRuntime: true,
      requiresPrivilegedToolExecution: true,
      successfulTools: [],
      successfulFileDeliveries: [],
      sawRealFilesystemMutation: false,
    }, {
      reviewTaskCompletion,
    })

    expect(result.review?.status).toBe("ask_user")
    expect(result.syntheticApproval?.toolName).toBe("screen_capture")
  })

  it("swallows review errors and reports them through callback", async () => {
    const onReviewError = vi.fn()
    const reviewTaskCompletion = vi.fn().mockRejectedValue(new Error("403 <html><body>review failed</body></html>"))

    const result = await runReviewPass({
      executionProfile: {
        approvalRequired: false,
        approvalTool: "none",
      },
      originalRequest: "안녕이라고 말해줘",
      preview: "안녕",
      priorAssistantMessages: [],
      usesWorkerRuntime: false,
      requiresPrivilegedToolExecution: false,
      successfulTools: [],
      successfulFileDeliveries: [],
      sawRealFilesystemMutation: false,
    }, {
      reviewTaskCompletion,
      onReviewError,
    })

    expect(result.review).toBeNull()
    expect(result.syntheticApproval).toBeNull()
    expect(onReviewError).toHaveBeenCalledWith("인증 또는 접근 차단 문제로 서버가 HTML 오류 페이지를 반환했습니다.")
  })
})
