import { describe, expect, it } from "vitest"
import { buildFollowupPrompt } from "../packages/core/src/runs/action-execution.ts"

describe("delegated execution brief", () => {
  it("does not expose intake bridge wording in the delegated prompt", () => {
    const prompt = buildFollowupPrompt({
      originalMessage: "외부모니터 화면 캡쳐해서 보여줘",
      taskProfile: "operations",
      action: {
        id: "act-1",
        type: "run_task",
        title: "Capture external monitor screen",
        priority: "normal",
        reason: "capture it",
        payload: {},
      },
      intake: {
        intent: {
          category: "task_intake",
          summary: "Capture external monitor screen",
          confidence: 0.9,
        },
        user_message: {
          mode: "accepted_receipt",
          text: "",
        },
        action_items: [],
        structured_request: {
          source_language: "ko",
          normalized_english: "Capture the external monitor screen and show it.",
          target: "A screen capture image of the external monitor (IPU3212).",
          to: "webui session current",
          context: ["External monitor name: IPU3212"],
          complete_condition: [
            "The external monitor screen is captured.",
            "The captured image is delivered to the user.",
          ],
        },
        intent_envelope: {
          intent_type: "task_intake",
          source_language: "ko",
          normalized_english: "Capture the external monitor screen and show it.",
          target: "A screen capture image of the external monitor (IPU3212).",
          destination: "webui session current",
          context: ["External monitor name: IPU3212"],
          complete_condition: [
            "The external monitor screen is captured.",
            "The captured image is delivered to the user.",
          ],
          schedule_spec: {
            detected: false,
            kind: "none",
            status: "not_applicable",
            schedule_text: "",
          },
          execution_semantics: {
            filesystemEffect: "none",
            privilegedOperation: "required",
            artifactDelivery: "direct",
            approvalRequired: true,
            approvalTool: "screen_capture",
          },
          delivery_mode: "direct",
          requires_approval: true,
          approval_tool: "screen_capture",
          preferred_target: "auto",
          needs_tools: true,
          needs_web: false,
        },
        scheduling: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution: {
          requires_run: true,
          requires_delegation: false,
          suggested_target: "auto",
          max_delegation_turns: 4,
          needs_tools: true,
          needs_web: false,
          execution_semantics: {
            filesystemEffect: "none",
            privilegedOperation: "required",
            artifactDelivery: "direct",
            approvalRequired: true,
            approvalTool: "screen_capture",
          },
        },
        notes: [],
      },
    })

    expect(prompt).toContain("[Task Execution Brief]")
    expect(prompt).not.toContain("[Task Intake Bridge]")
    expect(prompt).not.toContain("후속 실행으로 전달되었습니다")
  })
})
