export function telegramAllowedRoomIdsForChatType(chatType, allowedGroupIds) {
    return chatType === "private" ? [] : allowedGroupIds;
}
export function telegramRoomTypeForChatType(chatType) {
    if (chatType === "private")
        return "direct";
    if (chatType === "group" || chatType === "supergroup")
        return "group";
    if (chatType === "channel")
        return "channel";
    return "unknown";
}
export function isAllowedUser(userId, chatType, chatId, config) {
    if (config.allowedUserIds.length === 0) {
        return false;
    }
    if (chatType === "private") {
        return config.allowedUserIds.includes(userId);
    }
    if (chatType === "group" || chatType === "supergroup") {
        return (config.allowedGroupIds.includes(chatId) &&
            config.allowedUserIds.includes(userId));
    }
    return false;
}
//# sourceMappingURL=auth.js.map
