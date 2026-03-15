import type { TelegramConfig } from "../../config/types.js"

export function isAllowedUser(
  userId: number,
  chatType: string,
  chatId: number,
  config: TelegramConfig,
): boolean {
  if (config.allowedUserIds.length === 0) {
    return false
  }

  if (chatType === "private") {
    return config.allowedUserIds.includes(userId)
  }

  if (chatType === "group" || chatType === "supergroup") {
    return (
      config.allowedGroupIds.includes(chatId) &&
      config.allowedUserIds.includes(userId)
    )
  }

  return false
}
