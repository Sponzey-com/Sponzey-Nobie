import type { Bot } from "grammy"
import { eventBus } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { buildApprovalKeyboard, buildResultKeyboard } from "./keyboards.js"

const log = createLogger("channel:telegram:approval")

interface PendingApproval {
  resolve: (decision: "allow" | "deny") => void
  chatId: number
  messageId: number
  requesterId: number
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

// Most recent active chat (for single-user cases when we don't have sessionId in event)
let latestActiveChat: ActiveChat | undefined

export function setActiveChatForSession(
  sessionId: string,
  chatId: number,
  userId: number,
  threadId?: number | undefined,
): void {
  const chat: ActiveChat = { chatId, userId, ...(threadId !== undefined ? { threadId } : {}) }
  activeChats.set(sessionId, chat)
  latestActiveChat = chat
}

export function clearActiveChatForSession(sessionId: string): void {
  activeChats.delete(sessionId)
}

export function registerApprovalHandler(bot: Bot): void {
  eventBus.on("approval.request", async ({ runId, toolName, params, resolve }) => {
    const target = latestActiveChat

    if (target === undefined) {
      log.warn(`approval.request for runId=${runId} but no active chat — auto-denying`)
      resolve("deny")
      return
    }

    const paramsStr = JSON.stringify(params, null, 2).slice(0, 300)
    const text =
      `🔐 *도구 실행 승인 요청*\n\n` +
      `도구: \`${toolName}\`\n` +
      `파라미터:\n\`\`\`\n${paramsStr}\n\`\`\`\n\n` +
      `허용하시겠습니까?`

    let sentMsgId: number

    try {
      const keyboard = buildApprovalKeyboard(runId)
      const sendOpts =
        target.threadId !== undefined
          ? { parse_mode: "Markdown" as const, reply_markup: keyboard, message_thread_id: target.threadId }
          : { parse_mode: "Markdown" as const, reply_markup: keyboard }

      const msg = await bot.api.sendMessage(target.chatId, text, sendOpts)
      sentMsgId = msg.message_id
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to send approval message: ${errMsg}`)
      resolve("deny")
      return
    }

    pending.set(runId, {
      resolve,
      chatId: target.chatId,
      messageId: sentMsgId,
      requesterId: target.userId,
    })

    // 60-second timeout
    const timeout = setTimeout(async () => {
      const entry = pending.get(runId)
      if (entry === undefined) return
      pending.delete(runId)

      log.warn(`Approval timeout for runId=${runId} — auto-denying`)

      try {
        await bot.api.editMessageReplyMarkup(entry.chatId, entry.messageId, {
          reply_markup: buildResultKeyboard(false, "시스템 (타임아웃)"),
        })
      } catch {
        // best-effort
      }

      entry.resolve("deny")
    }, 60_000)

    // Store timeout reference so we can clear it
    const origResolve = resolve
    pending.set(runId, {
      resolve: (decision) => {
        clearTimeout(timeout)
        origResolve(decision)
      },
      chatId: target.chatId,
      messageId: sentMsgId,
      requesterId: target.userId,
    })
  })

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data
    const from = ctx.from

    if (data === "noop") {
      await ctx.answerCallbackQuery()
      return
    }

    const approveMatch = /^approve:([^:]+):once$/.exec(data)
    const denyMatch = /^deny:([^:]+)$/.exec(data)

    const runId = approveMatch?.[1] ?? denyMatch?.[1]
    if (runId === undefined) {
      await ctx.answerCallbackQuery()
      return
    }

    const entry = pending.get(runId)
    if (entry === undefined) {
      await ctx.answerCallbackQuery("이미 처리된 요청입니다.")
      return
    }

    if (from.id !== entry.requesterId) {
      await ctx.answerCallbackQuery("⚠️ 권한 없음: 요청자만 응답할 수 있습니다.")
      return
    }

    pending.delete(runId)

    const approved = approveMatch !== null
    const username = from.first_name ?? from.username ?? String(from.id)

    try {
      await bot.api.editMessageReplyMarkup(entry.chatId, entry.messageId, {
        reply_markup: buildResultKeyboard(approved, username),
      })
    } catch {
      // best-effort
    }

    await ctx.answerCallbackQuery(approved ? "✅ 허용됨" : "❌ 거부됨")
    entry.resolve(approved ? "allow" : "deny")
  })
}
