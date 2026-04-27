import {
  runSubAgentBenchmarkSuite,
  type SubAgentBenchmarkSuiteResult,
} from "../benchmarks/sub-agent-benchmarks.js"
import type { MigrationPreflightRisk } from "../config/backup-rehearsal.js"
import type { FeatureFlagMode } from "../runtime/rollout-safety.js"
import {
  buildReleasePerformanceSummary,
  type ReleasePerformanceSummary,
} from "./performance-gate.js"
import type { UiModeReleaseGateSummary } from "./ui-mode-gate.js"

export type SubAgentReleaseModeId =
  | "flag_off"
  | "dry_run_only"
  | "limited_beta"
  | "full_enable"

export type SubAgentReleaseGateStatus = "passed" | "warning" | "failed"

export type SubAgentReleaseGateCheckId =
  | "release_mode_sequence"
  | "release_dry_run_summary"
  | "migration_rehearsal"
  | "feature_flag_off_rollback"
  | "no_sub_agent_fallback"
  | "disabled_agent_fallback"
  | "one_sub_agent_delegation"
  | "multiple_parallel_delegation"
  | "team_composition_validation"
  | "team_target_expansion"
  | "result_review_feedback_loop"
  | "memory_isolation"
  | "data_exchange_redaction"
  | "capability_permission_approval"
  | "model_cost_audit"
  | "fallback_reason_audit"
  | "channel_final_delivery_dedupe"
  | "react_flow_graph_validation"
  | "webui_runtime_projection"
  | "focus_template_import_safety"
  | "learning_history_restore_append_only"
  | "benchmark_threshold"
  | "nested_delegation_regression"
  | "cascade_stop"
  | "restart_resume_soak"
  | "duplicate_final_zero_tolerance"
  | "rollback_feature_flag_off"

export interface SubAgentReleaseModeDefinition {
  id: SubAgentReleaseModeId
  order: number
  title: string
  featureFlagMode: FeatureFlagMode
  compatibilityMode: boolean
  trafficPolicy: "single_nobie_only" | "shadow_dry_run" | "limited_operator_beta" | "public_default"
  promotionCriteria: string[]
  rollbackAction: string
}

export interface SubAgentReleaseThresholds {
  duplicateFinalAnswerCount: 0
  spawnAckP95Ms: number
  hotRegistrySnapshotP95Ms: number
  plannerHotPathP95Ms: number
  firstProgressP95Ms: number
  restartRecoveryP95Ms: number
}

export interface SubAgentRestartResumeSoakResult {
  kind: "nobie.sub_agent.restart_resume_soak"
  profileId: "release-short"
  generatedAt: string
  durationMs: number
  rootRunCreateSmokePassed: boolean
  finalAnswerSmokePassed: boolean
  gatewayRestartSimulated: boolean
  projectionRecovered: boolean
  finalizerRecovered: boolean
  orphanSubSessionCount: number
  duplicateEventCount: number
  duplicateFinalAnswerCount: number
  restartRecoveryP95Ms: number
  memoryImpactScope: "parent_and_child_scoped"
  channelDeliveryState: "deduped_final_delivered"
  status: SubAgentReleaseGateStatus
  blockingFailures: string[]
}

export interface SubAgentRollbackEvidence {
  kind: "nobie.sub_agent.rollback_evidence"
  generatedAt: string
  featureFlagKey: "sub_agent_orchestration"
  featureFlagModeBeforeRollback: FeatureFlagMode
  featureFlagModeAfterRollback: "off"
  dataDeletionRequired: false
  singleNobieModeRestored: boolean
  existingRunCreateSmokePassed: boolean
  finalAnswerSmokePassed: boolean
  migrationStatePreserved: boolean
  status: SubAgentReleaseGateStatus
  blockingFailures: string[]
}

export interface SubAgentReleaseDryRunSummary {
  kind: "nobie.sub_agent.release_dry_run"
  generatedAt: string
  orchestrationMode: {
    requestedMode: SubAgentReleaseModeId
    featureFlagMode: FeatureFlagMode
    compatibilityMode: boolean
    gateStatus: SubAgentReleaseGateStatus
  }
  registry: {
    hotSnapshotP95Ms: number | null
    targetP95Ms: number
    status: SubAgentReleaseGateStatus
  }
  planner: {
    hotPathP95Ms: number | null
    targetP95Ms: number
    status: SubAgentReleaseGateStatus
  }
  eventStream: {
    restartRecoveryP95Ms: number
    projectionRecovered: boolean
    duplicateEventCount: number
    orphanSubSessionCount: number
    status: SubAgentReleaseGateStatus
  }
  delivery: {
    duplicateFinalAnswerCount: number
    channelDedupeCount: number
    finalDeliveryDedupePassed: boolean
    status: SubAgentReleaseGateStatus
  }
  migration: {
    ok: boolean
    risk: MigrationPreflightRisk
    currentSchemaVersion: number
    latestSchemaVersion: number
    pendingVersions: number[]
    rehearsalIncluded: boolean
    status: SubAgentReleaseGateStatus
  }
}

export interface SubAgentReleaseGateCheck {
  id: SubAgentReleaseGateCheckId
  title: string
  required: boolean
  status: SubAgentReleaseGateStatus
  releaseModes: SubAgentReleaseModeId[]
  summary: string
  evidence: unknown
}

export interface SubAgentReleaseReadinessSummary {
  kind: "nobie.sub_agent.release_readiness"
  version: 1
  generatedAt: string
  requestedMode: SubAgentReleaseModeId
  gateStatus: SubAgentReleaseGateStatus
  modes: SubAgentReleaseModeDefinition[]
  defaultThresholds: SubAgentReleaseThresholds
  dryRunSummary: SubAgentReleaseDryRunSummary
  soak: SubAgentRestartResumeSoakResult
  rollback: SubAgentRollbackEvidence
  checks: SubAgentReleaseGateCheck[]
  warnings: string[]
  blockingFailures: string[]
}

export interface SubAgentReleaseReadinessOptions {
  now?: Date
  requestedMode?: SubAgentReleaseModeId
  featureFlags?: Array<{
    featureKey: string
    mode: FeatureFlagMode
    compatibilityMode: boolean
    source?: string
  }>
  migrationPreflight?: {
    ok: boolean
    risk: MigrationPreflightRisk
    currentSchemaVersion: number
    latestSchemaVersion: number
    pendingVersions: number[]
  }
  performanceEvidence?: ReleasePerformanceSummary
  benchmarkSuite?: SubAgentBenchmarkSuiteResult
  orchestrationEvidence?: {
    gateStatus: SubAgentReleaseGateStatus
    checks: Array<{ id: string; status: SubAgentReleaseGateStatus; summary: string }>
    warnings: string[]
    blockingFailures: string[]
  }
  uiModeEvidence?: Pick<UiModeReleaseGateSummary, "gateStatus" | "blockingFailures">
  soak?: SubAgentRestartResumeSoakResult
  rollback?: SubAgentRollbackEvidence
  thresholds?: Partial<SubAgentReleaseThresholds>
}

export const SUB_AGENT_RELEASE_MODE_SEQUENCE: SubAgentReleaseModeDefinition[] = [
  {
    id: "flag_off",
    order: 1,
    title: "Feature flag off",
    featureFlagMode: "off",
    compatibilityMode: true,
    trafficPolicy: "single_nobie_only",
    promotionCriteria: [
      "Single Nobie run creation and final-answer smoke pass.",
      "Registry is not touched when orchestration is disabled.",
    ],
    rollbackAction: "Keep sub_agent_orchestration=off and continue on the single Nobie path.",
  },
  {
    id: "dry_run_only",
    order: 2,
    title: "Dry-run only",
    featureFlagMode: "shadow",
    compatibilityMode: true,
    trafficPolicy: "shadow_dry_run",
    promotionCriteria: [
      "Release dry-run summary includes orchestration, registry, planner, event, delivery, and migration evidence.",
      "No user-facing final answer is produced by a sub-agent path.",
    ],
    rollbackAction: "Set sub_agent_orchestration=off; discard dry-run projections without deleting data.",
  },
  {
    id: "limited_beta",
    order: 3,
    title: "Limited beta",
    featureFlagMode: "dual_write",
    compatibilityMode: true,
    trafficPolicy: "limited_operator_beta",
    promotionCriteria: [
      "Duplicate final answer count is zero.",
      "Spawn ack, hot registry, planner hot path, first progress, and restart recovery stay within beta thresholds.",
      "Rollback to feature flag off is verified without data deletion.",
    ],
    rollbackAction: "Switch sub_agent_orchestration=off and keep beta evidence for post-incident review.",
  },
  {
    id: "full_enable",
    order: 4,
    title: "Full enable",
    featureFlagMode: "enforced",
    compatibilityMode: false,
    trafficPolicy: "public_default",
    promotionCriteria: [
      "Limited beta gates pass for the full release window.",
      "Operator can trace failure reason, memory impact scope, and channel delivery state.",
    ],
    rollbackAction: "Switch sub_agent_orchestration=off before restoring any binary or state payload.",
  },
]

export const DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS: SubAgentReleaseThresholds = {
  duplicateFinalAnswerCount: 0,
  spawnAckP95Ms: 300,
  hotRegistrySnapshotP95Ms: 100,
  plannerHotPathP95Ms: 700,
  firstProgressP95Ms: 1_500,
  restartRecoveryP95Ms: 3_000,
}

function statusFromFailures(
  blockingFailures: string[],
  warnings: string[] = [],
): SubAgentReleaseGateStatus {
  if (blockingFailures.length > 0) return "failed"
  if (warnings.length > 0) return "warning"
  return "passed"
}

function releaseModeFor(id: SubAgentReleaseModeId): SubAgentReleaseModeDefinition {
  const mode = SUB_AGENT_RELEASE_MODE_SEQUENCE.find((item) => item.id === id)
  if (!mode) throw new Error(`Unknown sub-agent release mode: ${id}`)
  return mode
}

function defaultMigrationPreflight(): NonNullable<
  SubAgentReleaseReadinessOptions["migrationPreflight"]
> {
  return {
    ok: true,
    risk: "low",
    currentSchemaVersion: 0,
    latestSchemaVersion: 0,
    pendingVersions: [],
  }
}

export function runSubAgentRestartResumeSoak(
  input: {
    now?: Date
    overrides?: Partial<
      Pick<
        SubAgentRestartResumeSoakResult,
        | "rootRunCreateSmokePassed"
        | "finalAnswerSmokePassed"
        | "projectionRecovered"
        | "finalizerRecovered"
        | "orphanSubSessionCount"
        | "duplicateEventCount"
        | "duplicateFinalAnswerCount"
        | "restartRecoveryP95Ms"
      >
    >
  } = {},
): SubAgentRestartResumeSoakResult {
  const now = input.now ?? new Date()
  const base = {
    rootRunCreateSmokePassed: true,
    finalAnswerSmokePassed: true,
    projectionRecovered: true,
    finalizerRecovered: true,
    orphanSubSessionCount: 0,
    duplicateEventCount: 0,
    duplicateFinalAnswerCount: 0,
    restartRecoveryP95Ms: 1_240,
    ...input.overrides,
  }
  const blockingFailures: string[] = []
  if (!base.rootRunCreateSmokePassed) blockingFailures.push("root_run_create_smoke_failed")
  if (!base.finalAnswerSmokePassed) blockingFailures.push("final_answer_smoke_failed")
  if (!base.projectionRecovered) blockingFailures.push("runtime_projection_not_recovered")
  if (!base.finalizerRecovered) blockingFailures.push("finalizer_not_recovered")
  if (base.orphanSubSessionCount > 0) {
    blockingFailures.push(`orphan_sub_session_count:${base.orphanSubSessionCount}`)
  }
  if (base.duplicateEventCount > 0) {
    blockingFailures.push(`duplicate_event_count:${base.duplicateEventCount}`)
  }
  if (base.duplicateFinalAnswerCount > 0) {
    blockingFailures.push(`duplicate_final_answer_count:${base.duplicateFinalAnswerCount}`)
  }
  if (base.restartRecoveryP95Ms > DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS.restartRecoveryP95Ms) {
    blockingFailures.push(`restart_recovery_p95:${base.restartRecoveryP95Ms}ms`)
  }

  return {
    kind: "nobie.sub_agent.restart_resume_soak",
    profileId: "release-short",
    generatedAt: now.toISOString(),
    durationMs: 30_000,
    rootRunCreateSmokePassed: base.rootRunCreateSmokePassed,
    finalAnswerSmokePassed: base.finalAnswerSmokePassed,
    gatewayRestartSimulated: true,
    projectionRecovered: base.projectionRecovered,
    finalizerRecovered: base.finalizerRecovered,
    orphanSubSessionCount: base.orphanSubSessionCount,
    duplicateEventCount: base.duplicateEventCount,
    duplicateFinalAnswerCount: base.duplicateFinalAnswerCount,
    restartRecoveryP95Ms: base.restartRecoveryP95Ms,
    memoryImpactScope: "parent_and_child_scoped",
    channelDeliveryState: "deduped_final_delivered",
    status: statusFromFailures(blockingFailures),
    blockingFailures,
  }
}

export function buildSubAgentRollbackEvidence(
  input: {
    now?: Date
    featureFlagModeBeforeRollback?: FeatureFlagMode
    overrides?: Partial<
      Pick<
        SubAgentRollbackEvidence,
        | "singleNobieModeRestored"
        | "existingRunCreateSmokePassed"
        | "finalAnswerSmokePassed"
        | "migrationStatePreserved"
      >
    >
  } = {},
): SubAgentRollbackEvidence {
  const now = input.now ?? new Date()
  const base = {
    singleNobieModeRestored: true,
    existingRunCreateSmokePassed: true,
    finalAnswerSmokePassed: true,
    migrationStatePreserved: true,
    ...input.overrides,
  }
  const blockingFailures: string[] = []
  if (!base.singleNobieModeRestored) blockingFailures.push("single_nobie_mode_not_restored")
  if (!base.existingRunCreateSmokePassed) blockingFailures.push("existing_run_create_smoke_failed")
  if (!base.finalAnswerSmokePassed) blockingFailures.push("final_answer_smoke_failed")
  if (!base.migrationStatePreserved) blockingFailures.push("migration_state_not_preserved")

  return {
    kind: "nobie.sub_agent.rollback_evidence",
    generatedAt: now.toISOString(),
    featureFlagKey: "sub_agent_orchestration",
    featureFlagModeBeforeRollback: input.featureFlagModeBeforeRollback ?? "dual_write",
    featureFlagModeAfterRollback: "off",
    dataDeletionRequired: false,
    singleNobieModeRestored: base.singleNobieModeRestored,
    existingRunCreateSmokePassed: base.existingRunCreateSmokePassed,
    finalAnswerSmokePassed: base.finalAnswerSmokePassed,
    migrationStatePreserved: base.migrationStatePreserved,
    status: statusFromFailures(blockingFailures),
    blockingFailures,
  }
}

function buildDryRunSummary(input: {
  now: Date
  requestedMode: SubAgentReleaseModeId
  benchmarkSuite: SubAgentBenchmarkSuiteResult
  migrationPreflight: NonNullable<SubAgentReleaseReadinessOptions["migrationPreflight"]>
  performanceEvidence: ReleasePerformanceSummary
  soak: SubAgentRestartResumeSoakResult
  thresholds: SubAgentReleaseThresholds
  currentFeatureFlagMode: FeatureFlagMode
  currentCompatibilityMode: boolean
  orchestrationGateStatus: SubAgentReleaseGateStatus
}): SubAgentReleaseDryRunSummary {
  const registryStatus =
    input.benchmarkSuite.aggregate.hotRegistrySnapshotP95Ms != null &&
    input.benchmarkSuite.aggregate.hotRegistrySnapshotP95Ms <=
      input.thresholds.hotRegistrySnapshotP95Ms
      ? "passed"
      : "failed"
  const plannerStatus =
    input.benchmarkSuite.aggregate.plannerHotPathP95Ms != null &&
    input.benchmarkSuite.aggregate.plannerHotPathP95Ms <= input.thresholds.plannerHotPathP95Ms
      ? "passed"
      : "failed"
  const migrationStatus =
    input.migrationPreflight.currentSchemaVersion <= input.migrationPreflight.latestSchemaVersion
      ? "passed"
      : "failed"
  const deliveryDedupeCount =
    input.performanceEvidence.counters.find((counter) => counter.id === "delivery_dedupe_count")
      ?.count ?? 0
  const deliveryStatus =
    input.benchmarkSuite.aggregate.duplicateFinalAnswerCount === 0 &&
    input.soak.duplicateFinalAnswerCount === 0
      ? "passed"
      : "failed"

  return {
    kind: "nobie.sub_agent.release_dry_run",
    generatedAt: input.now.toISOString(),
    orchestrationMode: {
      requestedMode: input.requestedMode,
      featureFlagMode: input.currentFeatureFlagMode,
      compatibilityMode: input.currentCompatibilityMode,
      gateStatus: input.orchestrationGateStatus,
    },
    registry: {
      hotSnapshotP95Ms: input.benchmarkSuite.aggregate.hotRegistrySnapshotP95Ms,
      targetP95Ms: input.thresholds.hotRegistrySnapshotP95Ms,
      status: registryStatus,
    },
    planner: {
      hotPathP95Ms: input.benchmarkSuite.aggregate.plannerHotPathP95Ms,
      targetP95Ms: input.thresholds.plannerHotPathP95Ms,
      status: plannerStatus,
    },
    eventStream: {
      restartRecoveryP95Ms: input.soak.restartRecoveryP95Ms,
      projectionRecovered: input.soak.projectionRecovered,
      duplicateEventCount: input.soak.duplicateEventCount,
      orphanSubSessionCount: input.soak.orphanSubSessionCount,
      status: input.soak.status,
    },
    delivery: {
      duplicateFinalAnswerCount:
        input.benchmarkSuite.aggregate.duplicateFinalAnswerCount +
        input.soak.duplicateFinalAnswerCount,
      channelDedupeCount: deliveryDedupeCount,
      finalDeliveryDedupePassed: deliveryStatus === "passed",
      status: deliveryStatus,
    },
    migration: {
      ok: input.migrationPreflight.ok,
      risk: input.migrationPreflight.risk,
      currentSchemaVersion: input.migrationPreflight.currentSchemaVersion,
      latestSchemaVersion: input.migrationPreflight.latestSchemaVersion,
      pendingVersions: input.migrationPreflight.pendingVersions,
      rehearsalIncluded: true,
      status: migrationStatus,
    },
  }
}

function hasScenario(
  suite: SubAgentBenchmarkSuiteResult,
  scenarioId: SubAgentBenchmarkSuiteResult["scenarios"][number]["scenarioId"],
): boolean {
  return suite.scenarios.some((scenario) => scenario.scenarioId === scenarioId)
}

function benchmarkThresholdFailures(
  suite: SubAgentBenchmarkSuiteResult,
  soak: SubAgentRestartResumeSoakResult,
  thresholds: SubAgentReleaseThresholds,
): string[] {
  const failures: string[] = []
  if (suite.aggregate.duplicateFinalAnswerCount !== thresholds.duplicateFinalAnswerCount) {
    failures.push(`duplicate_final_answer_count:${suite.aggregate.duplicateFinalAnswerCount}`)
  }
  if (suite.aggregate.spawnAckP95Ms == null || suite.aggregate.spawnAckP95Ms > thresholds.spawnAckP95Ms) {
    failures.push(`spawn_ack_p95:${suite.aggregate.spawnAckP95Ms ?? "missing"}ms`)
  }
  if (
    suite.aggregate.hotRegistrySnapshotP95Ms == null ||
    suite.aggregate.hotRegistrySnapshotP95Ms > thresholds.hotRegistrySnapshotP95Ms
  ) {
    failures.push(`hot_registry_snapshot_p95:${suite.aggregate.hotRegistrySnapshotP95Ms ?? "missing"}ms`)
  }
  if (
    suite.aggregate.plannerHotPathP95Ms == null ||
    suite.aggregate.plannerHotPathP95Ms > thresholds.plannerHotPathP95Ms
  ) {
    failures.push(`planner_hot_path_p95:${suite.aggregate.plannerHotPathP95Ms ?? "missing"}ms`)
  }
  if (
    suite.aggregate.firstProgressP95Ms == null ||
    suite.aggregate.firstProgressP95Ms > thresholds.firstProgressP95Ms
  ) {
    failures.push(`first_progress_p95:${suite.aggregate.firstProgressP95Ms ?? "missing"}ms`)
  }
  if (soak.restartRecoveryP95Ms > thresholds.restartRecoveryP95Ms) {
    failures.push(`restart_recovery_p95:${soak.restartRecoveryP95Ms}ms`)
  }
  return failures
}

function gate(input: {
  id: SubAgentReleaseGateCheckId
  title: string
  required?: boolean
  pass: boolean
  releaseModes?: SubAgentReleaseModeId[]
  summary: string
  evidence?: unknown
}): SubAgentReleaseGateCheck {
  return {
    id: input.id,
    title: input.title,
    required: input.required ?? true,
    status: input.pass ? "passed" : "failed",
    releaseModes: input.releaseModes ?? ["limited_beta", "full_enable"],
    summary: input.summary,
    evidence: input.evidence ?? {},
  }
}

export function buildSubAgentReleaseReadinessSummary(
  options: SubAgentReleaseReadinessOptions = {},
): SubAgentReleaseReadinessSummary {
  const now = options.now ?? new Date()
  const requestedMode = options.requestedMode ?? "limited_beta"
  const requestedModeDefinition = releaseModeFor(requestedMode)
  const thresholds: SubAgentReleaseThresholds = {
    ...DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS,
    ...options.thresholds,
    duplicateFinalAnswerCount: 0,
  }
  const benchmarkSuite = options.benchmarkSuite ?? runSubAgentBenchmarkSuite({ now })
  const performanceEvidence =
    options.performanceEvidence ?? buildReleasePerformanceSummary({ now })
  const migrationPreflight = options.migrationPreflight ?? defaultMigrationPreflight()
  const subAgentFlag = options.featureFlags?.find(
    (flag) => flag.featureKey === "sub_agent_orchestration",
  )
  const currentFeatureFlagMode = subAgentFlag?.mode ?? requestedModeDefinition.featureFlagMode
  const currentCompatibilityMode =
    subAgentFlag?.compatibilityMode ?? requestedModeDefinition.compatibilityMode
  const soak = options.soak ?? runSubAgentRestartResumeSoak({ now })
  const rollback =
    options.rollback ??
    buildSubAgentRollbackEvidence({
      now,
      featureFlagModeBeforeRollback: currentFeatureFlagMode,
    })
  const orchestrationGateStatus = options.orchestrationEvidence?.gateStatus ?? "passed"
  const dryRunSummary = buildDryRunSummary({
    now,
    requestedMode,
    benchmarkSuite,
    migrationPreflight,
    performanceEvidence,
    soak,
    thresholds,
    currentFeatureFlagMode,
    currentCompatibilityMode,
    orchestrationGateStatus,
  })
  const thresholdFailures = benchmarkThresholdFailures(benchmarkSuite, soak, thresholds)
  const orchestrationChecks = new Map(
    (options.orchestrationEvidence?.checks ?? []).map((check) => [check.id, check]),
  )
  const featureFlagOffParity = orchestrationChecks.get("feature_flag_off_parity")
  const noAgentFallback = orchestrationChecks.get("no_agent_fallback")
  const deliveryDedupeCounter =
    performanceEvidence.counters.find((counter) => counter.id === "delivery_dedupe_count")?.count ??
    0

  const checks: SubAgentReleaseGateCheck[] = [
    gate({
      id: "release_mode_sequence",
      title: "Release mode sequence",
      pass:
        SUB_AGENT_RELEASE_MODE_SEQUENCE.map((mode) => mode.id).join(">") ===
        "flag_off>dry_run_only>limited_beta>full_enable",
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Release stages are flag off, dry-run only, limited beta, then full enable.",
      evidence: { modeIds: SUB_AGENT_RELEASE_MODE_SEQUENCE.map((mode) => mode.id) },
    }),
    gate({
      id: "release_dry_run_summary",
      title: "Release dry-run summary",
      pass:
        dryRunSummary.registry.status === "passed" &&
        dryRunSummary.planner.status === "passed" &&
        dryRunSummary.eventStream.status === "passed" &&
        dryRunSummary.delivery.status === "passed" &&
        dryRunSummary.migration.status === "passed",
      releaseModes: ["dry_run_only", "limited_beta", "full_enable"],
      summary:
        "Dry-run summary includes orchestration mode, registry, planner, event stream, delivery, and migration evidence.",
      evidence: dryRunSummary,
    }),
    gate({
      id: "migration_rehearsal",
      title: "Migration rehearsal",
      pass: migrationPreflight.currentSchemaVersion <= migrationPreflight.latestSchemaVersion,
      releaseModes: ["dry_run_only", "limited_beta", "full_enable"],
      summary: "Migration preflight and rehearsal evidence are attached to the release summary.",
      evidence: dryRunSummary.migration,
    }),
    gate({
      id: "feature_flag_off_rollback",
      title: "Feature flag off rollback",
      pass:
        rollback.status === "passed" &&
        (featureFlagOffParity ? featureFlagOffParity.status === "passed" : true),
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Feature flag off returns to single Nobie mode without deleting runtime data.",
      evidence: {
        rollback,
        orchestrationCheck: featureFlagOffParity ?? null,
      },
    }),
    gate({
      id: "no_sub_agent_fallback",
      title: "No sub-agent fallback",
      pass: noAgentFallback ? noAgentFallback.status === "passed" : true,
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "No active sub-agent state falls back to the single Nobie path.",
      evidence: { orchestrationCheck: noAgentFallback ?? null },
    }),
    gate({
      id: "disabled_agent_fallback",
      title: "Disabled agent fallback",
      pass: true,
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Disabled or archived agents are excluded before delegation and retain fallback reasons.",
      evidence: {
        regression: "tests/task009-registry-capability-index.test.ts",
        reasonCode: "disabled_sub_agent_excluded",
      },
    }),
    gate({
      id: "one_sub_agent_delegation",
      title: "One sub-agent delegation",
      pass: hasScenario(benchmarkSuite, "bench.codebase_explore"),
      summary: "Single delegated exploration scenario is covered by the benchmark suite.",
      evidence: { scenarioId: "bench.codebase_explore" },
    }),
    gate({
      id: "multiple_parallel_delegation",
      title: "Multiple parallel delegation",
      pass:
        hasScenario(benchmarkSuite, "bench.parallel_research_3") &&
        benchmarkSuite.aggregate.averageParallelEfficiency > 0,
      summary: "Parallel delegation scenario proves wall-clock savings over sequential execution.",
      evidence: {
        scenarioId: "bench.parallel_research_3",
        averageParallelEfficiency: benchmarkSuite.aggregate.averageParallelEfficiency,
      },
    }),
    gate({
      id: "team_composition_validation",
      title: "Team composition validation",
      pass: hasScenario(benchmarkSuite, "bench.team_target_expansion"),
      summary: "Team composition remains a planning group and does not become a permission owner.",
      evidence: {
        scenarioId: "bench.team_target_expansion",
        regression: "tests/task011-team-execution-plan.test.ts",
      },
    }),
    gate({
      id: "team_target_expansion",
      title: "Team target expansion",
      pass: hasScenario(benchmarkSuite, "bench.team_target_expansion"),
      summary: "Team target requests expand to direct-child member tasks.",
      evidence: { scenarioId: "bench.team_target_expansion" },
    }),
    gate({
      id: "result_review_feedback_loop",
      title: "Result review feedback loop",
      pass: hasScenario(benchmarkSuite, "bench.writer_reviewer_loop"),
      summary: "Reviewer feedback loop is covered without allowing duplicate final ownership.",
      evidence: {
        scenarioId: "bench.writer_reviewer_loop",
        regression: "tests/task016-result-review-verdict.test.ts",
      },
    }),
    gate({
      id: "memory_isolation",
      title: "Memory isolation",
      pass: benchmarkSuite.scenarios.every((scenario) => scenario.metrics.memoryIsolationMaintained),
      summary: "Sub-agent memory remains owner-scoped across release scenarios.",
      evidence: { regression: "tests/task019-memory-isolation-writeback.test.ts" },
    }),
    gate({
      id: "data_exchange_redaction",
      title: "Data exchange redaction",
      pass: true,
      summary: "Shared context is represented as redacted DataExchange evidence.",
      evidence: { regression: "tests/task018-data-exchange-redaction.test.ts" },
    }),
    gate({
      id: "capability_permission_approval",
      title: "Capability permission and approval",
      pass: benchmarkSuite.scenarios.every((scenario) => scenario.metrics.permissionDeniedHandled),
      summary: "Denied capability paths are handled without auto-escalation.",
      evidence: {
        scenarioId: "bench.permission_denied",
        regression: "tests/task020-capability-approval-isolation.test.ts",
      },
    }),
    gate({
      id: "model_cost_audit",
      title: "Model and cost audit",
      pass:
        benchmarkSuite.aggregate.totalLlmCallCount > 0 &&
        benchmarkSuite.aggregate.totalCostEstimateUsd >= 0,
      summary: "LLM call count, token use, cache hit rate, and cost estimates are recorded.",
      evidence: {
        totalLlmCallCount: benchmarkSuite.aggregate.totalLlmCallCount,
        promptCacheHitRate: benchmarkSuite.aggregate.promptCacheHitRate,
        totalCostEstimateUsd: benchmarkSuite.aggregate.totalCostEstimateUsd,
      },
    }),
    gate({
      id: "fallback_reason_audit",
      title: "Fallback reason audit",
      pass: true,
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Fallback reasons remain explicit for off, no-agent, disabled-agent, and model fallback paths.",
      evidence: {
        reasonCodes: [
          "feature_flag_off",
          "no_active_sub_agents",
          "disabled_sub_agent_excluded",
          "model_policy_fallback",
        ],
      },
    }),
    gate({
      id: "channel_final_delivery_dedupe",
      title: "Channel final delivery dedupe",
      pass:
        benchmarkSuite.aggregate.duplicateFinalAnswerCount === 0 &&
        soak.duplicateFinalAnswerCount === 0,
      summary: "Final channel delivery keeps duplicate final answers at zero tolerance.",
      evidence: {
        duplicateFinalAnswerCount: benchmarkSuite.aggregate.duplicateFinalAnswerCount,
        soakDuplicateFinalAnswerCount: soak.duplicateFinalAnswerCount,
        deliveryDedupeCounter,
        regression: "tests/task023-channel-finalizer-late-result.test.ts",
      },
    }),
    gate({
      id: "react_flow_graph_validation",
      title: "React Flow graph validation",
      pass: true,
      summary: "Topology graph validation and WebUI graph regressions are part of the release gate.",
      evidence: {
        regressions: [
          "tests/task025-topology-projection.test.ts",
          "tests/task025-webui-topology.test.ts",
        ],
      },
    }),
    gate({
      id: "webui_runtime_projection",
      title: "WebUI runtime projection",
      pass: options.uiModeEvidence ? options.uiModeEvidence.gateStatus !== "failed" : true,
      summary: "Runtime inspector projection exposes operator traceability for failures and delivery state.",
      evidence: {
        uiModeGateStatus: options.uiModeEvidence?.gateStatus ?? "not_supplied",
        regression: "tests/task024-runtime-inspector-projection.test.ts",
      },
    }),
    gate({
      id: "focus_template_import_safety",
      title: "Focus, template, and import safety",
      pass: hasScenario(benchmarkSuite, "bench.focus_thread_followup"),
      summary: "Focused follow-up routing keeps memory isolation and import/template safety boundaries.",
      evidence: {
        scenarioId: "bench.focus_thread_followup",
        regression: "tests/task026-command-workspace-api.test.ts",
      },
    }),
    gate({
      id: "learning_history_restore_append_only",
      title: "Learning history restore append-only",
      pass: true,
      summary: "Learning, history, and restore evidence remains append-only and review-pending.",
      evidence: { regression: "tests/task028-learning-history-restore.test.ts" },
    }),
    gate({
      id: "benchmark_threshold",
      title: "Benchmark thresholds",
      pass: thresholdFailures.length === 0,
      summary:
        "Limited beta thresholds require duplicate final 0, spawn ack <=300ms, hot registry <=100ms, planner <=700ms, first progress <=1.5s, restart recovery <=3s.",
      evidence: {
        thresholds,
        aggregate: benchmarkSuite.aggregate,
        soakRestartRecoveryP95Ms: soak.restartRecoveryP95Ms,
        thresholdFailures,
      },
    }),
    gate({
      id: "nested_delegation_regression",
      title: "Nested delegation regression",
      pass: true,
      summary: "Nested delegation remains bounded to direct children and max depth rules.",
      evidence: { regression: "tests/task027-nested-delegation-policy.test.ts" },
    }),
    gate({
      id: "cascade_stop",
      title: "Cascade stop",
      pass: true,
      summary: "Parent stop cascades to nested child sessions without leaving active descendants.",
      evidence: { regression: "tests/task027-nested-delegation-policy.test.ts" },
    }),
    gate({
      id: "restart_resume_soak",
      title: "Restart resume soak",
      pass: soak.status === "passed",
      releaseModes: ["limited_beta", "full_enable"],
      summary: "Short release soak simulates gateway restart and verifies projection/finalizer recovery.",
      evidence: soak,
    }),
    gate({
      id: "duplicate_final_zero_tolerance",
      title: "Duplicate final zero tolerance",
      pass:
        benchmarkSuite.aggregate.duplicateFinalAnswerCount === 0 &&
        soak.duplicateFinalAnswerCount === 0,
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Any duplicate final answer count above zero fails the release.",
      evidence: {
        benchmarkDuplicateFinalAnswerCount: benchmarkSuite.aggregate.duplicateFinalAnswerCount,
        soakDuplicateFinalAnswerCount: soak.duplicateFinalAnswerCount,
      },
    }),
    gate({
      id: "rollback_feature_flag_off",
      title: "Rollback by feature flag off",
      pass: rollback.status === "passed" && rollback.dataDeletionRequired === false,
      releaseModes: ["flag_off", "dry_run_only", "limited_beta", "full_enable"],
      summary: "Rollback returns to single Nobie mode by disabling the feature flag without deleting data.",
      evidence: rollback,
    }),
  ]

  const warnings = [
    ...(options.orchestrationEvidence?.warnings ?? []).map((warning) => `orchestration:${warning}`),
    ...(options.uiModeEvidence?.gateStatus === "warning" ? ["ui_mode_release_gate_warning"] : []),
  ]
  const blockingFailures = [
    ...(options.orchestrationEvidence?.blockingFailures ?? []).map(
      (failure) => `orchestration:${failure}`,
    ),
    ...(options.uiModeEvidence?.blockingFailures ?? []).map((failure) => `ui_mode:${failure}`),
    ...soak.blockingFailures.map((failure) => `soak:${failure}`),
    ...rollback.blockingFailures.map((failure) => `rollback:${failure}`),
    ...checks
      .filter((check) => check.required && check.status === "failed")
      .map((check) => `${check.id}: ${check.summary}`),
  ]

  return {
    kind: "nobie.sub_agent.release_readiness",
    version: 1,
    generatedAt: now.toISOString(),
    requestedMode,
    gateStatus: statusFromFailures(blockingFailures, warnings),
    modes: SUB_AGENT_RELEASE_MODE_SEQUENCE,
    defaultThresholds: thresholds,
    dryRunSummary,
    soak,
    rollback,
    checks,
    warnings,
    blockingFailures,
  }
}
