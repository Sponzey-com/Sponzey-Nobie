import { describe, expect, it } from "vitest"
import {
  buildCapabilityFallbackNotice,
  describeUnsupportedCapability,
  resolveChannelDeliveryFallbackPlan,
  splitTextForChannel,
} from "../packages/core/src/channels/delivery-fallback.ts"
import { defineChannelCapabilities, type ChannelCapabilities } from "../packages/core/src/channels/contracts.ts"

function capabilities(patch: Partial<ChannelCapabilities> = {}): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "telegram",
    connectionKind: "bot_api",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: true,
    supportsDeletes: false,
    supportsReactions: false,
    supportsButtons: true,
    supportsModals: false,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: true,
    maxMessageLength: 40,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: false,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "low",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
    ...patch,
  })
}

function message(patch: Partial<Parameters<typeof resolveChannelDeliveryFallbackPlan>[0]["message"]> = {}) {
  return {
    text: "",
    attachments: [],
    actions: [],
    deliveryMode: "text" as const,
    threadPolicy: { mode: "none" as const },
    chunkPolicy: { mode: "provider_default" as const },
    redactionPolicy: "default" as const,
    ...patch,
  }
}

describe("channel delivery fallback", () => {
  it("splits long text according to channel max message length", () => {
    const plan = resolveChannelDeliveryFallbackPlan({
      capabilities: capabilities({ maxMessageLength: 20 }),
      message: message({
        text: "first sentence. second sentence. third sentence.",
        chunkPolicy: { mode: "split", maxLength: 20 },
      }),
    })

    expect(plan.action).toBe("split_text")
    expect(plan.textParts.length).toBeGreaterThan(1)
    expect(plan.textParts.every((part) => part.length <= 20)).toBe(true)
    expect(plan.issues).toHaveLength(0)
  })

  it("uses summarize-and-link when long text policy requests it", () => {
    const plan = resolveChannelDeliveryFallbackPlan({
      capabilities: capabilities({ maxMessageLength: 20 }),
      message: message({
        text: "a".repeat(100),
        chunkPolicy: { mode: "summarize_then_link", maxLength: 20 },
      }),
    })

    expect(plan.action).toBe("summarize_then_link")
    expect(plan.notices.join("\n")).toContain("summary")
  })

  it("falls back from native file delivery to a download link when a channel cannot upload files", () => {
    const plan = resolveChannelDeliveryFallbackPlan({
      capabilities: capabilities({ supportsFiles: false }),
      message: message({
        deliveryMode: "artifact",
        attachments: [{ kind: "file", name: "report.txt", url: "/api/artifacts/report.txt" }],
      }),
    })

    expect(plan.action).toBe("download_link")
    expect(plan.artifactMode).toBe("download_link")
    expect(plan.unsupportedCapabilities).toEqual(expect.arrayContaining(["supportsFiles"]))
  })

  it("keeps unsupported features as receipt-compatible issues instead of throwing", () => {
    const plan = resolveChannelDeliveryFallbackPlan({
      capabilities: capabilities({
        supportsButtons: false,
        supportsFiles: false,
        supportsThreads: false,
        supportsTypingIndicator: false,
      }),
      requestedCapabilities: ["supportsTypingIndicator"],
      message: message({
        actions: [{ id: "approve", kind: "approval", label: "Approve" }],
        attachments: [{ kind: "file", name: "local.txt", localPath: "/tmp/local.txt" }],
        threadPolicy: { mode: "reuse_thread", threadId: "thread-1" },
      }),
    })

    expect(plan.action).toBe("unsupported_capability")
    expect(plan.unsupportedCapabilities).toEqual(
      expect.arrayContaining(["supportsButtons", "supportsFiles", "supportsThreads", "supportsTypingIndicator"]),
    )
    expect(plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unsupported_capability:supportsButtons",
        "unsupported_capability:supportsFiles",
        "unsupported_capability:supportsThreads",
        "unsupported_capability:supportsTypingIndicator",
      ]),
    )
  })

  it("marks sensitive artifact delivery as approval-required", () => {
    const plan = resolveChannelDeliveryFallbackPlan({
      capabilities: capabilities(),
      artifactSensitivity: "sensitive",
      message: message({
        deliveryMode: "artifact",
        redactionPolicy: "strict",
        attachments: [{ kind: "file", name: "secret.pdf", contentRef: "artifact:secret" }],
      }),
    })

    expect(plan.requiresExplicitApproval).toBe(true)
    expect(plan.notices.join("\n")).toContain("explicit approval")
  })

  it("describes unsupported capability receipts for UI and ledger detail", () => {
    expect(describeUnsupportedCapability("supportsFiles")).toContain("download link")
    expect(buildCapabilityFallbackNotice({
      status: "unsupported_capability",
      capability: "supportsButtons",
      errorCode: "buttons_unavailable",
    })).toMatchObject({
      title: "Unsupported channel capability",
      severity: "warning",
    })
    expect(splitTextForChannel("", 10)).toEqual([])
  })
})
