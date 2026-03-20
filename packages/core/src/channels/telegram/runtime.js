let activeTelegramChannel = null;
let lastTelegramRuntimeError = null;
export function setActiveTelegramChannel(channel) {
    activeTelegramChannel = channel;
    if (channel) {
        lastTelegramRuntimeError = null;
    }
}
export function getActiveTelegramChannel() {
    return activeTelegramChannel;
}
export function setTelegramRuntimeError(message) {
    lastTelegramRuntimeError = message;
}
export function getTelegramRuntimeError() {
    return lastTelegramRuntimeError;
}
export function stopActiveTelegramChannel() {
    if (!activeTelegramChannel)
        return;
    activeTelegramChannel.stop();
    activeTelegramChannel = null;
}
//# sourceMappingURL=runtime.js.map