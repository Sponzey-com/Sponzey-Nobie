import crypto from "node:crypto"
import { insertMessage } from "../db/index.js"
import { logAssistantReply, type DeliverySource } from "./delivery.js"
import type { RunStepStatus } from "./types.js"

interface ReviewTransitionDependencies {
  appendRunEvent: (runId: string, label: string) => void
  setRunStepStatus: (
    runId: string,
    step: string,
    status: RunStepStatus,
    summary: string,
  ) => unknown
  insertMessage: typeof insertMessage
  writeReplyLog: (source: DeliverySource, text: string) => void
  createId: () => string
  now: () => number
}

const defaultDependencies: ReviewTransitionDependencies = {
  appendRunEvent: () => {},
  setRunStepStatus: () => {},
  insertMessage,
  writeReplyLog: logAssistantReply,
  createId: () => crypto.randomUUID(),
  now: () => Date.now(),
}

export function prepareRunForReview(params: {
  runId: string
  sessionId: string
  source: DeliverySource
  preview: string
  workerSessionId?: string
  persistRuntimePreview: boolean
  dependencies?: Partial<ReviewTransitionDependencies>
}): void {
  const dependencies = { ...defaultDependencies, ...params.dependencies }

  if (params.workerSessionId) {
    dependencies.appendRunEvent(params.runId, `${params.workerSessionId} 실행 종료`)
  }

  if (params.persistRuntimePreview && params.preview.trim()) {
    dependencies.insertMessage({
      id: dependencies.createId(),
      session_id: params.sessionId,
      root_run_id: params.runId,
      role: "assistant",
      content: params.preview,
      tool_calls: null,
      tool_call_id: null,
      created_at: dependencies.now(),
    })
  }

  dependencies.writeReplyLog(params.source, params.preview)
  dependencies.setRunStepStatus(
    params.runId,
    "executing",
    "completed",
    params.preview || "응답 생성을 마쳤습니다.",
  )
  dependencies.setRunStepStatus(
    params.runId,
    "reviewing",
    "running",
    "남은 작업이 있는지 검토 중입니다.",
  )
}
