let discordRuntimeRunning = false;
let lastDiscordRuntimeError = null;
let lastDiscordRuntimeStartedAt = null;
let lastDiscordRuntimeStoppedAt = null;
let lastDiscordRuntimeErrorAt = null;
export function setDiscordRuntimeRunning(running) {
    discordRuntimeRunning = running;
    if (running) {
        lastDiscordRuntimeStartedAt = Date.now();
        lastDiscordRuntimeError = null;
        lastDiscordRuntimeErrorAt = null;
    }
    else {
        lastDiscordRuntimeStoppedAt = Date.now();
    }
}
export function setDiscordRuntimeError(message) {
    lastDiscordRuntimeError = message;
    lastDiscordRuntimeErrorAt = message ? Date.now() : null;
}
export function getDiscordRuntimeError() {
    return lastDiscordRuntimeError;
}
export function getDiscordRuntimeStatus() {
    return {
        isRunning: discordRuntimeRunning,
        lastStartedAt: lastDiscordRuntimeStartedAt,
        lastStoppedAt: lastDiscordRuntimeStoppedAt,
        lastError: lastDiscordRuntimeError,
        lastErrorAt: lastDiscordRuntimeErrorAt,
    };
}
export function stopDiscordRuntime() {
    if (!discordRuntimeRunning)
        return;
    discordRuntimeRunning = false;
    lastDiscordRuntimeStoppedAt = Date.now();
}
//# sourceMappingURL=runtime.js.map