import type { TelegramConfig } from "../../config/types.js"
import type { ChannelRoom } from "../contracts.js"

export function telegramAllowedRoomIdsForChatType(
  chatType: string,
  allowedGroupIds: number[],
): number[] {
  return chatType === "private" ? [] : allowedGroupIds
}

export function telegramRoomTypeForChatType(chatType: string): NonNullable<ChannelRoom["type"]> {
  if (chatType === "private") return "direct"
  if (chatType === "group" || chatType === "supergroup") return "group"
  if (chatType === "channel") return "channel"
  return "unknown"
}

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
