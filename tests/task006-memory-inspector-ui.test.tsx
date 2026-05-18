import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { MemoryInspectorPanel } from "../packages/webui/src/components/setup/MemoryInspectorPanel.tsx"
import type {
  MemoryInspectorControlResult,
  MemoryInspectorSnapshot,
} from "../packages/webui/src/api/client.ts"

function snapshot(): MemoryInspectorSnapshot {
  return {
    generatedAt: Date.UTC(2026, 4, 18, 6, 0, 0),
    filters: {
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session:task006",
      requestGroupId: "group:task006",
      limit: 12,
    },
    configuredPolicy: {
      explicitModelId: "compact-primary",
      fallbackModelId: "compact-fallback",
      minContextTokens: 3000,
    },
    summary: {
      owners: 1,
      warningOwners: 1,
      recallEvents: 2,
      compactionRuns: 1,
      latestCapsuleAt: Date.UTC(2026, 4, 18, 5, 55, 0),
      latestRollupAt: Date.UTC(2026, 4, 18, 5, 50, 0),
      qualityStatus: "degraded",
    },
    ownerCards: [
      {
        ownerScopeKey: "main_agent:agent:nobie:session:task006",
        ownerType: "main_agent",
        ownerId: "agent:nobie",
        sessionId: "session:task006",
        requestGroupId: "group:task006",
        nicknameSnapshot: "노비",
        latestCapsuleId: "capsule:task006",
        currentRawTokenEstimate: 180000,
        currentRawMessageCount: 41,
        latestCapsuleAgeMs: 60_000,
        activeCapsuleChainDepth: 3,
        latestRollupAgeMs: 120_000,
        lastCompactionReason: "token_threshold_exceeded",
        pendingPreservationCount: 2,
        recallHitCount: 2,
        driftWarningState: "warning",
        driftWarningCodes: ["compaction_blocked:approval_waiting"],
        lastCompactionAt: Date.UTC(2026, 4, 18, 5, 55, 0),
        compactionBlockReason: "approval_waiting",
      },
    ],
    selectedOwnerScopeKey: "main_agent:agent:nobie:session:task006",
    latestCapsule: {
      capsuleId: "capsule:task006",
      capsuleKind: "session_compaction",
      summary: "pending approval와 delivery를 보존한 compact summary",
      activeObjectives: ["objective:memory inspector 확인"],
      confirmedFacts: ["user_locale=ko"],
      decisions: ["기존 결과 재사용"],
      constraints: ["민감정보 금지"],
      pendingItems: ["pending_approval:approval-1", "pending_delivery:telegram:delivery-1"],
      recoveryHints: ["safe restore preview available"],
      sourceTokenEstimate: 180000,
      resultTokenEstimate: 1200,
      createdAt: Date.UTC(2026, 4, 18, 5, 55, 0),
    },
    latestRollup: {
      id: "rollup:task006",
      sourceCapsuleIds: ["capsule:older-1", "capsule:older-2"],
      sourceCapsuleCount: 2,
      sourceTokenEstimate: 2400,
      resultRollupCapsuleId: "capsule:rollup",
      recentCapsuleIds: ["capsule:task006"],
      preservedPendingItems: ["pending_approval:approval-1"],
      reasonCode: "capsule_chain_threshold",
      createdAt: Date.UTC(2026, 4, 18, 5, 50, 0),
    },
    recentCompactionRuns: [
      {
        id: "run:task006",
        capsuleId: "capsule:task006",
        triggerReasonCodes: ["token_threshold_exceeded"],
        sourceTokenEstimate: 180000,
        resultTokenEstimate: 2200,
        status: "completed",
        modelProvider: "openai",
        modelId: "compact-fallback",
        validationSummary: "deterministic_state_precedence_applied",
        metadata: {
          compactionModelAudit: {
            selectedModelId: "compact-fallback",
            heuristicFallbackApplied: false,
          },
        },
        createdAt: Date.UTC(2026, 4, 18, 5, 55, 0),
        updatedAt: Date.UTC(2026, 4, 18, 5, 55, 0),
      },
    ],
    recallTrace: [
      {
        id: "recall:1",
        sourceType: "maintenance_restore",
        reasonCode: "same_scope_capsule",
        canUseForFinalAnswer: false,
        sameSession: true,
        createdAt: Date.UTC(2026, 4, 18, 5, 56, 0),
      },
    ],
    compactPreview: {
      sourceMessageCount: 41,
      tailMessageCount: 8,
      degradedTailMessageCount: null,
      droppedRawCount: 33,
      headRange: { start: 0, end: 32, count: 33 },
      capsuleSummary: "pending approval와 delivery를 보존한 compact summary",
      preservedPinnedItems: ["pending_approval:approval-1", "pending_delivery:telegram:delivery-1"],
      reasonCodes: ["token_threshold_exceeded"],
      validationSummary: "deterministic_state_precedence_applied",
      modelAudit: { selectedModelId: "compact-fallback" },
    },
    maintenanceRestorePromptBlock: "[maintenance_restore]\nlatest_instruction_summary: memory inspector 확인",
    controls: [
      { action: "dry_run_compaction", enabled: true, reason: "preview_available" },
      { action: "latest_capsule_inspect", enabled: true, reason: "capsule_available" },
      { action: "rollup_inspect", enabled: true, reason: "rollup_available" },
      { action: "safe_restore", enabled: true, reason: "restore_preview_available" },
      { action: "force_compaction", enabled: false, reason: "task006_follow_up_runtime_write_guard" },
      { action: "capsule_invalidate", enabled: false, reason: "task006_follow_up_invalidation_guard" },
    ],
  }
}

describe("task006 memory inspector ui", () => {
  it("hides memory inspector entirely in beginner mode", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryInspectorPanel, {
        mode: "beginner",
        snapshot: snapshot(),
        loading: false,
        error: "",
        actionLoading: false,
        actionError: "",
        actionResult: null as MemoryInspectorControlResult | null,
        onRefresh: () => undefined,
        onControl: () => undefined,
      }),
    )

    expect(html).toBe("")
  })

  it("renders memory inspector cards and hides manual controls outside admin mode", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryInspectorPanel, {
        mode: "advanced",
        snapshot: snapshot(),
        loading: false,
        error: "",
        actionLoading: false,
        actionError: "",
        actionResult: null as MemoryInspectorControlResult | null,
        onRefresh: () => undefined,
        onControl: () => undefined,
      }),
    )

    expect(html).toContain("Memory inspector")
    expect(html).toContain("Compact preview")
    expect(html).toContain("Restore trace")
    expect(html).not.toContain("Manual controls")
  })

  it("shows manual controls in admin mode", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryInspectorPanel, {
        mode: "admin",
        snapshot: snapshot(),
        loading: false,
        error: "",
        actionLoading: false,
        actionError: "",
        actionResult: {
          action: "dry_run_compaction",
          enabled: true,
          reason: "preview_available",
          compactPreview: snapshot().compactPreview ?? undefined,
        } satisfies MemoryInspectorControlResult,
        onRefresh: () => undefined,
        onControl: () => undefined,
      }),
    )

    expect(html).toContain("Manual controls")
    expect(html).toContain("dry-run compact")
    expect(html).toContain("source 41")
  })
})
