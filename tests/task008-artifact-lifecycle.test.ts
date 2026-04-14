import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildArtifactAccessDescriptor,
  cleanupExpiredArtifacts,
  computeArtifactExpiresAt,
  recordArtifactMetadata,
} from "../packages/core/src/artifacts/lifecycle.ts"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, getLatestArtifactMetadataByPath, insertSession } from "../packages/core/src/db/index.js"
import { deliverArtifactOnce, resendArtifact, resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempCompat("nobie-task008-artifact-")
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function mkdtempCompat(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
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

describe("task008 artifact lifecycle", () => {
  it("builds safe WebUI URLs only for stateDir artifacts", () => {
    const filePath = writeArtifact("screens/메인 화면.png")

    const descriptor = buildArtifactAccessDescriptor({ filePath, mimeType: "image/png" })
    expect(descriptor).toMatchObject({
      ok: true,
      fileName: "메인 화면.png",
      mimeType: "image/png",
      previewable: true,
      downloadable: true,
      previewUrl: "/api/artifacts/screens/%EB%A9%94%EC%9D%B8%20%ED%99%94%EB%A9%B4.png",
      downloadUrl: "/api/artifacts/screens/%EB%A9%94%EC%9D%B8%20%ED%99%94%EB%A9%B4.png?download=1",
    })

    const outside = buildArtifactAccessDescriptor({ filePath: join(tmpdir(), "outside-artifact.png") })
    expect(outside.ok).toBe(false)
    expect(outside.reason).toBe("outside_state_artifacts")
    expect(outside.userMessage).toContain("안전한 artifact 저장소 밖")
  })

  it("records metadata, retention, expiry, and cleanup state", () => {
    const now = 1_765_000_000_000
    const filePath = writeArtifact("reports/summary.txt", "hello")

    const id = recordArtifactMetadata({
      sourceRunId: "run-artifact",
      requestGroupId: "group-artifact",
      ownerChannel: "webui",
      channelTarget: "session-artifact",
      artifactPath: filePath,
      mimeType: "text/plain",
      sizeBytes: 5,
      retentionPolicy: "ephemeral",
      expiresAt: now - 1,
      createdAt: now - 10_000,
      metadata: { source: "test" },
    })

    const row = getLatestArtifactMetadataByPath(resolve(filePath))
    expect(row).toMatchObject({
      id,
      source_run_id: "run-artifact",
      request_group_id: "group-artifact",
      owner_channel: "webui",
      channel_target: "session-artifact",
      artifact_path: resolve(filePath),
      mime_type: "text/plain",
      size_bytes: 5,
      retention_policy: "ephemeral",
      expires_at: now - 1,
    })
    expect(computeArtifactExpiresAt("permanent", now)).toBeNull()

    const expired = cleanupExpiredArtifacts({ now, deleteFiles: true })
    expect(expired.map((artifact) => artifact.id)).toEqual([id])
    expect(existsSync(filePath)).toBe(false)
    expect(getLatestArtifactMetadataByPath(resolve(filePath))?.deleted_at).toBe(now)
  })

  it("uses download fallback for non-previewable files", () => {
    const filePath = writeArtifact("exports/result.zip", "zip")

    const descriptor = buildArtifactAccessDescriptor({ filePath, mimeType: "application/zip" })

    expect(descriptor).toMatchObject({
      ok: true,
      previewable: false,
      downloadable: true,
      url: "/api/artifacts/exports/result.zip?download=1",
      previewUrl: "/api/artifacts/exports/result.zip",
      downloadUrl: "/api/artifacts/exports/result.zip?download=1",
    })
  })

  it("dedupes automatic delivery but permits explicit resend with audit metadata", async () => {
    const now = Date.now()
    insertSession({
      id: "session-artifact-resend",
      source: "webui",
      source_id: null,
      created_at: now,
      updated_at: now,
      summary: null,
    })
    createRootRun({
      id: "run-artifact-resend",
      sessionId: "session-artifact-resend",
      requestGroupId: "group-artifact-resend",
      prompt: "캡처 다시 보내줘",
      source: "webui",
    })
    const filePath = writeArtifact("screens/resend.png", "png")
    const firstTask = vi.fn(async () => "sent")
    const duplicateTask = vi.fn(async () => "duplicate")
    const resendTask = vi.fn(async () => "resent")

    await expect(deliverArtifactOnce({
      runId: "run-artifact-resend",
      channel: "webui",
      channelTarget: "session-artifact-resend",
      filePath,
      mimeType: "image/png",
      sizeBytes: 3,
      task: firstTask,
    })).resolves.toBe("sent")
    await expect(deliverArtifactOnce({
      runId: "run-artifact-resend",
      channel: "webui",
      channelTarget: "session-artifact-resend",
      filePath,
      mimeType: "image/png",
      sizeBytes: 3,
      task: duplicateTask,
    })).resolves.toBeUndefined()
    await expect(resendArtifact({
      runId: "run-artifact-resend",
      channel: "webui",
      channelTarget: "session-artifact-resend",
      filePath,
      mimeType: "image/png",
      sizeBytes: 3,
      forceReason: "user_requested_resend",
      task: resendTask,
    })).resolves.toBe("resent")

    expect(firstTask).toHaveBeenCalledTimes(1)
    expect(duplicateTask).not.toHaveBeenCalled()
    expect(resendTask).toHaveBeenCalledTimes(1)
    expect(getDb().prepare<[], { count: number }>(`SELECT count(*) AS count FROM artifact_receipts`).get()).toEqual({ count: 2 })
    expect(getDb().prepare<[], { count: number }>(`SELECT count(*) AS count FROM artifacts WHERE owner_channel = 'webui' AND channel_target = 'session-artifact-resend'`).get()).toEqual({ count: 2 })
    expect(getDb().prepare<[], { count: number }>(`SELECT count(*) AS count FROM diagnostic_events WHERE kind = 'artifact_resend'`).get()).toEqual({ count: 1 })
  })
})
