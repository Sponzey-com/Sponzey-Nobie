import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { MqttRuntimePanel } from "../packages/webui/src/components/setup/MqttRuntimePanel.tsx"
import type { MqttRuntimeResponse } from "../packages/webui/src/api/client.ts"

function legacyRuntime(): MqttRuntimeResponse {
  return {
    extensions: [
      {
        extensionId: "yeonjang-main",
        clientId: "client-main",
        displayName: "연장 메인",
        state: "online",
        message: "connected",
        version: "0.2.5",
        protocolVersion: "1",
        platform: "macos",
        arch: "aarch64",
        transport: ["mqtt"],
        capabilityHash: "abc123def456",
        methods: undefined as unknown as string[],
        methodCount: 7,
        lastSeenAt: Date.UTC(2026, 4, 18, 7, 0, 0),
      },
    ],
    logs: [],
  }
}

describe("task006 mqtt runtime panel", () => {
  it("renders without crashing when runtime snapshots only provide methodCount", () => {
    const html = renderToStaticMarkup(
      createElement(MqttRuntimePanel, {
        runtime: legacyRuntime(),
        loading: false,
        error: "",
        disconnectingExtensionId: null,
        onRefresh: () => undefined,
        onDisconnect: () => undefined,
      }),
    )

    expect(html).toContain("연장 메인")
    expect(html).toContain("메서드 수")
    expect(html).toContain("7")
  })
})
