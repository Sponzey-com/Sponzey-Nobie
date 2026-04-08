import { eventBus } from "../../events/index.js"
import { getRootRun } from "../../runs/store.js"

interface ActiveSlackConversation {
  channelId: string
  userId: string
  threadTs: string
}

interface PendingApproval {
  requesterId: string
  channelId: string
  threadTs: string
  toolName: string
  kind: "approval" | "screen_confirmation"
  resolve: (decision: "allow_once" | "allow_run" | "deny", reason?: "user" | "timeout" | "abort" | "system") => void
}

export interface SlackApprovalMessenger {
  sendApprovalRequest(params: {
    channelId: string
    threadTs: string
    runId: string
    text: string
  }): Promise<void>
}

const activeConversations = new Map<string, ActiveSlackConversation>()
const activeConversationRefs = new Map<string, number>()
const pendingApprovals = new Map<string, PendingApproval>()
let detachSlackApprovalRequestListener: (() => void) | null = null
let latestActiveConversation: ActiveSlackConversation | undefined

export function setActiveSlackConversationForSession(
  sessionId: string,
  channelId: string,
  userId: string,
  threadTs: string,
): void {
  const conversation = { channelId, userId, threadTs }
  activeConversations.set(sessionId, conversation)
  activeConversationRefs.set(sessionId, (activeConversationRefs.get(sessionId) ?? 0) + 1)
  latestActiveConversation = conversation
}

export function clearActiveSlackConversationForSession(sessionId: string): void {
  const remaining = (activeConversationRefs.get(sessionId) ?? 1) - 1
  if (remaining > 0) {
    activeConversationRefs.set(sessionId, remaining)
    return
  }
  activeConversationRefs.delete(sessionId)
  activeConversations.delete(sessionId)
}

export function registerSlackApprovalHandler(messenger: SlackApprovalMessenger): void {
  detachSlackApprovalRequestListener?.()
  detachSlackApprovalRequestListener = eventBus.on("approval.request", async ({ runId, toolName, params, kind = "approval", guidance, resolve }) => {
    const run = getRootRun(runId)
    if (run?.source !== "slack") return
    const target = activeConversations.get(run.sessionId) ?? latestActiveConversation
    if (!target) {
      eventBus.emit("approval.resolved", {
        runId,
        decision: "deny",
        toolName,
        kind,
        reason: "system",
      })
      resolve("deny", "system")
      return
    }

    const paramsPreview = JSON.stringify(params, null, 2).slice(0, 300)
    const text = [
      kind === "screen_confirmation" ? "*화면 조작 준비 확인이 필요합니다.*" : "*도구 실행 승인이 필요합니다.*",
      `도구: ${toolName}`,
      `파라미터:\n${paramsPreview}`,
      guidance ? `안내: ${guidance}` : "",
      "아래 버튼을 누르거나, 버튼이 보이지 않으면 이 스레드에 `approve`, `approve once`, `deny` 중 하나로 답해주세요.",
    ].filter(Boolean).join("\n\n")

    await messenger.sendApprovalRequest({
      channelId: target.channelId,
      threadTs: target.threadTs,
      runId,
      text,
    })

    pendingApprovals.set(runId, {
      requesterId: target.userId,
      channelId: target.channelId,
      threadTs: target.threadTs,
      toolName,
      kind,
      resolve,
    })
  })
}

function resolveSlackApproval(params: {
  runId: string
  decision: "allow_once" | "allow_run" | "deny"
  channelId: string
  threadTs: string
  userId: string
  reply: (text: string) => Promise<void>
}): Promise<boolean> {
  const pending = pendingApprovals.get(params.runId)
  if (!pending) return Promise.resolve(false)
  if (pending.channelId !== params.channelId || pending.threadTs !== params.threadTs || pending.requesterId !== params.userId) {
    return Promise.resolve(false)
  }

  pendingApprovals.delete(params.runId)
  pending.resolve(params.decision, "user")
  eventBus.emit("approval.resolved", {
    runId: params.runId,
    decision: params.decision,
    toolName: pending.toolName,
    kind: pending.kind,
    reason: "user",
  })
  return params.reply(
    params.decision === "allow_run"
      ? "이 요청 전체를 승인했습니다."
      : params.decision === "allow_once"
        ? "이번 단계만 승인했습니다."
        : "요청을 거부하고 취소했습니다.",
  ).then(() => true)
}

export async function handleSlackApprovalMessage(params: {
  channelId: string
  threadTs: string
  userId: string
  text: string
  reply: (text: string) => Promise<void>
}): Promise<boolean> {
  const normalized = params.text.trim().toLowerCase()
  const decision =
    normalized === "approve"
      ? "allow_run"
      : normalized === "approve once"
        ? "allow_once"
        : normalized === "deny"
          ? "deny"
          : null

  if (!decision) return false

  const entry = [...pendingApprovals.entries()].find(([, value]) =>
    value.channelId === params.channelId
    && value.threadTs === params.threadTs
    && value.requesterId === params.userId,
  )

  if (!entry) return false

  return resolveSlackApproval({
    runId: entry[0],
    decision,
    channelId: params.channelId,
    threadTs: params.threadTs,
    userId: params.userId,
    reply: params.reply,
  })
}

export async function handleSlackApprovalAction(params: {
  runId: string
  decision: "allow_once" | "allow_run" | "deny"
  channelId: string
  threadTs: string
  userId: string
  reply: (text: string) => Promise<void>
}): Promise<boolean> {
  return resolveSlackApproval(params)
}
