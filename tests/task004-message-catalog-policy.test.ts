import { describe, expect, it } from "vitest"
import {
  UI_MESSAGE_CATALOG,
  assertUiMessageCatalogCoverage,
  buildUiErrorPresentation,
  findDisallowedUiTerms,
} from "../packages/core/src/ui/message-catalog.ts"
import { buildUiViewModels, type UiShellDomainState } from "../packages/core/src/ui/view-model.ts"
import {
  WEB_UI_MESSAGE_CATALOG,
  assertWebUiMessageCatalogCoverage,
  findBeginnerBlockedTerms,
  formatWebUiErrorMessage,
  uiCatalogText,
} from "../packages/webui/src/lib/message-catalog.js"
import { mapChatErrorMessage } from "../packages/webui/src/lib/chat-errors.js"

function domainState(overrides: Partial<UiShellDomainState> = {}): UiShellDomainState {
  return {
    generatedAt: 1_776_489_600_000,
    mode: {
      mode: "beginner",
      preferredUiMode: "beginner",
      availableModes: ["beginner", "advanced"],
      adminEnabled: false,
      canSwitchInUi: true,
      schemaVersion: 1,
    },
    setupState: { completed: false },
    runtimeHealth: {
      ai: { configured: false, provider: "openai", modelConfigured: false },
      channels: { webui: true, telegramConfigured: true, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
      yeonjang: { mqttEnabled: true, connectedExtensions: 0 },
    },
    activeRuns: { total: 3, pendingApprovals: 1 },
    ...overrides,
  }
}

describe("task004 message catalog and wording policy", () => {
  it("keeps core and WebUI catalog entries covered for Korean and English", () => {
    expect(() => assertUiMessageCatalogCoverage()).not.toThrow()
    expect(() => assertWebUiMessageCatalogCoverage()).not.toThrow()
  })

  it("keeps beginner-facing catalog text free of developer terms", () => {
    for (const [key, entry] of Object.entries(UI_MESSAGE_CATALOG)) {
      for (const text of Object.values(entry)) {
        expect(findDisallowedUiTerms("beginner", text), key).toEqual([])
      }
    }

    for (const [key, entry] of Object.entries(WEB_UI_MESSAGE_CATALOG)) {
      for (const text of Object.values(entry)) {
        expect(findBeginnerBlockedTerms(text), key).toEqual([])
      }
    }

    expect(uiCatalogText("en", "beginner.tasks.title")).toBe("Work review")
    expect(uiCatalogText("en", "layout.activeRuns", { count: 2 })).toBe("active work 2")
  })

  it("builds beginner view models without internal terms or raw diagnostic strings", () => {
    const models = buildUiViewModels(domainState())
    const beginner = JSON.stringify(models.beginner)
    const advanced = JSON.stringify(models.advanced)

    expect(findDisallowedUiTerms("beginner", beginner)).toEqual([])
    expect(beginner).not.toMatch(/<!doctype|<html|Bearer|sk-|xox|stack trace/i)
    expect(findDisallowedUiTerms("advanced", advanced)).toEqual([])
  })

  it("turns raw 403 HTML errors into user-safe text plus diagnostic codes", () => {
    const raw = "<!doctype html><html><title>403 Forbidden</title><body>Cloudflare challenge Bearer sk-task004-secret-1234567890</body></html>"
    const core = buildUiErrorPresentation({ rawError: raw, mode: "beginner" })
    const web = formatWebUiErrorMessage(raw, "ko")

    expect(core.diagnosticCode).toBe("ERR_ACCESS_BLOCKED")
    expect(core.summary).toContain("인증 또는 접근 차단")
    expect(`${core.title} ${core.summary} ${core.nextAction}`).not.toMatch(/<!doctype|<html|Cloudflare|Bearer|sk-task004/i)

    expect(web).toEqual(expect.objectContaining({ diagnosticCode: "ERR_ACCESS_BLOCKED", repeated: false }))
    expect(web.message).toContain("AI 인증 또는 권한")
    expect(web.message).not.toMatch(/<!doctype|<html|Cloudflare|Bearer|sk-task004/i)
    expect(mapChatErrorMessage(raw, "ko")).toBe(web.message)
  })

  it("escalates repeated failures without exposing the failed raw path", () => {
    const raw = "AI error: stack trace at runId=abc raw path /Users/example/private.txt"
    const core = buildUiErrorPresentation({ rawError: raw, mode: "advanced", repeatCount: 2 })
    const web = formatWebUiErrorMessage(raw, "ko", 2)

    expect(core).toEqual(expect.objectContaining({ title: "자세히 확인 필요", severity: "needs_attention", repeated: true }))
    expect(core.nextAction).toContain("같은 문제가 반복")
    expect(JSON.stringify(core)).not.toContain("/Users/example/private.txt")

    expect(web).toEqual(expect.objectContaining({ diagnosticCode: "ERR_REPEATED_FAILURE", repeated: true }))
    expect(web.message).toContain("같은 문제가 반복")
    expect(web.message).not.toMatch(/runId|raw path|\/Users/i)
  })

  it("allows admin diagnostics but still redacts secrets from raw payloads", () => {
    const raw = "AI error: 403 Forbidden Bearer sk-task004-admin-secret-1234567890"
    const admin = buildUiErrorPresentation({ rawError: raw, mode: "admin" })
    const serialized = JSON.stringify(admin)

    expect(admin.title).toBe("Admin diagnostic error")
    expect(admin.diagnosticCode).toBe("ERR_ACCESS_BLOCKED")
    expect(admin.admin).toEqual(expect.objectContaining({ kind: "access_blocked" }))
    expect(serialized).not.toContain("sk-task004-admin-secret")
  })
})
