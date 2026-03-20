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