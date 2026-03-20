const TYPING_INTERVAL_MS = 15_000;
export class TypingIndicator {
    sendAction;
    intervalId = null;
    constructor(sendAction) {
        this.sendAction = sendAction;
    }
    start() {
        void this.sendAction().catch(() => undefined);
        this.intervalId = setInterval(() => {
            void this.sendAction().catch(() => undefined);
        }, TYPING_INTERVAL_MS);
    }
    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
//# sourceMappingURL=typing.js.map