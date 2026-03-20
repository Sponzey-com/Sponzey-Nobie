import { describe, expect, it } from "vitest"
import {
  buildScheduledFollowupPrompt,
  getScheduledRunExecutionOptions,
  shouldDisableToolsForScheduledTask,
} from "../packages/core/src/runs/scheduled.ts"

describe("scheduled run policy", () => {
  it("disables tools for simple delayed utterance tasks", () => {
    expect(shouldDisableToolsForScheduledTask("안녕하고 잘가 라고 해줘", "general_chat")).toBe(true)

    const options = getScheduledRunExecutionOptions("안녕하고 잘가 라고 해줘", "general_chat")
    expect(options.toolsEnabled).toBe(false)
    expect(options.contextMode).toBe("isolated")
  })

  it("keeps tools available for explicitly operational scheduled tasks", () => {
    expect(shouldDisableToolsForScheduledTask("파일 내용을 읽고 요약해줘", "operations")).toBe(false)

    const options = getScheduledRunExecutionOptions("파일 내용을 읽고 요약해줘", "operations")
    expect(options.toolsEnabled).toBe(true)
    expect(options.contextMode).toBe("isolated")
  })

  it("builds a task-scoped prompt without the original multi-schedule sentence", () => {
    const prompt = buildScheduledFollowupPrompt({
      task: "안녕",
      goal: "안녕이라고 말하기",
      taskProfile: "general_chat",
      preferredTarget: "auto",
      toolsEnabled: false,
    })

    expect(prompt).toContain("Task: 안녕")
    expect(prompt).not.toContain("Original user request")
    expect(prompt).toContain("Do not use tools")
  })
})
