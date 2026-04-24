import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  constants,
  accessSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import {
  type MigrationPreflightReport,
  buildBackupTargetInventory,
  buildMigrationPreflightReport,
} from "../config/backup-rehearsal.js"
import { DEFAULT_CONFIG, type OrchestrationConfig } from "../config/types.js"
import { type PlanDriftReleaseNoteEvidence, runPlanDriftCheck } from "../diagnostics/plan-drift.js"
import { type PromptSourceMetadata, loadPromptSourceRegistry } from "../memory/nobie-md.js"
import {
  type OrchestrationModeSnapshot,
  resolveOrchestrationModeSnapshotSync,
} from "../orchestration/mode.js"
import {
  type WebRetrievalReleaseGateSummary,
  buildFixtureRegressionFromWorkspace,
  buildWebRetrievalReleaseGateSummary,
} from "../runs/web-retrieval-smoke.js"
import { type FeatureFlagMode, buildRolloutSafetySnapshot } from "../runtime/rollout-safety.js"
import { getCurrentAppVersion, getCurrentDisplayVersion, getWorkspaceRootPath } from "../version.js"
import {
  type ReleasePerformanceSummary,
  buildReleasePerformanceSummary,
} from "./performance-gate.js"
import { type UiModeReleaseGateSummary, buildUiModeReleaseGateSummary } from "./ui-mode-gate.js"

export type ReleaseTargetPlatform = "macos" | "windows" | "linux"

export type ReleaseArtifactKind =
  | "gateway_node_bundle"
  | "webui_static"
  | "yeonjang_macos_app"
  | "yeonjang_windows_exe"
  | "yeonjang_linux_binary"
  | "yeonjang_script"
  | "yeonjang_protocol"
  | "db_migration"
  | "prompt_seed"
  | "release_runbook"
  | "admin_diagnostic_bundle"

export type ReleaseArtifactStatus = "present" | "missing_required" | "missing_optional"

export interface ReleaseArtifactDefinition {
  id: string
  kind: ReleaseArtifactKind
  sourcePath: string
  packagePath: string
  required: boolean
  platform?: ReleaseTargetPlatform
  description: string
}

export interface ReleaseArtifact extends ReleaseArtifactDefinition {
  status: ReleaseArtifactStatus
  sizeBytes: number | null
  checksum: string | null
}

export interface ReleaseManifest {
  kind: "nobie.release.package"
  version: 1
  releaseVersion: string
  appVersion: string
  gitTag: string | null
  gitCommit: string | null
  createdAt: string
  rootDir: string
  targetPlatforms: ReleaseTargetPlatform[]
  artifacts: ReleaseArtifact[]
  requiredMissing: string[]
  checksums: Array<{ id: string; checksum: string; packagePath: string }>
  backupInventory: {
    included: number
    excluded: number
    promptSources: number
    logicalCoverage: string[]
  }
  updatePreflight: ReleaseUpdatePreflightReport
  migrationPreflight: Pick<
    MigrationPreflightReport,
    "ok" | "risk" | "currentSchemaVersion" | "latestSchemaVersion" | "pendingVersions"
  >
  featureFlags: ReleaseFeatureFlagState[]
  rolloutEvidence: ReleaseRolloutEvidenceSummary
  planEvidence: PlanDriftReleaseNoteEvidence
  webRetrievalEvidence: WebRetrievalReleaseGateSummary
  uiModeEvidence: UiModeReleaseGateSummary
  performanceEvidence: ReleasePerformanceSummary
  orchestrationEvidence: ReleaseOrchestrationEvidenceSummary
  releaseNotes: ReleaseNoteSummary
  pipeline: ReleasePipelinePlan
  rollback: ReleaseRollbackRunbook
  cleanInstallChecklist: ReleaseChecklistItem[]
}

export interface ReleasePipelineStep {
  id: string
  title: string
  command: string[]
  required: boolean
  smoke: boolean
  description: string
}

export interface ReleaseFeatureFlagState {
  featureKey: string
  mode: FeatureFlagMode
  compatibilityMode: boolean
  source: "default" | "db"
}

export type ReleaseOrchestrationEvidenceStatus = "passed" | "warning" | "failed"

export interface ReleaseOrchestrationEvidenceCheck {
  id: "feature_flag_off_parity" | "no_agent_fallback" | "runtime_flag_default"
  status: ReleaseOrchestrationEvidenceStatus
  summary: string
  detail: Record<string, unknown>
}

export interface ReleaseOrchestrationEvidenceSummary {
  kind: "nobie.release.orchestration"
  generatedAt: string
  gateStatus: ReleaseOrchestrationEvidenceStatus
  checks: ReleaseOrchestrationEvidenceCheck[]
  warnings: string[]
  blockingFailures: string[]
}

export interface ReleaseRolloutEvidenceSummary {
  mismatchCount: number
  warningCount: number
  blockedCount: number
  latest: Array<{ featureKey: string; stage: string; status: string; summary: string }>
}

export interface ReleasePipelinePlan {
  dryRunSafe: true
  order: string[]
  steps: ReleasePipelineStep[]
}

export interface ReleaseRollbackRunbook {
  id: "release-rollback-runbook"
  title: string
  stopBeforeRollback: string[]
  restoreTargets: string[]
  steps: string[]
  verification: string[]
  retryForbiddenWhen: string[]
}

export interface ReleaseChecklistItem {
  id: string
  required: boolean
  description: string
}

export interface ReleaseNoteSummary {
  featureFlagDefaults: string[]
  migrationCautions: string[]
  rollbackProcedure: string[]
  knownLimitations: string[]
}

export interface ReleaseUpdatePreflightCheck {
  id: string
  ok: boolean
  required: boolean
  message: string
}

export interface ReleaseUpdatePreflightReport {
  ok: boolean
  checks: ReleaseUpdatePreflightCheck[]
}

export interface ReleaseManifestOptions {
  rootDir?: string
  outputDir?: string
  releaseVersion?: string
  gitTag?: string | null
  gitCommit?: string | null
  targetPlatforms?: ReleaseTargetPlatform[]
  now?: Date
  promptSources?: PromptSourceMetadata[]
}

export interface ReleasePackageWriteResult {
  outputDir: string
  manifestPath: string
  checksumPath: string
  copiedArtifacts: Array<{ id: string; sourcePath: string; targetPath: string }>
  manifest: ReleaseManifest
}

const DEFAULT_TARGET_PLATFORMS: ReleaseTargetPlatform[] = ["macos", "windows", "linux"]

export function buildReleaseManifest(options: ReleaseManifestOptions = {}): ReleaseManifest {
  const rootDir = resolve(options.rootDir ?? getWorkspaceRootPath())
  const targetPlatforms = options.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS
  const releaseVersion = options.releaseVersion ?? getCurrentDisplayVersion()
  const appVersion = getCurrentAppVersion()
  const gitTag =
    options.gitTag === undefined
      ? readGitValue(rootDir, ["describe", "--tags", "--always", "--dirty"])
      : options.gitTag
  const gitCommit =
    options.gitCommit === undefined
      ? readGitValue(rootDir, ["rev-parse", "--short", "HEAD"])
      : options.gitCommit
  const promptSources = options.promptSources ?? safePromptSources(rootDir)
  const definitions = buildReleaseArtifactDefinitions({ rootDir, targetPlatforms, promptSources })
  const artifacts = definitions.map(materializeArtifact)
  const backupInventory = safeBackupInventory(rootDir)
  const migrationPreflight = buildMigrationPreflightReport({
    providerConfigSane: true,
    canWrite: true,
  })
  const updatePreflight = buildReleaseUpdatePreflightReport({
    rootDir,
    targetPlatforms,
    promptSourceCount: promptSources.length,
  })
  const rollout = buildRolloutSafetySnapshot()
  const planDrift = safePlanDrift(rootDir)
  const webRetrievalEvidence = buildWebRetrievalReleaseGateSummary({
    fixtureRegression: safeWebRetrievalFixtureRegression(rootDir),
    liveSmoke: null,
  })
  const uiModeEvidence = buildUiModeReleaseGateSummary()
  const performanceEvidence = buildReleasePerformanceSummary(
    options.now ? { now: options.now } : {},
  )
  const featureFlags = rollout.featureFlags.map((flag) => ({
    featureKey: flag.featureKey,
    mode: flag.mode,
    compatibilityMode: flag.compatibilityMode,
    source: flag.source,
  }))
  const orchestrationEvidence = buildReleaseOrchestrationEvidence({
    now: options.now ?? new Date(),
    featureFlags,
  })
  const rollback = buildReleaseRollbackRunbook()
  const releaseNotes = buildReleaseNoteSummary({
    featureFlags,
    migrationPreflight,
    performanceEvidence,
    orchestrationEvidence,
    rollback,
    webRetrievalEvidence,
    uiModeEvidence,
  })

  return {
    kind: "nobie.release.package",
    version: 1,
    releaseVersion,
    appVersion,
    gitTag,
    gitCommit,
    createdAt: (options.now ?? new Date()).toISOString(),
    rootDir,
    targetPlatforms,
    artifacts,
    requiredMissing: artifacts
      .filter((artifact) => artifact.status === "missing_required")
      .map((artifact) => artifact.id),
    checksums: artifacts
      .filter(
        (artifact): artifact is ReleaseArtifact & { checksum: string } =>
          artifact.checksum !== null,
      )
      .map((artifact) => ({
        id: artifact.id,
        checksum: artifact.checksum,
        packagePath: artifact.packagePath,
      })),
    backupInventory: {
      included: backupInventory.included,
      excluded: backupInventory.excluded,
      promptSources: backupInventory.promptSources,
      logicalCoverage: backupInventory.logicalCoverage,
    },
    updatePreflight,
    migrationPreflight: {
      ok: migrationPreflight.ok,
      risk: migrationPreflight.risk,
      currentSchemaVersion: migrationPreflight.currentSchemaVersion,
      latestSchemaVersion: migrationPreflight.latestSchemaVersion,
      pendingVersions: migrationPreflight.pendingVersions,
    },
    featureFlags,
    rolloutEvidence: {
      mismatchCount: rollout.shadowCompare.mismatchCount,
      warningCount: rollout.evidence.warningCount,
      blockedCount: rollout.evidence.blockedCount,
      latest: rollout.evidence.latest.map((item) => ({
        featureKey: item.feature_key,
        stage: item.stage,
        status: item.status,
        summary: item.summary,
      })),
    },
    planEvidence: planDrift.releaseNoteEvidence,
    webRetrievalEvidence,
    uiModeEvidence,
    performanceEvidence,
    orchestrationEvidence,
    releaseNotes,
    pipeline: buildReleasePipelinePlan({ targetPlatforms }),
    rollback,
    cleanInstallChecklist: buildCleanMachineInstallChecklist(),
  }
}

export function buildReleaseArtifactDefinitions(input: {
  rootDir: string
  targetPlatforms?: ReleaseTargetPlatform[]
  promptSources?: PromptSourceMetadata[]
}): ReleaseArtifactDefinition[] {
  const rootDir = resolve(input.rootDir)
  const targetPlatforms = new Set(input.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS)
  const promptSources = input.promptSources ?? safePromptSources(rootDir)
  const definitions: ReleaseArtifactDefinition[] = [
    requiredArtifact(
      "gateway:cli",
      "gateway_node_bundle",
      rootDir,
      "packages/cli/dist/index.js",
      "gateway/packages/cli/dist/index.js",
      "CLI daemon entrypoint bundle.",
    ),
    requiredArtifact(
      "gateway:core",
      "gateway_node_bundle",
      rootDir,
      "packages/core/dist/index.js",
      "gateway/packages/core/dist/index.js",
      "Core runtime bundle.",
    ),
    requiredArtifact(
      "webui:static",
      "webui_static",
      rootDir,
      "packages/webui/dist",
      "webui/dist",
      "Static WebUI build directory.",
    ),
    requiredArtifact(
      "db:migrations",
      "db_migration",
      rootDir,
      "packages/core/src/db/migrations.ts",
      "db/migrations.ts",
      "DB migration source included for release audit.",
    ),
    requiredArtifact(
      "yeonjang:protocol",
      "yeonjang_protocol",
      rootDir,
      "Yeonjang/src/protocol.rs",
      "yeonjang/protocol.rs",
      "Yeonjang protocol contract source.",
    ),
    requiredArtifact(
      "yeonjang:permissions",
      "yeonjang_protocol",
      rootDir,
      "Yeonjang/manifests/permissions.json",
      "yeonjang/permissions.json",
      "Yeonjang permission manifest.",
    ),
    requiredArtifact(
      "runbook:release",
      "release_runbook",
      rootDir,
      "docs/release-runbook.md",
      "docs/release-runbook.md",
      "Install, update, rollback, and recovery runbook.",
    ),
    optionalArtifact(
      "admin:diagnostic-bundle",
      "admin_diagnostic_bundle",
      rootDir,
      "release/admin-diagnostics.json",
      "diagnostics/admin-diagnostics.json",
      "Sanitized admin diagnostics bundle captured during release dry-run.",
    ),
  ]

  for (const source of promptSources) {
    definitions.push({
      id: `prompt:${source.sourceId}:${source.locale}`,
      kind: "prompt_seed",
      sourcePath: resolve(source.path),
      packagePath: `prompts/${basename(source.path)}`,
      required: source.required,
      description: `Prompt seed ${source.sourceId}:${source.locale}@${source.version}`,
    })
  }

  if (targetPlatforms.has("macos")) {
    definitions.push(
      optionalArtifact(
        "yeonjang:macos:app",
        "yeonjang_macos_app",
        rootDir,
        "Yeonjang/target/release/Yeonjang.app",
        "yeonjang/macos/Yeonjang.app",
        "macOS tray app bundle.",
        "macos",
      ),
    )
    definitions.push(
      requiredArtifact(
        "yeonjang:macos:build-script",
        "yeonjang_script",
        rootDir,
        "scripts/build-yeonjang-macos.sh",
        "scripts/build-yeonjang-macos.sh",
        "macOS Yeonjang build script.",
        "macos",
      ),
    )
    definitions.push(
      requiredArtifact(
        "yeonjang:macos:start-script",
        "yeonjang_script",
        rootDir,
        "scripts/start-yeonjang-macos.sh",
        "scripts/start-yeonjang-macos.sh",
        "macOS Yeonjang start script.",
        "macos",
      ),
    )
  }

  if (targetPlatforms.has("windows")) {
    definitions.push(
      optionalArtifact(
        "yeonjang:windows:exe",
        "yeonjang_windows_exe",
        rootDir,
        "Yeonjang/target/release/nobie-yeonjang.exe",
        "yeonjang/windows/nobie-yeonjang.exe",
        "Windows tray executable.",
        "windows",
      ),
    )
    definitions.push(
      requiredArtifact(
        "yeonjang:windows:build-script",
        "yeonjang_script",
        rootDir,
        "scripts/build-yeonjang-windows.bat",
        "scripts/build-yeonjang-windows.bat",
        "Windows Yeonjang build/start package script.",
        "windows",
      ),
    )
    definitions.push(
      requiredArtifact(
        "yeonjang:windows:start-script",
        "yeonjang_script",
        rootDir,
        "scripts/start-yeonjang-windows.bat",
        "scripts/start-yeonjang-windows.bat",
        "Windows Yeonjang start script.",
        "windows",
      ),
    )
    definitions.push(
      requiredArtifact(
        "yeonjang:windows:stop-script",
        "yeonjang_script",
        rootDir,
        "scripts/stop-yeonjang-windows.bat",
        "scripts/stop-yeonjang-windows.bat",
        "Windows Yeonjang stop script.",
        "windows",
      ),
    )
  }

  if (targetPlatforms.has("linux")) {
    definitions.push(
      optionalArtifact(
        "yeonjang:linux:binary",
        "yeonjang_linux_binary",
        rootDir,
        "Yeonjang/target/release/nobie-yeonjang",
        "yeonjang/linux/nobie-yeonjang",
        "Linux Yeonjang executable.",
        "linux",
      ),
    )
  }

  return definitions
}

export function buildReleasePipelinePlan(
  input: { targetPlatforms?: ReleaseTargetPlatform[] } = {},
): ReleasePipelinePlan {
  const targetPlatforms = new Set(input.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS)
  const steps: ReleasePipelineStep[] = [
    step(
      "environment-preflight",
      "Environment preflight",
      ["node", "scripts/release-package.mjs", "--dry-run", "--json"],
      true,
      false,
      "Validate version, artifact definitions, migration state, and backup inventory without mutating runtime state.",
    ),
    step(
      "clean-build",
      "Clean build",
      ["pnpm", "-r", "build"],
      true,
      false,
      "Build Gateway, CLI, Core, and WebUI from a clean checkout.",
    ),
    step(
      "typecheck",
      "Typecheck",
      ["pnpm", "-r", "typecheck"],
      true,
      false,
      "Run TypeScript type checks before packaging.",
    ),
    step(
      "unit-tests",
      "Unit and integration tests",
      ["pnpm", "test"],
      true,
      false,
      "Run automated regression tests.",
    ),
    step(
      "orchestration-release-gate",
      "Orchestration release gate",
      [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "tests/task001-sub-agent-contracts.test.ts",
        "tests/task003-orchestration-mode.test.ts",
        "tests/task004-orchestration-planner.test.ts",
        "tests/task006-sub-session-runtime.test.ts",
        "tests/task013-channel-delivery-observability.test.ts",
      ],
      true,
      false,
      "Verify feature flag off parity, no-agent fallback, orchestration contracts, planner, runtime, and channel delivery orchestration guards.",
    ),
    step(
      "memory-isolation-release-gate",
      "Memory isolation release gate",
      ["pnpm", "test", "tests/task019-memory-isolation-writeback.test.ts"],
      true,
      false,
      "Verify owner-scope memory isolation, DataExchange-only shared context, writeback owner policy, and memory access audit regressions.",
    ),
    step(
      "capability-isolation-release-gate",
      "Capability isolation release gate",
      [
        "pnpm",
        "test",
        "tests/task020-capability-approval-isolation.test.ts",
        "tests/mcp-client.test.ts",
      ],
      true,
      false,
      "Verify agent-scoped tool and MCP capability binding isolation, secret scope separation, approval propagation, and capability delegation audit regressions.",
    ),
    step(
      "model-execution-release-gate",
      "Model execution policy release gate",
      ["pnpm", "test", "tests/task021-model-execution-policy.test.ts"],
      true,
      false,
      "Verify agent model resolver, provider capability matrix, timeout retry and fallback behavior, model cost budgets, and token cost latency audit summaries.",
    ),
    step(
      "performance-release-gate",
      "Performance and release summary gate",
      ["pnpm", "exec", "vitest", "run", "tests/task014-release-readiness.test.ts"],
      true,
      false,
      "Verify latency targets, release performance evidence, orchestration feature flag defaults, rollback notes, and release summary warnings.",
    ),
    step(
      "web-retrieval-fixture-regression",
      "Web retrieval fixture regression",
      ["pnpm", "test", "tests/task008-web-retrieval-fixtures.test.ts"],
      true,
      false,
      "Run offline KOSPI, KOSDAQ, NASDAQ, weather, timeout, and no-network retrieval regression fixtures.",
    ),
    step(
      "ui-mode-release-gate",
      "UI mode release gate",
      ["pnpm", "test", "tests/task017-ui-release-gate.test.ts"],
      true,
      false,
      "Verify beginner, advanced, and admin smoke matrix, redaction, admin guard, route redirects, and UI regression blockers.",
    ),
    step(
      "backup-rehearsal",
      "Backup and restore rehearsal",
      ["pnpm", "run", "backup:rehearsal"],
      true,
      false,
      "Verify DB, prompt, migration, and restore rehearsal paths.",
    ),
    step(
      "admin-diagnostic-export",
      "Admin diagnostic export rehearsal",
      ["pnpm", "exec", "vitest", "run", "tests/task014-admin-platform-export.test.ts"],
      true,
      false,
      "Verify sanitized admin diagnostics export and bundle generation contract.",
    ),
    step(
      "channel-smoke-dry-run",
      "Channel smoke dry-run",
      ["pnpm", "run", "smoke:channels"],
      true,
      true,
      "Verify WebUI, Telegram, and Slack delivery pipeline without live external send unless configured.",
    ),
  ]
  if (targetPlatforms.has("macos"))
    steps.push(
      step(
        "yeonjang-macos",
        "Yeonjang macOS package",
        ["bash", "scripts/build-yeonjang-macos.sh"],
        false,
        true,
        "Build macOS tray app bundle when running on macOS.",
      ),
    )
  if (targetPlatforms.has("windows"))
    steps.push(
      step(
        "yeonjang-windows",
        "Yeonjang Windows package",
        ["scripts\\build-yeonjang-windows.bat"],
        false,
        true,
        "Build Windows tray executable on Windows or a Windows build host.",
      ),
    )
  if (targetPlatforms.has("linux"))
    steps.push(
      step(
        "yeonjang-linux",
        "Yeonjang Linux package",
        ["cargo", "build", "--manifest-path", "Yeonjang/Cargo.toml", "--release"],
        false,
        true,
        "Build Linux Yeonjang binary on a Linux build host.",
      ),
    )
  steps.push(
    step(
      "package-manifest",
      "Package manifest and checksums",
      ["node", "scripts/release-package.mjs"],
      true,
      false,
      "Copy release payload entries and generate manifest.json plus SHA256SUMS.",
    ),
  )
  steps.push(
    step(
      "rollout-shadow-evidence",
      "Rollout shadow evidence review",
      ["pnpm", "exec", "nobie", "doctor", "--json"],
      true,
      false,
      "Confirm feature flags, migration lock status, and shadow compare evidence before enforced rollout.",
    ),
  )
  steps.push(
    step(
      "plan-drift-evidence",
      "Plan and task evidence review",
      ["pnpm", "exec", "nobie", "doctor", "--json"],
      true,
      false,
      "Confirm phase plans, task evidence, and release-note evidence summary before publishing.",
    ),
  )
  steps.push(
    step(
      "web-retrieval-live-smoke",
      "Web retrieval live smoke",
      [
        "env",
        "NOBIE_LIVE_WEB_SMOKE=1",
        "pnpm",
        "test",
        "tests/task008-live-web-smoke-dry-run.test.ts",
      ],
      false,
      true,
      "Opt-in latest-value smoke gate for KOSPI, KOSDAQ, NASDAQ, and weather; exact values are not asserted.",
    ),
  )
  steps.push(
    step(
      "live-smoke-gate",
      "Live smoke gate",
      ["pnpm", "exec", "nobie", "smoke", "channels", "--live"],
      false,
      true,
      "Run at least one real channel live smoke before publishing a public release.",
    ),
  )
  return { dryRunSafe: true, order: steps.map((item) => item.id), steps }
}

export function buildReleaseRollbackRunbook(): ReleaseRollbackRunbook {
  return {
    id: "release-rollback-runbook",
    title: "Release rollback runbook",
    stopBeforeRollback: [
      "Stop Gateway service, channel adapters, scheduler, and Yeonjang writers.",
      "Confirm no process is writing the operational SQLite DB or prompt registry.",
    ],
    restoreTargets: [
      "Gateway/CLI/Core binary bundle",
      "WebUI static bundle",
      "state/data.db and SQLite sidecars",
      "state/memory.db3 vector DB",
      "prompts/*.md and prompts/*.md.en seed files",
      "config file with secret re-entry as needed",
      "Yeonjang executable plus protocol/permission manifests",
    ],
    steps: [
      "Verify the release manifest checksum and the selected backup snapshot checksum.",
      "Copy the current runtime state into a rollback-of-rollback snapshot.",
      "Restore the previous release binary payload and WebUI static files.",
      "Disable the orchestration feature flag or set it to rollback compatibility mode before restoring state when delegation-related regressions are suspected.",
      "Restore the DB and prompt files into a rehearsal directory first.",
      "Run SQLite integrity_check, migration status, and prompt source registry checks.",
      "Re-run migration rehearsal and admin diagnostic export against the rehearsal directory before swapping operational files.",
      "Replace operational DB, prompt registry, config, and Yeonjang package only after rehearsal passes.",
      "Restart Gateway and Yeonjang, then run channel smoke and Yeonjang screen/capability smoke.",
    ],
    verification: [
      "Gateway /api/status displayVersion matches the rollback release.",
      "Feature flags show orchestration disabled or rollback-compatible until the incident is closed.",
      "Prompt source checksum matches the restored prompt registry.",
      "Existing schedules and memory search load without migration warnings.",
      "Yeonjang node.ping protocolVersion is compatible with Gateway expectations.",
      "At least one live channel delivery smoke passes after restart.",
    ],
    retryForbiddenWhen: [
      "Backup or release manifest checksum fails.",
      "SQLite integrity_check fails in rehearsal.",
      "Prompt source registry cannot load from rehearsal directory.",
      "Yeonjang protocol version is newer than the rollback Gateway can parse.",
      "Feature flag rollback still leaves no-agent fallback broken in compatibility smoke.",
    ],
  }
}

export function buildCleanMachineInstallChecklist(): ReleaseChecklistItem[] {
  return [
    {
      id: "node",
      required: true,
      description: "Node.js 22+ is installed and `node --version` passes.",
    },
    { id: "pnpm", required: true, description: "pnpm is available for workspace install/build." },
    {
      id: "state-dir",
      required: true,
      description: "A writable NOBIE_STATE_DIR or default ~/.nobie state directory exists.",
    },
    {
      id: "prompt-seed",
      required: true,
      description:
        "Prompt seed files are present and prompt source registry loads without sys_prop dependency.",
    },
    {
      id: "db-migration",
      required: true,
      description: "Initial DB migration applies cleanly from an empty database.",
    },
    {
      id: "feature-flags",
      required: true,
      description:
        "Runtime feature flags are reviewed and any rollback/shadow mismatch evidence is accepted before enforced rollout.",
    },
    {
      id: "orchestration-release-gate",
      required: true,
      description:
        "Sub-agent orchestration feature flag default, off-state parity, and no-agent fallback evidence are reviewed before publish.",
    },
    {
      id: "memory-isolation-release-gate",
      required: true,
      description:
        "Owner-scoped memory, DataExchange-only context sharing, writeback owner policy, and memory access audit regressions pass.",
    },
    {
      id: "capability-isolation-release-gate",
      required: true,
      description:
        "Agent-scoped tool, MCP, Skill, secret scope, approval propagation, and capability delegation audit regressions pass.",
    },
    {
      id: "model-execution-release-gate",
      required: true,
      description:
        "Agent model resolver, provider matrix, timeout retry and fallback policy, cost budget, and token cost latency audit regressions pass.",
    },
    {
      id: "performance-release-gate",
      required: true,
      description:
        "Latency targets, queue wait, first progress, finalization, delivery dedupe, and concurrency block evidence are reviewed in the release summary.",
    },
    {
      id: "plan-drift",
      required: true,
      description:
        "Phase plan and task evidence drift check has no unreviewed completed-without-evidence warnings.",
    },
    {
      id: "web-retrieval-fixtures",
      required: true,
      description:
        "Offline web retrieval fixture regression passes and release manifest includes retrieval policy evidence.",
    },
    {
      id: "ui-mode-release-gate",
      required: true,
      description:
        "Beginner, advanced, and admin UI mode smoke matrix, redaction, route guard, and redirect evidence pass.",
    },
    {
      id: "admin-diagnostics",
      required: true,
      description:
        "A sanitized admin diagnostics bundle is exportable and attached or explicitly marked missing in the release artifact list.",
    },
    {
      id: "webui",
      required: true,
      description: "WebUI static files are served and /api/status returns displayVersion.",
    },
    {
      id: "yeonjang-macos",
      required: false,
      description: "macOS Yeonjang app enters tray and publishes MQTT capability status.",
    },
    {
      id: "yeonjang-windows",
      required: false,
      description: "Windows Yeonjang starts without console and screen capture smoke passes.",
    },
    {
      id: "channel-smoke",
      required: true,
      description:
        "At least WebUI dry-run smoke passes; live Telegram/Slack smoke is required before public publish.",
    },
  ]
}

function buildReleaseNoteSummary(input: {
  featureFlags: ReleaseFeatureFlagState[]
  migrationPreflight: Pick<
    MigrationPreflightReport,
    "ok" | "risk" | "currentSchemaVersion" | "latestSchemaVersion" | "pendingVersions"
  >
  performanceEvidence: ReleasePerformanceSummary
  orchestrationEvidence: ReleaseOrchestrationEvidenceSummary
  rollback: ReleaseRollbackRunbook
  webRetrievalEvidence: WebRetrievalReleaseGateSummary
  uiModeEvidence: UiModeReleaseGateSummary
}): ReleaseNoteSummary {
  const orchestrationFlag = input.featureFlags.find(
    (flag) => flag.featureKey === "sub_agent_orchestration",
  )
  return {
    featureFlagDefaults: input.featureFlags
      .map(
        (flag) =>
          `${flag.featureKey}: mode=${flag.mode}, compatibility=${flag.compatibilityMode ? "on" : "off"}`,
      )
      .sort(),
    migrationCautions: [
      `schema current=${input.migrationPreflight.currentSchemaVersion}, latest=${input.migrationPreflight.latestSchemaVersion}, pending=${input.migrationPreflight.pendingVersions.join(",") || "none"}`,
      `migration risk=${input.migrationPreflight.risk}`,
      "Always take a verified DB and prompt backup snapshot immediately before a live rollout.",
      "Do not enable orchestration by default unless feature flag off parity and no-agent fallback smoke both pass.",
    ],
    rollbackProcedure: [
      ...input.rollback.steps,
      "Verify feature flag state first, then prefer rollback compatibility mode or full disable before restoring payloads.",
    ],
    knownLimitations: [
      input.performanceEvidence.missingRequiredMetrics.length > 0
        ? `Missing release-window metrics: ${input.performanceEvidence.missingRequiredMetrics.join(", ")}`
        : "Release-window latency metrics were collected for all required task014 targets.",
      `Orchestration release gate: ${input.orchestrationEvidence.gateStatus}`,
      `Web retrieval release gate: ${input.webRetrievalEvidence.gateStatus}`,
      `UI mode release gate: ${input.uiModeEvidence.gateStatus}`,
      orchestrationFlag
        ? `Sub-agent orchestration default is ${orchestrationFlag.mode}; public rollout should keep single Nobie fallback intact.`
        : "Sub-agent orchestration feature flag state is missing from the rollout snapshot.",
    ],
  }
}

export function buildReleaseUpdatePreflightReport(
  input: {
    rootDir?: string
    targetPlatforms?: ReleaseTargetPlatform[]
    promptSourceCount?: number
  } = {},
): ReleaseUpdatePreflightReport {
  const rootDir = resolve(input.rootDir ?? getWorkspaceRootPath())
  const targetPlatforms = new Set(input.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS)
  const checks: ReleaseUpdatePreflightCheck[] = []
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)

  checks.push({
    id: "node-22",
    ok: nodeMajor >= 22,
    required: true,
    message:
      nodeMajor >= 22
        ? `Node.js ${process.version} is supported.`
        : `Node.js 22+ is required; current ${process.version}.`,
  })
  checks.push(
    commandCheck("pnpm", ["--version"], true, "pnpm is available for workspace install/build."),
  )
  checks.push(
    commandCheck(
      "cargo",
      ["--version"],
      targetPlatforms.size > 0,
      "Rust/Cargo is available for Yeonjang builds.",
    ),
  )
  checks.push({
    id: "os-supported",
    ok:
      process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
    required: true,
    message: `Current OS platform is ${process.platform}.`,
  })
  checks.push({
    id: "write-permission",
    ok: canWrite(rootDir),
    required: true,
    message: canWrite(rootDir)
      ? "Workspace write permission is available."
      : "Workspace write permission is blocked.",
  })
  checks.push({
    id: "prompt-seed",
    ok: (input.promptSourceCount ?? safePromptSources(rootDir).length) > 0,
    required: true,
    message: `Prompt seed count: ${input.promptSourceCount ?? safePromptSources(rootDir).length}.`,
  })
  checks.push({
    id: "yeonjang-protocol",
    ok:
      existsSync(join(rootDir, "Yeonjang", "src", "protocol.rs")) &&
      existsSync(join(rootDir, "Yeonjang", "manifests", "permissions.json")),
    required: true,
    message: "Yeonjang protocol and permission manifest must be packaged with the release.",
  })
  checks.push({
    id: "db-backup-required",
    ok: false,
    required: false,
    message:
      "A verified DB/prompt backup snapshot is required immediately before updating a live installation.",
  })

  return {
    ok: checks.every((check) => check.ok || !check.required),
    checks,
  }
}

export function writeReleasePackage(
  options: ReleaseManifestOptions & { outputDir: string; copyPayload?: boolean },
): ReleasePackageWriteResult {
  const manifest = buildReleaseManifest(options)
  const outputDir = resolve(options.outputDir)
  const payloadDir = join(outputDir, "payload")
  mkdirSync(outputDir, { recursive: true })
  if (options.copyPayload !== false) mkdirSync(payloadDir, { recursive: true })

  const copiedArtifacts: ReleasePackageWriteResult["copiedArtifacts"] = []
  if (options.copyPayload !== false) {
    for (const artifact of manifest.artifacts) {
      if (artifact.status !== "present") continue
      const targetPath = join(payloadDir, ...artifact.packagePath.split("/"))
      copyPath(artifact.sourcePath, targetPath)
      copiedArtifacts.push({ id: artifact.id, sourcePath: artifact.sourcePath, targetPath })
    }
  }

  const manifestPath = join(outputDir, "manifest.json")
  const checksumPath = join(outputDir, "SHA256SUMS")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8")
  writeFileSync(
    checksumPath,
    `${manifest.checksums.map((entry) => `${entry.checksum}  ${entry.packagePath}`).join("\n")}\n`,
    "utf-8",
  )
  return { outputDir, manifestPath, checksumPath, copiedArtifacts, manifest }
}

function requiredArtifact(
  id: string,
  kind: ReleaseArtifactKind,
  rootDir: string,
  relativeSourcePath: string,
  packagePath: string,
  description: string,
  platform?: ReleaseTargetPlatform,
): ReleaseArtifactDefinition {
  return {
    id,
    kind,
    sourcePath: resolve(rootDir, relativeSourcePath),
    packagePath,
    required: true,
    description,
    ...(platform ? { platform } : {}),
  }
}

function optionalArtifact(
  id: string,
  kind: ReleaseArtifactKind,
  rootDir: string,
  relativeSourcePath: string,
  packagePath: string,
  description: string,
  platform?: ReleaseTargetPlatform,
): ReleaseArtifactDefinition {
  return {
    id,
    kind,
    sourcePath: resolve(rootDir, relativeSourcePath),
    packagePath,
    required: false,
    description,
    ...(platform ? { platform } : {}),
  }
}

function materializeArtifact(definition: ReleaseArtifactDefinition): ReleaseArtifact {
  if (!existsSync(definition.sourcePath)) {
    return {
      ...definition,
      status: definition.required ? "missing_required" : "missing_optional",
      sizeBytes: null,
      checksum: null,
    }
  }
  return {
    ...definition,
    status: "present",
    sizeBytes: pathSize(definition.sourcePath),
    checksum: checksumPath(definition.sourcePath),
  }
}

function step(
  id: string,
  title: string,
  command: string[],
  required: boolean,
  smoke: boolean,
  description: string,
): ReleasePipelineStep {
  return { id, title, command, required, smoke, description }
}

function commandCheck(
  command: string,
  args: string[],
  required: boolean,
  successMessage: string,
): ReleaseUpdatePreflightCheck {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "ignore"] })
    return { id: `command:${command}`, ok: true, required, message: successMessage }
  } catch {
    return {
      id: `command:${command}`,
      ok: false,
      required,
      message: `${command} was not found or failed to run.`,
    }
  }
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function safePromptSources(rootDir: string): PromptSourceMetadata[] {
  try {
    return loadPromptSourceRegistry(rootDir).map(({ content: _content, ...metadata }) => metadata)
  } catch {
    return []
  }
}

function safeBackupInventory(rootDir: string): {
  included: number
  excluded: number
  promptSources: number
  logicalCoverage: string[]
} {
  try {
    const inventory = buildBackupTargetInventory({ workDir: rootDir })
    return {
      included: inventory.included.length,
      excluded: inventory.excluded.length,
      promptSources: inventory.promptSources.length,
      logicalCoverage: inventory.targets
        .filter((target) => target.kind === "logical_sqlite_table")
        .map((target) => target.relativePath),
    }
  } catch {
    return { included: 0, excluded: 0, promptSources: 0, logicalCoverage: [] }
  }
}

function safePlanDrift(rootDir: string): { releaseNoteEvidence: PlanDriftReleaseNoteEvidence } {
  try {
    return { releaseNoteEvidence: runPlanDriftCheck({ rootDir }).releaseNoteEvidence }
  } catch {
    return {
      releaseNoteEvidence: {
        verifiedTasks: [],
        manualOnlyTasks: [],
        unverifiedTasks: [],
        pendingTasks: [],
        warningsByCode: {
          phase_plan_missing: 0,
          missing_required_section: 0,
          completed_without_evidence: 0,
          missing_referenced_path: 0,
          plan_outdated_claim: 0,
        },
      },
    }
  }
}

function safeWebRetrievalFixtureRegression(rootDir: string) {
  try {
    return buildFixtureRegressionFromWorkspace(rootDir)
  } catch {
    return null
  }
}

function readGitValue(rootDir: string, args: string[]): string | null {
  try {
    const value = execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return value || null
  } catch {
    return null
  }
}

export function buildReleaseOrchestrationEvidence(input: {
  now: Date
  featureFlags: ReleaseFeatureFlagState[]
}): ReleaseOrchestrationEvidenceSummary {
  const checks: ReleaseOrchestrationEvidenceCheck[] = []

  let offRegistryLookups = 0
  const offParitySnapshot = resolveOrchestrationModeSnapshotSync({
    getConfig: () => ({
      orchestration: {
        ...DEFAULT_CONFIG.orchestration,
        mode: "orchestration",
        featureFlagEnabled: false,
      } satisfies OrchestrationConfig,
    }),
    loadRegistry: () => {
      offRegistryLookups += 1
      return {
        activeSubAgents: [
          { agentId: "agent:unexpected", displayName: "Unexpected", source: "config" as const },
        ],
        totalSubAgentCount: 1,
        disabledSubAgentCount: 0,
      }
    },
    now: () => input.now.getTime(),
  })
  checks.push(
    buildOrchestrationCheck({
      id: "feature_flag_off_parity",
      pass:
        offParitySnapshot.mode === "single_nobie" &&
        offParitySnapshot.reasonCode === "feature_flag_off" &&
        offRegistryLookups === 0,
      summary:
        offParitySnapshot.mode === "single_nobie" &&
        offParitySnapshot.reasonCode === "feature_flag_off"
          ? "Feature flag off state keeps the resolver on the single Nobie path without touching the registry."
          : "Feature flag off state no longer guarantees a clean single Nobie fallback.",
      detail: {
        registryLookups: offRegistryLookups,
        snapshot: serializeOrchestrationSnapshot(offParitySnapshot),
      },
    }),
  )

  const noAgentFallbackSnapshot = resolveOrchestrationModeSnapshotSync({
    getConfig: () => ({
      orchestration: {
        ...DEFAULT_CONFIG.orchestration,
        mode: "orchestration",
        featureFlagEnabled: true,
      } satisfies OrchestrationConfig,
    }),
    loadRegistry: () => ({
      activeSubAgents: [],
      totalSubAgentCount: 0,
      disabledSubAgentCount: 0,
    }),
    now: () => input.now.getTime(),
  })
  checks.push(
    buildOrchestrationCheck({
      id: "no_agent_fallback",
      pass:
        noAgentFallbackSnapshot.mode === "single_nobie" &&
        noAgentFallbackSnapshot.reasonCode === "no_active_sub_agents",
      summary:
        noAgentFallbackSnapshot.mode === "single_nobie" &&
        noAgentFallbackSnapshot.reasonCode === "no_active_sub_agents"
          ? "No-agent orchestration requests still fall back to single Nobie automatically."
          : "No-agent fallback no longer resolves cleanly to the single Nobie path.",
      detail: {
        snapshot: serializeOrchestrationSnapshot(noAgentFallbackSnapshot),
      },
    }),
  )

  const runtimeFlag = input.featureFlags.find(
    (flag) => flag.featureKey === "sub_agent_orchestration",
  )
  checks.push({
    id: "runtime_flag_default",
    status:
      runtimeFlag?.mode === "off" && runtimeFlag.compatibilityMode
        ? "passed"
        : runtimeFlag
          ? "warning"
          : "warning",
    summary:
      runtimeFlag?.mode === "off" && runtimeFlag.compatibilityMode
        ? "Runtime orchestration flag default remains off with compatibility mode enabled."
        : runtimeFlag
          ? `Runtime orchestration flag is ${runtimeFlag.mode}; verify this is intentional before public rollout.`
          : "Runtime orchestration flag snapshot is missing.",
    detail: runtimeFlag
      ? {
          featureKey: runtimeFlag.featureKey,
          mode: runtimeFlag.mode,
          compatibilityMode: runtimeFlag.compatibilityMode,
          source: runtimeFlag.source,
        }
      : { featureKey: "sub_agent_orchestration", missing: true },
  })

  const warnings = checks
    .filter((check) => check.status === "warning")
    .map((check) => `${check.id}: ${check.summary}`)
  const blockingFailures = checks
    .filter((check) => check.status === "failed")
    .map((check) => `${check.id}: ${check.summary}`)

  return {
    kind: "nobie.release.orchestration",
    generatedAt: input.now.toISOString(),
    gateStatus: blockingFailures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
    checks,
    warnings,
    blockingFailures,
  }
}

function buildOrchestrationCheck(input: {
  id: ReleaseOrchestrationEvidenceCheck["id"]
  pass: boolean
  summary: string
  detail: Record<string, unknown>
}): ReleaseOrchestrationEvidenceCheck {
  return {
    id: input.id,
    status: input.pass ? "passed" : "failed",
    summary: input.summary,
    detail: input.detail,
  }
}

function serializeOrchestrationSnapshot(
  snapshot: OrchestrationModeSnapshot,
): Record<string, unknown> {
  return {
    mode: snapshot.mode,
    status: snapshot.status,
    featureFlagEnabled: snapshot.featureFlagEnabled,
    requestedMode: snapshot.requestedMode,
    activeSubAgentCount: snapshot.activeSubAgentCount,
    totalSubAgentCount: snapshot.totalSubAgentCount,
    disabledSubAgentCount: snapshot.disabledSubAgentCount,
    reasonCode: snapshot.reasonCode,
    reason: snapshot.reason,
  }
}

function pathSize(path: string): number {
  const stat = statSync(path)
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  return listFiles(path).reduce((sum, file) => sum + statSync(file).size, 0)
}

function checksumPath(path: string): string {
  const stat = statSync(path)
  if (stat.isFile()) return sha256Buffer(readFileSync(path))
  const root = resolve(path)
  const hash = createHash("sha256")
  for (const file of listFiles(root)) {
    const relativePath = relative(root, file).split(sep).join("/")
    hash.update(relativePath)
    hash.update("\0")
    hash.update(sha256Buffer(readFileSync(file)))
    hash.update("\n")
  }
  return hash.digest("hex")
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

function listFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files.sort()
}

function copyPath(sourcePath: string, targetPath: string): void {
  const stat = statSync(sourcePath)
  if (stat.isDirectory()) {
    mkdirSync(targetPath, { recursive: true })
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      copyPath(join(sourcePath, entry.name), join(targetPath, entry.name))
    }
    return
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
}
