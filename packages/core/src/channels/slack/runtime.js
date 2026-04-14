let activeSlackChannel = null;
let lastSlackRuntimeError = null;
let lastSlackRuntimeStartedAt = null;
let lastSlackRuntimeStoppedAt = null;
let lastSlackRuntimeErrorAt = null;
export function setActiveSlackChannel(channel) {
    activeSlackChannel = channel;
    if (channel) {
        lastSlackRuntimeStartedAt = Date.now();
        lastSlackRuntimeError = null;
        lastSlackRuntimeErrorAt = null;
    }
    else {
        lastSlackRuntimeStoppedAt = Date.now();
    }
}
export function getActiveSlackChannel() {
    return activeSlackChannel;
}
export function setSlackRuntimeError(message) {
    lastSlackRuntimeError = message;
    lastSlackRuntimeErrorAt = message ? Date.now() : null;
}
export function getSlackRuntimeError() {
    return lastSlackRuntimeError;
}
export function getSlackRuntimeStatus() {
    return {
        isRunning: activeSlackChannel !== null,
        lastStartedAt: lastSlackRuntimeStartedAt,
        lastStoppedAt: lastSlackRuntimeStoppedAt,
        lastError: lastSlackRuntimeError,
        lastErrorAt: lastSlackRuntimeErrorAt,
    };
}
export function stopActiveSlackChannel() {
    const channel = activeSlackChannel;
    if (!channel)
        return;
    channel.stop();
    activeSlackChannel = null;
    lastSlackRuntimeStoppedAt = Date.now();
}
//# sourceMappingURL=runtime.js.map