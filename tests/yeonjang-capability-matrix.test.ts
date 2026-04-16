import { describe, expect, it } from "vitest"

import {
  doesYeonjangCapabilitySupportOutputMode,
  doesYeonjangCapabilitySupportMethod,
  hasYeonjangCapabilityMatrix,
  resolveYeonjangCapabilityOutputModes,
  resolveYeonjangMethodCapability,
  snapshotToYeonjangCapabilitiesPayload,
  type YeonjangCapabilitiesPayload,
} from "../packages/core/src/yeonjang/mqtt-client.ts"

describe("Yeonjang capability matrix", () => {
  it("prefers the structured capability matrix over legacy method implemented flags", () => {
    const payload: YeonjangCapabilitiesPayload = {
      version: "0.1.0",
      platform: "windows",
      capabilityHash: "hash-1",
      capabilityMatrix: {
        "screen.capture": {
          supported: false,
          requiresApproval: false,
          requiresPermission: true,
          permissionSetting: "allow_screen_capture",
          knownLimitations: ["test limitation"],
          outputModes: ["base64", "file"],
          lastCheckedAt: 1,
        },
      },
      methods: [{ name: "screen.capture", implemented: true }],
    }

    expect(resolveYeonjangMethodCapability(payload, "screen.capture")).toMatchObject({
      supported: false,
      permissionSetting: "allow_screen_capture",
    })
    expect(doesYeonjangCapabilitySupportMethod(payload, "screen.capture")).toBe(false)
  })

  it("keeps legacy method payloads compatible", () => {
    const payload: YeonjangCapabilitiesPayload = {
      methods: [
        { name: "screen.capture", implemented: true },
        { name: "camera.capture", implemented: false },
      ],
    }

    expect(doesYeonjangCapabilitySupportMethod(payload, "screen.capture")).toBe(true)
    expect(doesYeonjangCapabilitySupportMethod(payload, "camera.capture")).toBe(false)
    expect(doesYeonjangCapabilitySupportMethod(payload, "system.exec")).toBe(false)
  })

  it("reports output mode support only when the structured matrix provides it", () => {
    const payload: YeonjangCapabilitiesPayload = {
      capabilityMatrix: {
        "screen.capture": {
          supported: true,
          outputModes: ["base64", "file"],
        },
        "camera.capture": {
          supported: true,
          outputModes: ["file"],
        },
      },
    }

    expect(hasYeonjangCapabilityMatrix(payload)).toBe(true)
    expect(resolveYeonjangCapabilityOutputModes(payload, "screen.capture")).toEqual(["base64", "file"])
    expect(doesYeonjangCapabilitySupportOutputMode(payload, "screen.capture", "base64")).toBe(true)
    expect(doesYeonjangCapabilitySupportOutputMode(payload, "camera.capture", "base64")).toBe(false)
    expect(doesYeonjangCapabilitySupportOutputMode({ methods: [{ name: "screen.capture", implemented: true }] }, "screen.capture", "base64")).toBeNull()
  })

  it("converts MQTT extension snapshots into fresh capability payloads", () => {
    const payload = snapshotToYeonjangCapabilitiesPayload({
      extensionId: "yeonjang-test",
      clientId: "client-1",
      displayName: "Yeonjang Test",
      state: "ready",
      message: null,
      version: "0.1.0",
      protocolVersion: "2026-04-16.capability-matrix.v1",
      os: "darwin",
      arch: "arm64",
      transport: ["mqtt"],
      capabilityHash: "hash-1",
      methods: ["node.ping"],
      permissions: {
        screen: { allowed: true },
      },
      toolHealth: {
        "screen.capture": { status: "ready" },
      },
      capabilityMatrix: {
        "screen.capture": {
          supported: true,
          requiresApproval: true,
          requiresPermission: true,
          permissionSetting: "allow_screen_capture",
          outputModes: ["base64", "file"],
          lastCheckedAt: 10,
        },
      },
      lastCapabilityRefreshAt: 123,
      lastSeenAt: 456,
    })

    expect(payload).toMatchObject({
      version: "0.1.0",
      protocolVersion: "2026-04-16.capability-matrix.v1",
      os: "darwin",
      arch: "arm64",
      transport: ["mqtt"],
      capabilityHash: "hash-1",
      permissions: { screen: { allowed: true } },
      toolHealth: { "screen.capture": { status: "ready" } },
      lastCapabilityRefreshAt: 123,
    })
    expect(payload.methods).toEqual([
      {
        name: "screen.capture",
        implemented: true,
        supported: true,
        requiresApproval: true,
        requiresPermission: true,
        permissionSetting: "allow_screen_capture",
        outputModes: ["base64", "file"],
        lastCheckedAt: 10,
      },
    ])
  })
})
