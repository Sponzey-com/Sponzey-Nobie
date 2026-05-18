import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, insertSession } from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { executeRootSessionCompaction } from "../packages/core/src/memory/compaction.ts"
import { buildReleaseManifest } from "../packages/core/src/release/package.ts"
import { buildMemoryCompactionReleaseGateSummary } from "../packages/core/src/release/memory-compaction-gate.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class ReleaseGateProvider implements AIProvider {
  readonly id = "task006-release-gate"
  readonly supportedModels = ["compact-release-model"]

  maxContextTokens(): number {
    return 20_000
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    yield {
      type: "text_delta",
      delta: JSON.stringify({
        what_happened: "release gate summary",
        current_goal: ["release evidence 확인"],
        still_open: ["pending_approval:release-approval"],
        confirmed_facts: ["user_locale=ko"],
        must_keep_constraints: ["민감정보 금지"],
        artifacts_and_receipts: [],
        tool_side_effect_boundary: ["기존 결과 재사용"],
        retry_do_not_repeat: [],
        handoff_ready_context: ["release inspector ready"],
      }),
    }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-memory-release-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    memory: {
      compaction: {
        modelId: "compact-release-model",
        fallbackModelId: "compact-release-model",
        minContextTokens: 3000
      }
    }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

async function seedReleaseEvidence(): Promise<void> {
  insertSession({
    id: "session-task006-release",
    source: "webui",
    source_id: "thread-task006-release",
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: "task006 release gate",
  })
  const provider = new ReleaseGateProvider()
  await executeRootSessionCompaction({
    provider,
    model: "compact-release-model",
    sessionId: "session-task006-release",
    requestGroupId: "group-task006-release",
    messages: [
      {
        role: "user",
        content: [
          "active_task:task006-release",
          "objective:release evidence 확인",
          "pending_approval:release-approval",
          "confirmed_fact:user_locale=ko",
          "constraint:민감정보 금지",
        ].join("\n"),
      },
    ],
    sourceTokenEstimate: 180_000,
    triggerReasonCodes: ["token_threshold_exceeded"],
  })
}

afterEach(() => {
  closeDb()
  closeMemoryJournalDb()
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

describe("task006 memory compaction release gate", () => {
  it("wires memory compaction evidence into the release summary, pipeline, and runbook", async () => {
    useTempState()
    await seedReleaseEvidence()

    const summary = buildMemoryCompactionReleaseGateSummary({
      now: new Date("2026-05-18T07:00:00.000Z"),
    })
    expect(summary.checks.map((check) => check.id)).toEqual([
      "quality_snapshot_guard",
      "append_only_archive_guard",
      "model_audit_guard",
      "drift_warning_guard",
      "heuristic_fallback_guard",
    ])

    const manifest = buildReleaseManifest({
      rootDir: process.cwd(),
      now: new Date("2026-05-18T07:00:00.000Z"),
    })
    expect(manifest.memoryCompactionEvidence.gateStatus).toBe(summary.gateStatus)
    expect(manifest.pipeline.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "memory-compaction-release-gate" }),
      ]),
    )
    expect(manifest.cleanInstallChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "memory-compaction-release-gate", required: true }),
      ]),
    )
    expect(manifest.releaseNotes.knownLimitations).toContain(
      `Memory compaction release gate: ${summary.gateStatus}`,
    )

    const runbook = readFileSync(join(process.cwd(), "docs", "release-runbook.md"), "utf-8")
    expect(runbook).toContain("Run memory compaction release gate")
    expect(runbook).toContain("Memory Compaction Manual Smoke")
    expect(runbook).toContain("dry-run compact")
  })
})
