import { InlineKeyboard } from "grammy"

export function buildApprovalKeyboard(runId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ 허용 (1회)", `approve:${runId}:once`)
    .text("❌ 거부", `deny:${runId}`)
}

export function buildResultKeyboard(approved: boolean, username: string): InlineKeyboard {
  const label = approved
    ? `✅ ${username}이 허용함`
    : `❌ ${username}이 거부함`
  return new InlineKeyboard().text(label, "noop")
}
