import type { Bot } from "grammy"
import type { TelegramChannel } from "./bot.js"

export function registerCommands(bot: Bot, channel: TelegramChannel): void {
  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "there"
    await ctx.reply(
      `👋 Hello, ${name}! I'm SidekickSponzey, your personal AI assistant.\n\n` +
      `You can send me any message and I'll do my best to help.\n\n` +
      `Available commands:\n` +
      `/start — Show this welcome message\n` +
      `/new — Start a new conversation session\n` +
      `/cancel — Cancel the current running task\n` +
      `/status — Show current session status\n` +
      `/help — Show all commands`,
    )
  })

  bot.command("new", async (ctx) => {
    const chat = ctx.chat
    const message = ctx.message
    const threadId = message?.message_thread_id
    const sessionKey = channel.getSessionKey(chat.id, threadId)
    channel.newSession(sessionKey)
    await ctx.reply("🆕 New session started! Previous conversation history has been cleared.")
  })

  bot.command("cancel", async (ctx) => {
    const chat = ctx.chat
    const message = ctx.message
    const threadId = message?.message_thread_id
    const sessionKey = channel.getSessionKey(chat.id, threadId)
    const aborted = channel.abortSession(sessionKey)
    if (aborted) {
      await ctx.reply("🛑 Current task has been cancelled.")
    } else {
      await ctx.reply("ℹ️ No task is currently running.")
    }
  })

  bot.command("status", async (ctx) => {
    const chat = ctx.chat
    const message = ctx.message
    const threadId = message?.message_thread_id
    const sessionKey = channel.getSessionKey(chat.id, threadId)
    const status = channel.getSessionStatus(sessionKey)
    await ctx.reply(
      `📊 *Session Status*\n\n` +
      `Session Key: \`${sessionKey}\`\n` +
      `Session ID: \`${status.sessionId ?? "none"}\`\n` +
      `Running: ${status.running ? "✅ Yes" : "❌ No"}\n` +
      `Active Tasks: ${channel.getRunningCount()}`,
      { parse_mode: "Markdown" },
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `🤖 *SidekickSponzey Commands*\n\n` +
      `/start — Show welcome message and usage\n` +
      `/new — Start a new session (clears history)\n` +
      `/cancel — Cancel the currently running task\n` +
      `/status — Show session ID and running status\n` +
      `/help — Show this help message\n\n` +
      `Just send any text message to chat with the AI!`,
      { parse_mode: "Markdown" },
    )
  })
}
