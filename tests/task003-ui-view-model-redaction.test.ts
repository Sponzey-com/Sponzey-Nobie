import { describe, expect, it } from "vitest"
import { maskSecretsDeep } from "../packages/core/src/config/operations.ts"
import { redactUiValue } from "../packages/core/src/ui/redaction.ts"
import {
  buildAdminUiViewModel,
  buildAdvancedUiViewModel,
  buildBeginnerUiViewModel,
  buildNormalizedUiState,
  buildUiViewModels,
  type UiShellDomainState,
} from "../packages/core/src/ui/view-model.ts"

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
    activeRuns: { total: 2, pendingApprovals: 1 },
    ...overrides,
  }
}

describe("task003 UI view model redaction", () => {
  it("redacts secrets, raw payloads, raw HTML, and local paths before UI mapping", () => {
    const raw = {
      apiKey: "sk-task003-secret-value-1234567890",
      rawBody: "{\"token\":\"xoxb-task003-secret-token-1234567890\"}",
      html: "<!doctype html><html><body>403</body></html>",
      artifactPath: "/Users/dongwooshin/.nobie/artifacts/screens/raw.png",
      visible: "ok",
    }

    const beginner = redactUiValue(raw, { audience: "beginner" })
    const serialized = JSON.stringify(beginner.value)
    expect(serialized).not.toContain("sk-task003-secret")
    expect(serialized).not.toContain("xoxb-task003-secret")
    expect(serialized).not.toContain("<!doctype")
    expect(serialized).not.toContain("/Users/dongwooshin")
    expect(serialized).toContain("artifact:")
    expect(beginner.maskedCount).toBeGreaterThanOrEqual(4)
  })

  it("builds consistent beginner, advanced, and admin view models from the same normalized state", () => {
    const normalized = buildNormalizedUiState(domainState())
    const beginner = buildBeginnerUiViewModel(normalized)
    const advanced = buildAdvancedUiViewModel(normalized)
    const admin = buildAdminUiViewModel(domainState({ mode: { ...domainState().mode, adminEnabled: true, availableModes: ["beginner", "advanced", "admin"] } }), normalized)

    expect(normalized.components.map((component) => component.key)).toEqual(["setup", "ai", "channels", "yeonjang", "tasks"])
    expect(beginner).toEqual(expect.objectContaining({ kind: "beginner", needsAttention: true, statusLabel: "확인 필요" }))
    expect(advanced.components.find((component) => component.key === "ai")).toEqual(expect.objectContaining({
      component: "AI 연결",
      status: "needs_setup",
      configSummary: expect.objectContaining({ provider: "openai", modelConfigured: false }),
    }))
    expect(admin.metrics).toEqual(expect.objectContaining({ activeRuns: 2, pendingApprovals: 1, connectedExtensions: 0 }))
  })

  it("keeps beginner and advanced models free of internal ids, raw JSON, and stack traces", () => {
    const models = buildUiViewModels(domainState({
      runtimeHealth: {
        ai: { configured: false, provider: "openai", modelConfigured: false },
        channels: { webui: true, telegramConfigured: true, telegramEnabled: false, slackConfigured: false, slackEnabled: false },
        yeonjang: { mqttEnabled: true, connectedExtensions: 0 },
      },
    }))

    const beginner = JSON.stringify(models.beginner)
    const advanced = JSON.stringify(models.advanced)
    expect(beginner).not.toMatch(/runId|requestGroupId|sessionId|raw|stack|checksum/i)
    expect(advanced).not.toMatch(/secret|token|<html|stack trace/i)
  })

  it("builds admin sanitizedRaw without leaking secrets", () => {
    const input = domainState({
      mode: {
        mode: "admin",
        preferredUiMode: "advanced",
        availableModes: ["beginner", "advanced", "admin"],
        adminEnabled: true,
        canSwitchInUi: true,
        schemaVersion: 1,
      },
      runtimeHealth: {
        ai: { configured: true, provider: "openai", modelConfigured: true },
        channels: { webui: true, telegramConfigured: true, telegramEnabled: true, slackConfigured: true, slackEnabled: false },
        yeonjang: { mqttEnabled: true, connectedExtensions: 1 },
      },
    })
    const rawWithSecret = { ...input, rawApiBody: "Bearer sk-task003-admin-secret-1234567890", localPath: "/Users/dongwooshin/.nobie/private/log.txt" }
    const normalized = buildNormalizedUiState(input)
    const admin = buildAdminUiViewModel(rawWithSecret as UiShellDomainState, normalized)
    const serialized = JSON.stringify(admin)

    expect(serialized).not.toContain("sk-task003-admin-secret")
    expect(serialized).not.toContain("/Users/dongwooshin/.nobie/private")
    expect(serialized).toContain("sanitizedRaw")
  })

  it("reuses the same redaction contract for config export masking", () => {
    const raw = {
      ai: { auth: { apiKey: "sk-task003-export-secret-1234567890" } },
      providerRawResponse: "<!doctype html><html><body>blocked</body></html>",
      logPath: "/Users/dongwooshin/.nobie/raw/response.html",
      channelId: "C12345",
    }

    expect(maskSecretsDeep(raw).value).toEqual(redactUiValue(raw, { audience: "export" }).value)
    const serialized = JSON.stringify(maskSecretsDeep(raw).value)
    expect(serialized).not.toContain("sk-task003-export-secret")
    expect(serialized).not.toContain("<!doctype")
    expect(serialized).toContain("C12345")
  })
})
