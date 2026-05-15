let isRunning = false;
let lastStartedAt = null;
let lastStoppedAt = null;
let lastError = null;
let lastErrorAt = null;
export function setGoogleChatRuntimeRunning(running) {
    isRunning = running;
    const now = Date.now();
    if (running)
        lastStartedAt = now;
    else
        lastStoppedAt = now;
}
export function setGoogleChatRuntimeError(error) {
    lastError = error;
    lastErrorAt = error ? Date.now() : null;
}
export function getGoogleChatRuntimeError() {
    return lastError;
}
export function getGoogleChatRuntimeStatus() {
    return {
        isRunning,
        lastStartedAt,
        lastStoppedAt,
        lastError,
        lastErrorAt,
    };
}
export function stopGoogleChatRuntime() {
    setGoogleChatRuntimeRunning(false);
}
//# sourceMappingURL=runtime.js.map