const TYPING_INTERVAL_MS = 15_000

export class TypingIndicator {
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(private sendAction: () => Promise<void>) {}

  start(): void {
    void this.sendAction().catch(() => undefined)

    this.intervalId = setInterval(() => {
      void this.sendAction().catch(() => undefined)
    }, TYPING_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}
