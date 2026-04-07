import { describe, expect, it } from "vitest"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "../packages/webui/src/lib/single-ai.js"
import type { SetupDraft } from "../packages/webui/src/contracts/setup.js"

function makeDraft(): SetupDraft {
  return {
    personal: {
      profileName: "tester",
      displayName: "Tester",
      language: "ko",
      timezone: "Asia/Seoul",
      workspace: "/tmp",
    },
    aiBackends: [
      {
        id: "provider:openai",
        label: "OpenAI",
        kind: "provider",
        providerType: "openai",
        authMode: "api_key",
        credentials: {},
        local: false,
        enabled: false,
        availableModels: [],
        defaultModel: "",
        status: "planned",
        summary: "",
        tags: [],
      },
      {
        id: "provider:gemini",
        label: "Gemini",
        kind: "provider",
        providerType: "gemini",
        authMode: "api_key",
        credentials: {},
        local: false,
        enabled: false,
        availableModels: [],
        defaultModel: "",
        status: "planned",
        summary: "",
        tags: [],
      },
    ],
    routingProfiles: [
      { id: "default", label: "Default", targets: [] },
      { id: "general_chat", label: "General", targets: [] },
    ],
    mcp: { servers: [] },
    skills: { items: [] },
    security: {
      approvalMode: "on-miss",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny",
      maxDelegationTurns: 5,
    },
    channels: {
      telegramEnabled: false,
      botToken: "",
      allowedUserIds: "",
      allowedGroupIds: "",
    },
    mqtt: {
      enabled: false,
      host: "127.0.0.1",
      port: 1883,
      username: "",
      password: "",
    },
    remoteAccess: {
      authEnabled: false,
      authToken: "",
      host: "127.0.0.1",
      port: 18888,
    },
  }
}

describe("webui single ai helper", () => {
  it("chooses the enabled backend first", () => {
    const draft = makeDraft()
    draft.aiBackends[1]!.enabled = true
    expect(getPreferredSingleAiBackendId(draft.aiBackends)).toBe("provider:gemini")
  })

  it("enables only one backend and syncs routing targets", () => {
    const draft = makeDraft()
    const next = setSingleAiBackendEnabled(draft, "provider:openai", true)
    expect(next.aiBackends.map((backend) => [backend.id, backend.enabled])).toEqual([
      ["provider:openai", true],
      ["provider:gemini", false],
    ])
    expect(next.routingProfiles.map((profile) => profile.targets)).toEqual([
      ["provider:openai"],
      ["provider:openai"],
    ])
  })
})
