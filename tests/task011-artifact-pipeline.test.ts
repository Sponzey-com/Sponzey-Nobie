import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanupArtifactStorageQuota,
  planArtifactQuotaCleanup,
  recordArtifactMetadata,
  runArtifactCleanupCycle,
  startArtifactCleanupScheduler,
  stopArtifactCleanupScheduler,
  validateExternalArtifactImport,
} from "../packages/core/src/artifacts/lifecycle.ts"
import { createSlackChunkDeliveryHandler } from "../packages/core/src/channels/slack/chunk-delivery.ts"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getArtifactMetadata, getLatestArtifactMetadataByPath } from "../packages/core/src/db/index.js"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function mkdtempCompat(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempCompat("nobie-task011-artifacts-")
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function writeArtifact(relativePath: string, content = "artifact"): string {
  const filePath = join(PATHS.stateDir, "artifacts", relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

beforeEach(() => {
  useTempState()
  resetArtifactDeliveryDedupeForTest()
})

afterEach(() => {
  stopArtifactCleanupScheduler()
  resetArtifactDeliveryDedupeForTest()
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task011 artifact pipeline", () => {
  it("stores preview/download lifecycle metadata with the artifact record", () => {
    const filePath = writeArtifact("screens/main.png", "png")
    const id = recordArtifactMetadata({
      sourceRunId: "run-artifact-meta",
      requestGroupId: "group-artifact-meta",
      ownerChannel: "webui",
      channelTarget: "session-artifact-meta",
      artifactPath: filePath,
      mimeType: "image/png",
      sizeBytes: 3,
      retentionPolicy: "standard",
      metadata: { source: "test" },
    })

    const row = getArtifactMetadata(id)
    const metadata = JSON.parse(row?.metadata_json ?? "{}") as {
      source?: string
      artifactLifecycle?: {
        original?: { path?: string; mimeType?: string; sizeBytes?: number }
        preview?: { path?: string; url?: string; mimeType?: string } | null
        thumbnail?: unknown
        delivery?: { previewable?: boolean; downloadUrl?: string; previewUrl?: string }
        retention?: { policy?: string; expiresAt?: number | null }
      }
    }

    expect(row?.id).toBe(id)
    expect(metadata.source).toBe("test")
    expect(metadata.artifactLifecycle?.original).toMatchObject({
      path: resolve(filePath),
      mimeType: "image/png",
      sizeBytes: 3,
    })
    expect(metadata.artifactLifecycle?.preview).toMatchObject({
      path: resolve(filePath),
      url: "/api/artifacts/screens/main.png",
      mimeType: "image/png",
    })
    expect(metadata.artifactLifecycle?.thumbnail).toBeNull()
    expect(metadata.artifactLifecycle?.delivery).toMatchObject({
      previewable: true,
      previewUrl: "/api/artifacts/screens/main.png",
      downloadUrl: "/api/artifacts/screens/main.png?download=1",
    })
    expect(metadata.artifactLifecycle?.retention?.policy).toBe("standard")
  })

  it("plans and applies quota cleanup while preserving deleted metadata", () => {
    const now = 1_765_100_000_000
    const firstPath = writeArtifact("quota/old-a.txt", "12345")
    const secondPath = writeArtifact("quota/old-b.txt", "12345")
    const keepPath = writeArtifact("quota/keep.txt", "12345")

    const firstId = recordArtifactMetadata({ ownerChannel: "webui", artifactPath: firstPath, mimeType: "text/plain", sizeBytes: 5, createdAt: now - 3000 })
    const secondId = recordArtifactMetadata({ ownerChannel: "webui", artifactPath: secondPath, mimeType: "text/plain", sizeBytes: 5, createdAt: now - 2000 })
    const keepId = recordArtifactMetadata({ ownerChannel: "webui", artifactPath: keepPath, mimeType: "text/plain", sizeBytes: 5, createdAt: now - 1000 })

    const plan = planArtifactQuotaCleanup({ maxCount: 2, maxBytes: 10 })
    expect(plan.totalCount).toBe(3)
    expect(plan.totalBytes).toBe(15)
    expect(plan.candidates.map((candidate) => candidate.artifact.id)).toEqual([firstId])
    expect(plan.candidates[0]?.reasons).toEqual(["max_count", "max_bytes"])

    const result = cleanupArtifactStorageQuota({ maxCount: 2, maxBytes: 10, now, deleteFiles: true })
    expect(result.failures).toEqual([])
    expect(result.deleted.map((artifact) => artifact.id)).toEqual([firstId])
    expect(existsSync(firstPath)).toBe(false)
    expect(existsSync(secondPath)).toBe(true)
    expect(existsSync(keepPath)).toBe(true)
    expect(getArtifactMetadata(firstId)?.deleted_at).toBe(now)
    expect(getArtifactMetadata(secondId)?.deleted_at).toBeNull()
    expect(getArtifactMetadata(keepId)?.deleted_at).toBeNull()
  })

  it("runs the artifact cleanup scheduler cycle for expired and quota candidates", () => {
    const now = 1_765_200_000_000
    const expiredPath = writeArtifact("scheduler/expired.txt", "12345")
    const quotaPath = writeArtifact("scheduler/quota.txt", "12345")
    const keepPath = writeArtifact("scheduler/keep.txt", "12345")

    const expiredId = recordArtifactMetadata({
      ownerChannel: "webui",
      artifactPath: expiredPath,
      mimeType: "text/plain",
      sizeBytes: 5,
      expiresAt: now - 1,
      createdAt: now - 3000,
    })
    const quotaId = recordArtifactMetadata({ ownerChannel: "webui", artifactPath: quotaPath, mimeType: "text/plain", sizeBytes: 5, createdAt: now - 2000 })
    const keepId = recordArtifactMetadata({ ownerChannel: "webui", artifactPath: keepPath, mimeType: "text/plain", sizeBytes: 5, createdAt: now - 1000 })

    startArtifactCleanupScheduler({ intervalMs: 1_000, maxCount: 1, maxBytes: 5 })
    stopArtifactCleanupScheduler()
    const cycle = runArtifactCleanupCycle({ now, maxCount: 1, maxBytes: 5, deleteFiles: true })

    expect(cycle.expired.map((artifact) => artifact.id)).toEqual([expiredId])
    expect(cycle.quota.deleted.map((artifact) => artifact.id)).toEqual([quotaId])
    expect(getArtifactMetadata(expiredId)?.deleted_at).toBe(now)
    expect(getArtifactMetadata(quotaId)?.deleted_at).toBe(now)
    expect(getArtifactMetadata(keepId)?.deleted_at).toBeNull()
    expect(existsSync(expiredPath)).toBe(false)
    expect(existsSync(quotaPath)).toBe(false)
    expect(existsSync(keepPath)).toBe(true)
  })

  it("validates external artifact imports by path, size, and MIME type", () => {
    const allowedRoot = mkdtempCompat("nobie-task011-import-allowed-")
    const blockedRoot = mkdtempCompat("nobie-task011-import-blocked-")
    tempDirs.push(allowedRoot, blockedRoot)
    const allowedFile = join(allowedRoot, "capture.png")
    const blockedFile = join(blockedRoot, "capture.png")
    writeFileSync(allowedFile, "png")
    writeFileSync(blockedFile, "png")

    expect(validateExternalArtifactImport({
      filePath: allowedFile,
      allowedRoots: [allowedRoot],
      maxBytes: 10,
      allowedMimeTypes: ["image/*"],
    })).toMatchObject({
      ok: true,
      filePath: resolve(allowedFile),
      fileName: "capture.png",
      mimeType: "image/png",
      sizeBytes: 3,
      previewable: true,
    })
    expect(validateExternalArtifactImport({
      filePath: blockedFile,
      allowedRoots: [allowedRoot],
      maxBytes: 10,
      allowedMimeTypes: ["image/*"],
    })).toMatchObject({ ok: false, reason: "outside_allowed_roots" })
    expect(validateExternalArtifactImport({
      filePath: allowedFile,
      allowedRoots: [allowedRoot],
      maxBytes: 2,
      allowedMimeTypes: ["image/*"],
    })).toMatchObject({ ok: false, reason: "too_large" })
    expect(validateExternalArtifactImport({
      filePath: allowedFile,
      allowedRoots: [allowedRoot],
      maxBytes: 10,
      allowedMimeTypes: ["application/pdf"],
    })).toMatchObject({ ok: false, reason: "mime_type_not_allowed" })
  })

  it("falls back to a same-channel Telegram artifact link when upload fails", async () => {
    const filePath = writeArtifact("screens/telegram-fallback.png", "png")
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockRejectedValue(new Error("upload blocked")),
      sendFinalResponse: vi.fn().mockResolvedValue([707]),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-telegram-fallback",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    const receipt = await onChunk?.({
      type: "tool_end",
      toolName: "screen_capture",
      success: true,
      output: "captured",
      details: {
        kind: "artifact_delivery",
        channel: "telegram",
        filePath,
        caption: "메인 화면",
        mimeType: "image/png",
        size: 3,
        source: "telegram",
      },
    })

    expect(responder.sendFile).toHaveBeenCalledWith(filePath, "메인 화면")
    expect(responder.sendFinalResponse).toHaveBeenCalledWith(expect.stringContaining("/api/artifacts/screens/telegram-fallback.png?download=1"))
    expect(receipt?.textDeliveries?.[0]).toMatchObject({ channel: "telegram", messageIds: [707] })
    expect(receipt?.artifactDeliveries?.[0]).toMatchObject({
      channel: "telegram",
      filePath,
      url: "/api/artifacts/screens/telegram-fallback.png",
      downloadUrl: "/api/artifacts/screens/telegram-fallback.png?download=1",
      messageId: 707,
    })
  })

  it("falls back to a same-thread Slack artifact link when upload fails", async () => {
    const filePath = writeArtifact("screens/slack-fallback.png", "png")
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockRejectedValue(new Error("upload blocked")),
      sendFinalResponse: vi.fn().mockResolvedValue(["fallback-ts"]),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-fallback",
      getRunId: () => "run-slack-fallback",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    const receipt = await onChunk?.({
      type: "tool_end",
      toolName: "screen_capture",
      success: true,
      output: "captured",
      details: {
        kind: "artifact_delivery",
        channel: "slack",
        filePath,
        caption: "메인 화면",
        mimeType: "image/png",
        size: 3,
        source: "slack",
      },
    })

    expect(responder.sendFile).toHaveBeenCalledWith(filePath, "메인 화면")
    expect(responder.sendFinalResponse).toHaveBeenCalledWith(expect.stringContaining("/api/artifacts/screens/slack-fallback.png?download=1"))
    expect(receipt?.textDeliveries?.[0]).toMatchObject({ channel: "slack" })
    expect(receipt?.artifactDeliveries?.[0]).toMatchObject({
      channel: "slack",
      filePath,
      url: "/api/artifacts/screens/slack-fallback.png",
      downloadUrl: "/api/artifacts/screens/slack-fallback.png?download=1",
    })
  })
})
