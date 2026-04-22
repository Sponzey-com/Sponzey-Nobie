import { createElement } from "../packages/webui/node_modules/react/index.js"
import { describe, expect, it } from "vitest"
import type { SetupDraft, SetupStepMeta } from "../packages/webui/src/contracts/setup.ts"
import { SetupStepShell } from "../packages/webui/src/components/setup/SetupStepShell.tsx"
import {
  isSetupStepDirty,
  mergeSetupStepDraft,
  revertSetupStepDraft,
} from "../packages/webui/src/lib/setupFlow.ts"
import {
  normalizeBeginnerConnectionVisualizationStatus,
  normalizeBeginnerSetupVisualizationStatus,
  normalizeCapabilityVisualizationStatus,
  type VisualizationScene,
} from "../packages/webui/src/lib/setup-visualization.ts"

function draft(): SetupDraft {
  return {
    personal: {
      profileName: "dongwoo",
      displayName: "Dongwoo",
      language: "ko",
      timezone: "Asia/Seoul",
      workspace: "/Users/dongwoo/work",
    },
    aiBackends: [
      {
        id: "provider:openai",
        label: "OpenAI",
        kind: "provider",
        providerType: "openai",
        authMode: "api_key",
        credentials: { apiKey: "sk-live" },
        local: false,
        enabled: true,
        availableModels: ["gpt-5.4"],
        defaultModel: "gpt-5.4",
        status: "ready",
        summary: "primary",
        tags: ["primary"],
        endpoint: "https://api.openai.com/v1",
      },
    ],
    routingProfiles: [{ id: "default", label: "Default", targets: ["provider:openai"] }],
    mcp: { servers: [] },
    skills: { items: [] },
    security: {
      approvalMode: "on-miss",
      approvalTimeout: 60,
      approvalTimeoutFallback: "deny",
      maxDelegationTurns: 5,
    },
    channels: {
      telegramEnabled: true,
      botToken: "123:token",
      allowedUserIds: "1,2",
      allowedGroupIds: "",
      slackEnabled: false,
      slackBotToken: "",
      slackAppToken: "",
      slackAllowedUserIds: "",
      slackAllowedChannelIds: "",
    },
    mqtt: {
      enabled: true,
      host: "0.0.0.0",
      port: 1883,
      username: "mqtt-user",
      password: "mqtt-pass",
    },
    remoteAccess: {
      authEnabled: true,
      authToken: "secret-token",
      host: "127.0.0.1",
      port: 18888,
    },
  }
}

function steps(): SetupStepMeta[] {
  return [
    {
      id: "welcome",
      label: "Welcome",
      description: "Start here",
      status: "ready",
      required: false,
      highlights: [],
      completed: true,
      locked: false,
    },
    {
      id: "personal",
      label: "Personal",
      description: "Profile",
      status: "ready",
      required: true,
      highlights: [],
      completed: false,
      locked: false,
    },
  ]
}

function visitNode(node: unknown, visit: (candidate: Record<string, unknown>) => void) {
  if (node == null || typeof node === "boolean") return

  if (Array.isArray(node)) {
    for (const item of node) {
      visitNode(item, visit)
    }
    return
  }

  if (typeof node === "object" && "props" in node) {
    const candidate = node as Record<string, unknown>
    visit(candidate)
    const props = candidate.props
    if (props && typeof props === "object" && "children" in props) {
      visitNode((props as Record<string, unknown>).children, visit)
    }
  }
}

function findSlotNames(node: unknown): string[] {
  const slots: string[] = []

  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    const slot = (props as Record<string, unknown>)["data-setup-slot"]
    if (typeof slot === "string") {
      slots.push(slot)
    }
  })

  return slots
}

function findClassNames(node: unknown): string[] {
  const classNames: string[] = []

  visitNode(node, (candidate) => {
    const props = candidate.props
    if (!props || typeof props !== "object") return
    const className = (props as Record<string, unknown>).className
    if (typeof className === "string") {
      classNames.push(className)
    }
  })

  return classNames
}

function collectText(node: unknown): string[] {
  const values: string[] = []

  const visitText = (candidate: unknown) => {
    if (candidate == null || typeof candidate === "boolean") return
    if (typeof candidate === "string" || typeof candidate === "number") {
      values.push(String(candidate))
      return
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visitText(item)
      }
      return
    }
    if (typeof candidate === "object" && "props" in candidate) {
      const props = (candidate as { props?: Record<string, unknown> }).props
      if (props && "children" in props) {
        visitText(props.children)
      }
    }
  }

  visitText(node)
  return values
}

describe("task001 visualization foundation", () => {
  it("normalizes current capability and beginner statuses into shared visualization statuses", () => {
    const scene = {
      id: "scene:welcome",
      label: "Welcome",
      mode: "shared",
      semanticStepIds: ["welcome"],
      nodes: [
        {
          id: "node:profile",
          kind: "profile",
          label: "Profile",
          status: normalizeCapabilityVisualizationStatus("planned"),
          badges: ["Personal"],
          semanticStepIds: ["personal"],
        },
      ],
      edges: [
        {
          id: "edge:profile:ai",
          from: "node:profile",
          to: "node:ai",
          kind: "flow",
          semanticStepIds: ["personal", "ai_backends"],
        },
      ],
    } satisfies VisualizationScene

    expect(scene.semanticStepIds).toEqual(["welcome"])
    expect(scene.nodes[0]?.status).toBe("planned")
    expect(normalizeCapabilityVisualizationStatus("ready")).toBe("ready")
    expect(normalizeCapabilityVisualizationStatus("disabled")).toBe("disabled")
    expect(normalizeCapabilityVisualizationStatus("error")).toBe("error")
    expect(normalizeBeginnerSetupVisualizationStatus("done")).toBe("ready")
    expect(normalizeBeginnerSetupVisualizationStatus("needs_attention")).toBe("warning")
    expect(normalizeBeginnerSetupVisualizationStatus("skipped")).toBe("disabled")
    expect(normalizeBeginnerConnectionVisualizationStatus("ready")).toBe("ready")
    expect(normalizeBeginnerConnectionVisualizationStatus("needs_attention")).toBe("warning")
    expect(normalizeBeginnerConnectionVisualizationStatus("idle")).toBe("disabled")
  })

  it("extends SetupStepShell with non-breaking visualization slots", () => {
    const tree = SetupStepShell({
      title: "Initial Setup",
      description: "Configure Nobie",
      steps: steps(),
      currentStep: "personal",
      onSelectStep: () => undefined,
      language: "en",
      legend: createElement("div", null, "Legend"),
      canvas: createElement("div", null, "Canvas"),
      inspector: createElement("div", null, "Inspector"),
      mobileInspector: createElement("div", null, "Inspector mobile"),
      assistPanel: createElement("div", null, "Assist"),
      footer: createElement("div", null, "Footer"),
      children: createElement("div", null, "Body"),
    })

    expect(findSlotNames(tree)).toEqual([
      "legend",
      "canvas",
      "content",
      "inspector-mobile",
      "inspector",
      "assist-panel",
    ])
    expect(findClassNames(tree).some((value) => value.includes("xl:right-[360px]"))).toBe(true)
    expect(collectText(tree)).toEqual(expect.arrayContaining([
      "Legend",
      "Canvas",
      "Inspector",
      "Inspector mobile",
      "Assist",
      "Body",
      "Footer",
    ]))
  })

  it("keeps SetupStepShell body-only rendering unchanged when slots are absent", () => {
    const tree = SetupStepShell({
      title: "Initial Setup",
      description: "Configure Nobie",
      steps: steps(),
      currentStep: "welcome",
      onSelectStep: () => undefined,
      language: "en",
      footer: createElement("div", null, "Footer"),
      children: createElement("div", null, "Body only"),
    })

    expect(findSlotNames(tree)).toEqual([])
    expect(findClassNames(tree).some((value) => value.includes("xl:right-0"))).toBe(true)
    expect(collectText(tree)).toContain("Body only")
  })

  it("preserves step-scoped dirty, merge, and revert semantics", () => {
    const savedDraft = draft()
    const localDraft = {
      ...draft(),
      channels: {
        ...draft().channels,
        allowedUserIds: "1,2,3",
      },
      mqtt: {
        ...draft().mqtt,
        host: "broker.internal",
        username: "changed-user",
      },
      remoteAccess: {
        ...draft().remoteAccess,
        host: "10.0.0.9",
        port: 19999,
      },
    }

    expect(isSetupStepDirty(savedDraft, localDraft, "channels")).toBe(true)
    expect(isSetupStepDirty(savedDraft, localDraft, "remote_access")).toBe(true)
    expect(isSetupStepDirty(savedDraft, localDraft, "personal")).toBe(false)

    const mergedRemoteAccess = mergeSetupStepDraft(savedDraft, localDraft, "remote_access")
    expect(mergedRemoteAccess.remoteAccess.host).toBe("10.0.0.9")
    expect(mergedRemoteAccess.remoteAccess.port).toBe(19999)
    expect(mergedRemoteAccess.mqtt.host).toBe("broker.internal")
    expect(mergedRemoteAccess.mqtt.username).toBe("changed-user")
    expect(mergedRemoteAccess.channels.allowedUserIds).toBe(savedDraft.channels.allowedUserIds)

    const revertedRemoteAccess = revertSetupStepDraft(localDraft, savedDraft, "remote_access")
    expect(revertedRemoteAccess.remoteAccess.host).toBe(savedDraft.remoteAccess.host)
    expect(revertedRemoteAccess.remoteAccess.port).toBe(savedDraft.remoteAccess.port)
    expect(revertedRemoteAccess.mqtt.host).toBe(savedDraft.mqtt.host)
    expect(revertedRemoteAccess.mqtt.username).toBe(savedDraft.mqtt.username)
    expect(revertedRemoteAccess.channels.allowedUserIds).toBe("1,2,3")
  })
})
