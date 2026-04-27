import { describe, expect, it } from "vitest"
import { sanitizeOperationalCounterText, translateDisplayText } from "../packages/webui/src/lib/ui-i18n.js"

describe("webui ui i18n display text", () => {
  it("hides operational retry and follow-up counters from user-facing text", () => {
    expect(sanitizeOperationalCounterText("실행 복구 재시도 2/5")).toBe("실행 복구 처리")
    expect(sanitizeOperationalCounterText("중간 절단 복구 재시도 1/무제한")).toBe("중간 절단 복구 처리")
    expect(sanitizeOperationalCounterText("후속 처리 3/5")).toBe("자동 후속 처리")
    expect(sanitizeOperationalCounterText("복구 재시도 한도(5회)에 도달했습니다.")).toBe("자동 복구 한도에 도달했습니다.")
  })

  it("keeps the hidden-counter cleanup before English translation", () => {
    expect(translateDisplayText("en", "실행 복구 재시도 2/5")).toBe("Execution recovery")
    expect(translateDisplayText("en", "후속 처리 3/5")).toBe("Automatic follow-up")
  })
})
