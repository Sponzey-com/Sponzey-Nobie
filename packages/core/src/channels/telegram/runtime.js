let activeTelegramChannel = null;
let lastTelegramRuntimeError = null;
let lastTelegramRuntimeStartedAt = null;
let lastTelegramRuntimeStoppedAt = null;
let lastTelegramRuntimeErrorAt = null;
export function setActiveTelegramChannel(channel) {
    activeTelegramChannel = channel;
    if (channel) {
        lastTelegramRuntimeStartedAt = Date.now();
        lastTelegramRuntimeError = null;
        lastTelegramRuntimeErrorAt = null;
    }
    else {
        lastTelegramRuntimeStoppedAt = Date.now();
    }
}
export function getActiveTelegramChannel() {
    return activeTelegramChannel;
}
export function setTelegramRuntimeError(message) {
    lastTelegramRuntimeError = message;
    lastTelegramRuntimeErrorAt = message ? Date.now() : null;
}
export function getTelegramRuntimeError() {
    return lastTelegramRuntimeError;
}
export function getTelegramRuntimeStatus() {
    return {
        isRunning: activeTelegramChannel !== null,
        lastStartedAt: lastTelegramRuntimeStartedAt,
        lastStoppedAt: lastTelegramRuntimeStoppedAt,
        lastError: lastTelegramRuntimeError,
        lastErrorAt: lastTelegramRuntimeErrorAt,
    };
}
export function stopActiveTelegramChannel() {
    const channel = activeTelegramChannel;
    if (!channel)
        return;
    channel.stop();
    activeTelegramChannel = null;
    lastTelegramRuntimeStoppedAt = Date.now();
}
//# sourceMappingURL=runtime.js.map