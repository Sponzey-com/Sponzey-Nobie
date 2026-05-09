import { describe, expect, it } from "vitest"
import {
  buildScheduledFollowupPrompt,
  extractDirectChannelDeliveryText,
  getScheduledRunExecutionOptions,
  shouldDisableToolsForScheduledTask,
} from "../packages/core/src/runs/scheduled.ts"

describe("scheduled run policy", () => {
  it("disables tools only from stored execution semantics", () => {
    const semantics = {
      filesystemEffect: "none" as const,
      privilegedOperation: "none" as const,
      artifactDelivery: "none" as const,
      approvalRequired: false,
      approvalTool: "external_action" as const,
    }
    expect(shouldDisableToolsForScheduledTask("안녕하고 잘가 라고 해줘", "general_chat")).toBe(false)
    expect(shouldDisableToolsForScheduledTask("안녕하고 잘가 라고 해줘", "general_chat", semantics)).toBe(true)

    const options = getScheduledRunExecutionOptions("안녕하고 잘가 라고 해줘", "general_chat", semantics)
    expect(options.toolsEnabled).toBe(false)
    expect(options.contextMode).toBe("isolated")
  })

  it("keeps tools available for explicitly operational scheduled tasks", () => {
    expect(shouldDisableToolsForScheduledTask("파일 내용을 읽고 요약해줘", "operations")).toBe(false)

    const options = getScheduledRunExecutionOptions("파일 내용을 읽고 요약해줘", "operations")
    expect(options.toolsEnabled).toBe(true)
    expect(options.contextMode).toBe("isolated")
  })

  it("does not extract direct delivery text from legacy wording", () => {
    expect(extractDirectChannelDeliveryText("매 1분마다 사용자에게 '알림' 메시지로 알려주기")).toBeNull()
    expect(extractDirectChannelDeliveryText("이 대화에 \"알람\" 메시지를 전송")).toBeNull()
    expect(extractDirectChannelDeliveryText("시스템 알람(소리/알림)으로 '일어나'라고 안내")).toBeNull()
    expect(extractDirectChannelDeliveryText("매일 'report.txt' 파일을 읽고 요약해줘")).toBeNull()
  })

  it("builds a task-scoped prompt without the original multi-schedule sentence", () => {
    const prompt = buildScheduledFollowupPrompt({
      task: "안녕",
      goal: "안녕이라고 말하기",
      taskProfile: "general_chat",
      preferredTarget: "auto",
      toolsEnabled: false,
    })

    expect(prompt).toContain("[target]")
    expect(prompt).toContain("안녕이라고 말하기")
    expect(prompt).not.toContain("Original user request")
    expect(prompt).toContain("[checklist]")
    expect(prompt).toContain("- [ ] 목표 확인:")
    expect(prompt).toContain("도구를 사용하지 말고")
  })
})
