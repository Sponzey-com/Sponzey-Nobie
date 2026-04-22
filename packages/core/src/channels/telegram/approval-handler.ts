import type { Bot } from "grammy"
import { eventBus } from "../../events/index.js"
import type { ApprovalDecision } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { getRootRun } from "../../runs/store.js"
import { attachApprovalChannelMessage, describeLateApproval, getLatestApprovalForRun } from "../../runs/approval-registry.js"
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js"
import { recordLatencyMetric } from "../../observability/latency.js"
import {
  appendApprovalAggregateItem,
  buildApprovalAggregateText,
  resolveApprovalAggregate,
  type ApprovalAggregateContext,
} from "../approval-aggregation.js"
import { buildApprovalKeyboard, buildResultKeyboard } from "./keyboards.js"

const log = createLogger("channel:telegram:approval")

interface PendingApproval {
  context: ApprovalAggregateContext
  chatId: number
  messageId: number
  requesterId: number
  timeout?: ReturnType<typeof setTimeout> | null
}

interface ActiveChat {
  chatId: number
  userId: number
  threadId?: number | undefined
}

// Map from runId → pending approval data
const pending = new Map<string, PendingApproval>()

// Map from sessionId → active chat info (set by bot.ts before runAgent)
export const activeChats = new Map<string, ActiveChat>()
const activeChatRefs = new Map<string, number>()

// Most recent active chat (for single-user cases when we don't have sessionId in event)
let latestActiveChat: ActiveChat | undefined
let detachTelegramApprovalRequestListener: (() => void) | null = null

export function setActiveChatForSession(
  sessionId: string,
  chatId: number,
  userId: number,
  threadId?: number | undefined,
): void {
  const chat: ActiveChat = { chatId, userId, ...(threadId !== undefined ? { threadId } : {}) }
  activeChats.set(sessionId, chat)
  activeChatRefs.set(sessionId, (activeChatRefs.get(sessionId) ?? 0) + 1)
  latestActiveChat = chat
}

export function clearActiveChatForSession(sessionId: string): void {
  const remaining = (activeChatRefs.get(sessionId) ?? 1) - 1
  if (remaining > 0) {
    activeChatRefs.set(sessionId, remaining)
    return
  }

  activeChatRefs.delete(sessionId)
  activeChats.delete(sessionId)
}

export function registerApprovalHandler(bot: Bot): void {
  detachTelegramApprovalRequestListener?.()
  const detachRequest = eventBus.on("approval.request", async ({ approvalId, runId, parentRunId, subSessionId, agentId, teamId, toolName, params, kind = "approval", guidance, riskSummary, expiresAt, resolve }) => {
    const run = getRootRun(runId)
    if (run?.source !== "telegram") {
      return
    }
    const target = (run ? activeChats.get(run.sessionId) : undefined) ?? latestActiveChat

    if (target === undefined) {
      log.warn(`approval.request for runId=${runId} but no active chat`)
      return
    }

    const observedAt = Date.now()
    const paramsStr = JSON.stringify(params, null, 2).slice(0, 300)
    const existing = pending.get(runId)
    const aggregated = appendApprovalAggregateItem(existing?.context, {
      ...(approvalId ? { approvalId } : {}),
      runId,
      ...(parentRunId ? { parentRunId } : {}),
      ...(subSessionId ? { subSessionId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(teamId ? { teamId } : {}),
      toolName,
      kind,
      ...(riskSummary ? { riskSummary } : {}),
      ...(guidance ? { guidance } : {}),
      paramsPreview: paramsStr,
      resolve,
    }, target.userId, observedAt)
    const text = buildApprovalAggregateText({ context: aggregated.context, channel: "telegram" })

    let sentMsgId = existing?.messageId

    try {
      const keyboard = buildApprovalKeyboard(runId)
      const sendOpts =
        target.threadId !== undefined
          ? { reply_markup: keyboard, message_thread_id: target.threadId }
          : { reply_markup: keyboard }

      if (existing) {
        await bot.api.editMessageText(existing.chatId, existing.messageId, text, { reply_markup: keyboard })
      } else {
        const msg = await bot.api.sendMessage(target.chatId, text, sendOpts)
        sentMsgId = msg.message_id
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to send approval message: ${errMsg}`)
      return
    }

    if (approvalId && sentMsgId !== undefined) {
      attachApprovalChannelMessage(approvalId, telegramApprovalChannelMessageId(target.chatId, target.threadId, sentMsgId))
    }

    const timeout = existing?.timeout ?? (kind === "screen_confirmation"
      ? null
      : setTimeout(() => {
        const entry = pending.get(runId)
        if (!entry) return
        pending.delete(runId)
        const resolvedItems = resolveApprovalAggregate(entry.context, "deny", "timeout")
        for (const item of resolvedItems) {
          eventBus.emit("approval.resolved", { ...(item.approvalId ? { approvalId: item.approvalId } : {}), runId, decision: "deny", toolName: item.toolName, kind: item.kind, reason: "timeout" })
        }
      }, expiresAt ? Math.max(0, expiresAt - Date.now()) : 60_000))

    pending.set(runId, {
      context: aggregated.context,
      chatId: target.chatId,
      messageId: sentMsgId ?? 0,
      requesterId: target.userId,
      timeout,
    })
    if (existing && aggregated.appended && aggregated.aggregationLatencyMs !== null) {
      recordLatencyMetric({
        name: "approval_aggregation_latency_ms",
        durationMs: aggregated.aggregationLatencyMs,
        runId,
        sessionId: run.sessionId,
        detail: {
          channel: "telegram",
          approvalCount: aggregated.context.items.length,
          toolName,
          kind,
          approvalId: approvalId ?? null,
        },
      })
    }
    recordMessageLedgerEvent({
      runId,
      ...(parentRunId ? { parentRunId } : {}),
      ...(subSessionId ? { subSessionId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(teamId ? { teamId } : {}),
      channel: "telegram",
      eventKind: existing ? "approval_aggregated" : "approval_requested",
      deliveryKind: "approval",
      status: "pending",
      summary: existing ? "Telegram 승인 요청을 기존 pending 항목에 집계했습니다." : "Telegram 승인 요청을 전송했습니다.",
      detail: {
        approvalId: approvalId ?? null,
        approvalCount: aggregated.context.items.length,
        aggregationLatencyMs: aggregated.aggregationLatencyMs,
        toolName,
        kind,
        riskSummary: riskSummary ?? null,
      },
    })
  })
  const detachResolved = eventBus.on("approval.resolved", ({ runId }) => {
    const entry = pending.get(runId)
    if (entry?.timeout) clearTimeout(entry.timeout)
    pending.delete(runId)
  })
  detachTelegramApprovalRequestListener = () => {
    detachRequest()
    detachResolved()
  }

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data
    const from = ctx.from

    if (data === "noop") {
      await ctx.answerCallbackQuery()
      return
    }

    const approveOnceMatch = /^approve:([^:]+):once$/.exec(data)
    const approveAllMatch = /^approve:([^:]+):all$/.exec(data)
    const denyMatch = /^deny:([^:]+)$/.exec(data)

    const runId = approveOnceMatch?.[1] ?? approveAllMatch?.[1] ?? denyMatch?.[1]
    if (runId === undefined) {
      await ctx.answerCallbackQuery()
      return
    }

    const entry = pending.get(runId)
    if (entry === undefined) {
      const lateMessage = describeLateApproval(getLatestApprovalForRun(runId))
      await ctx.answerCallbackQuery(lateMessage.startsWith("처리할 승인 요청을 찾을 수 없습니다.") ? "이미 처리된 요청입니다." : lateMessage)
      return
    }

    if (from.id !== entry.requesterId) {
      await ctx.answerCallbackQuery("⚠️ 권한 없음: 요청자만 응답할 수 있습니다.")
      return
    }

    if (entry.timeout) clearTimeout(entry.timeout)
    pending.delete(runId)

    const decision: ApprovalDecision =
      approveAllMatch !== null
        ? "allow_run"
        : approveOnceMatch !== null
          ? "allow_once"
          : "deny"
    const primary = entry.context.items[0]
    const primaryKind = primary?.kind ?? "approval"
    const username = from.first_name ?? from.username ?? String(from.id)
    const resultLabel =
      primaryKind === "screen_confirmation"
        ? decision === "allow_run"
          ? `✅ ${username}이 준비 완료 후 전체 진행`
          : decision === "allow_once"
            ? `🔹 ${username}이 이번 단계 진행 확인`
            : `❌ ${username}이 준비 미완료로 요청 취소`
        : decision === "allow_run"
          ? `✅ ${username}이 이 요청 전체를 승인함`
          : decision === "allow_once"
            ? `🔹 ${username}이 이번 단계만 승인함`
            : `❌ ${username}이 거부하고 요청을 취소함`

    try {
      await bot.api.editMessageReplyMarkup(entry.chatId, entry.messageId, {
        reply_markup: buildResultKeyboard(resultLabel),
      })
    } catch {
      // best-effort
    }

    await ctx.answerCallbackQuery(
      primaryKind === "screen_confirmation"
        ? decision === "allow_run"
          ? "✅ 준비 완료 후 전체 진행"
          : decision === "allow_once"
            ? "🔹 이번 단계 진행"
            : "❌ 준비 미완료, 취소"
        : decision === "allow_run"
          ? "✅ 이 요청 전체 승인"
          : decision === "allow_once"
            ? "🔹 이번 단계 승인"
            : "❌ 거부 후 취소",
    )
    const resolvedItems = resolveApprovalAggregate(entry.context, decision, "user")
    for (const item of resolvedItems) {
      eventBus.emit("approval.resolved", { ...(item.approvalId ? { approvalId: item.approvalId } : {}), runId, decision, toolName: item.toolName, kind: item.kind, reason: "user" })
    }
  })
}

export function resetTelegramApprovalStateForTest(): void {
  detachTelegramApprovalRequestListener?.()
  detachTelegramApprovalRequestListener = null
  for (const entry of pending.values()) {
    if (entry.timeout) clearTimeout(entry.timeout)
  }
  pending.clear()
  activeChats.clear()
  activeChatRefs.clear()
  latestActiveChat = undefined
}

function telegramApprovalChannelMessageId(chatId: number, threadId: number | undefined, messageId: number): string {
  return `telegram:${chatId}:${threadId ?? "main"}:${messageId}`
}
