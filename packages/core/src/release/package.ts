import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { buildBackupTargetInventory, buildMigrationPreflightReport, type MigrationPreflightReport } from "../config/backup-rehearsal.js"
import { getWorkspaceRootPath, getCurrentAppVersion, getCurrentDisplayVersion } from "../version.js"
import { loadPromptSourceRegistry, type PromptSourceMetadata } from "../memory/nobie-md.js"
import { buildRolloutSafetySnapshot, type FeatureFlagMode } from "../runtime/rollout-safety.js"
import { runPlanDriftCheck, type PlanDriftReleaseNoteEvidence } from "../diagnostics/plan-drift.js"

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
  migrationPreflight: Pick<MigrationPreflightReport, "ok" | "risk" | "currentSchemaVersion" | "latestSchemaVersion" | "pendingVersions">
  featureFlags: ReleaseFeatureFlagState[]
  rolloutEvidence: ReleaseRolloutEvidenceSummary
  planEvidence: PlanDriftReleaseNoteEvidence
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
  const gitTag = options.gitTag === undefined ? readGitValue(rootDir, ["describe", "--tags", "--always", "--dirty"]) : options.gitTag
  const gitCommit = options.gitCommit === undefined ? readGitValue(rootDir, ["rev-parse", "--short", "HEAD"]) : options.gitCommit
  const promptSources = options.promptSources ?? safePromptSources(rootDir)
  const definitions = buildReleaseArtifactDefinitions({ rootDir, targetPlatforms, promptSources })
  const artifacts = definitions.map(materializeArtifact)
  const backupInventory = safeBackupInventory(rootDir)
  const migrationPreflight = buildMigrationPreflightReport({ providerConfigSane: true, canWrite: true })
  const updatePreflight = buildReleaseUpdatePreflightReport({ rootDir, targetPlatforms, promptSourceCount: promptSources.length })
  const rollout = buildRolloutSafetySnapshot()
  const planDrift = safePlanDrift(rootDir)

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
    requiredMissing: artifacts.filter((artifact) => artifact.status === "missing_required").map((artifact) => artifact.id),
    checksums: artifacts
      .filter((artifact): artifact is ReleaseArtifact & { checksum: string } => artifact.checksum !== null)
      .map((artifact) => ({ id: artifact.id, checksum: artifact.checksum, packagePath: artifact.packagePath })),
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
    featureFlags: rollout.featureFlags.map((flag) => ({
      featureKey: flag.featureKey,
      mode: flag.mode,
      compatibilityMode: flag.compatibilityMode,
      source: flag.source,
    })),
    rolloutEvidence: {
      mismatchCount: rollout.shadowCompare.mismatchCount,
      warningCount: rollout.evidence.warningCount,
      blockedCount: rollout.evidence.blockedCount,
      latest: rollout.evidence.latest.map((item) => ({ featureKey: item.feature_key, stage: item.stage, status: item.status, summary: item.summary })),
    },
    planEvidence: planDrift.releaseNoteEvidence,
    pipeline: buildReleasePipelinePlan({ targetPlatforms }),
    rollback: buildReleaseRollbackRunbook(),
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
    requiredArtifact("gateway:cli", "gateway_node_bundle", rootDir, "packages/cli/dist/index.js", "gateway/packages/cli/dist/index.js", "CLI daemon entrypoint bundle."),
    requiredArtifact("gateway:core", "gateway_node_bundle", rootDir, "packages/core/dist/index.js", "gateway/packages/core/dist/index.js", "Core runtime bundle."),
    requiredArtifact("webui:static", "webui_static", rootDir, "packages/webui/dist", "webui/dist", "Static WebUI build directory."),
    requiredArtifact("db:migrations", "db_migration", rootDir, "packages/core/src/db/migrations.ts", "db/migrations.ts", "DB migration source included for release audit."),
    requiredArtifact("yeonjang:protocol", "yeonjang_protocol", rootDir, "Yeonjang/src/protocol.rs", "yeonjang/protocol.rs", "Yeonjang protocol contract source."),
    requiredArtifact("yeonjang:permissions", "yeonjang_protocol", rootDir, "Yeonjang/manifests/permissions.json", "yeonjang/permissions.json", "Yeonjang permission manifest."),
    requiredArtifact("runbook:release", "release_runbook", rootDir, "docs/release-runbook.md", "docs/release-runbook.md", "Install, update, rollback, and recovery runbook."),
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
    definitions.push(optionalArtifact("yeonjang:macos:app", "yeonjang_macos_app", rootDir, "Yeonjang/target/release/Yeonjang.app", "yeonjang/macos/Yeonjang.app", "macOS tray app bundle.", "macos"))
    definitions.push(requiredArtifact("yeonjang:macos:build-script", "yeonjang_script", rootDir, "scripts/build-yeonjang-macos.sh", "scripts/build-yeonjang-macos.sh", "macOS Yeonjang build script.", "macos"))
    definitions.push(requiredArtifact("yeonjang:macos:start-script", "yeonjang_script", rootDir, "scripts/start-yeonjang-macos.sh", "scripts/start-yeonjang-macos.sh", "macOS Yeonjang start script.", "macos"))
  }

  if (targetPlatforms.has("windows")) {
    definitions.push(optionalArtifact("yeonjang:windows:exe", "yeonjang_windows_exe", rootDir, "Yeonjang/target/release/nobie-yeonjang.exe", "yeonjang/windows/nobie-yeonjang.exe", "Windows tray executable.", "windows"))
    definitions.push(requiredArtifact("yeonjang:windows:build-script", "yeonjang_script", rootDir, "scripts/build-yeonjang-windows.bat", "scripts/build-yeonjang-windows.bat", "Windows Yeonjang build/start package script.", "windows"))
    definitions.push(requiredArtifact("yeonjang:windows:start-script", "yeonjang_script", rootDir, "scripts/start-yeonjang-windows.bat", "scripts/start-yeonjang-windows.bat", "Windows Yeonjang start script.", "windows"))
    definitions.push(requiredArtifact("yeonjang:windows:stop-script", "yeonjang_script", rootDir, "scripts/stop-yeonjang-windows.bat", "scripts/stop-yeonjang-windows.bat", "Windows Yeonjang stop script.", "windows"))
  }

  if (targetPlatforms.has("linux")) {
    definitions.push(optionalArtifact("yeonjang:linux:binary", "yeonjang_linux_binary", rootDir, "Yeonjang/target/release/nobie-yeonjang", "yeonjang/linux/nobie-yeonjang", "Linux Yeonjang executable.", "linux"))
  }

  return definitions
}

export function buildReleasePipelinePlan(input: { targetPlatforms?: ReleaseTargetPlatform[] } = {}): ReleasePipelinePlan {
  const targetPlatforms = new Set(input.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS)
  const steps: ReleasePipelineStep[] = [
    step("environment-preflight", "Environment preflight", ["node", "scripts/release-package.mjs", "--dry-run", "--json"], true, false, "Validate version, artifact definitions, migration state, and backup inventory without mutating runtime state."),
    step("clean-build", "Clean build", ["pnpm", "-r", "build"], true, false, "Build Gateway, CLI, Core, and WebUI from a clean checkout."),
    step("typecheck", "Typecheck", ["pnpm", "-r", "typecheck"], true, false, "Run TypeScript type checks before packaging."),
    step("unit-tests", "Unit and integration tests", ["pnpm", "test"], true, false, "Run automated regression tests."),
    step("backup-rehearsal", "Backup and restore rehearsal", ["pnpm", "run", "backup:rehearsal"], true, false, "Verify DB, prompt, migration, and restore rehearsal paths."),
    step("channel-smoke-dry-run", "Channel smoke dry-run", ["pnpm", "run", "smoke:channels"], true, true, "Verify WebUI, Telegram, and Slack delivery pipeline without live external send unless configured."),
  ]
  if (targetPlatforms.has("macos")) steps.push(step("yeonjang-macos", "Yeonjang macOS package", ["bash", "scripts/build-yeonjang-macos.sh"], false, true, "Build macOS tray app bundle when running on macOS."))
  if (targetPlatforms.has("windows")) steps.push(step("yeonjang-windows", "Yeonjang Windows package", ["scripts\\build-yeonjang-windows.bat"], false, true, "Build Windows tray executable on Windows or a Windows build host."))
  if (targetPlatforms.has("linux")) steps.push(step("yeonjang-linux", "Yeonjang Linux package", ["cargo", "build", "--manifest-path", "Yeonjang/Cargo.toml", "--release"], false, true, "Build Linux Yeonjang binary on a Linux build host."))
  steps.push(step("package-manifest", "Package manifest and checksums", ["node", "scripts/release-package.mjs"], true, false, "Copy release payload entries and generate manifest.json plus SHA256SUMS."))
  steps.push(step("rollout-shadow-evidence", "Rollout shadow evidence review", ["pnpm", "exec", "nobie", "doctor", "--json"], true, false, "Confirm feature flags, migration lock status, and shadow compare evidence before enforced rollout."))
  steps.push(step("plan-drift-evidence", "Plan and task evidence review", ["pnpm", "exec", "nobie", "doctor", "--json"], true, false, "Confirm phase plans, task evidence, and release-note evidence summary before publishing."))
  steps.push(step("live-smoke-gate", "Live smoke gate", ["pnpm", "exec", "nobie", "smoke", "channels", "--live"], false, true, "Run at least one real channel live smoke before publishing a public release."))
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
      "Restore the DB and prompt files into a rehearsal directory first.",
      "Run SQLite integrity_check, migration status, and prompt source registry checks.",
      "Replace operational DB, prompt registry, config, and Yeonjang package only after rehearsal passes.",
      "Restart Gateway and Yeonjang, then run channel smoke and Yeonjang screen/capability smoke.",
    ],
    verification: [
      "Gateway /api/status displayVersion matches the rollback release.",
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
    ],
  }
}

export function buildCleanMachineInstallChecklist(): ReleaseChecklistItem[] {
  return [
    { id: "node", required: true, description: "Node.js 22+ is installed and `node --version` passes." },
    { id: "pnpm", required: true, description: "pnpm is available for workspace install/build." },
    { id: "state-dir", required: true, description: "A writable NOBIE_STATE_DIR or default ~/.nobie state directory exists." },
    { id: "prompt-seed", required: true, description: "Prompt seed files are present and prompt source registry loads without sys_prop dependency." },
    { id: "db-migration", required: true, description: "Initial DB migration applies cleanly from an empty database." },
    { id: "feature-flags", required: true, description: "Runtime feature flags are reviewed and any rollback/shadow mismatch evidence is accepted before enforced rollout." },
    { id: "plan-drift", required: true, description: "Phase plan and task evidence drift check has no unreviewed completed-without-evidence warnings." },
    { id: "webui", required: true, description: "WebUI static files are served and /api/status returns displayVersion." },
    { id: "yeonjang-macos", required: false, description: "macOS Yeonjang app enters tray and publishes MQTT capability status." },
    { id: "yeonjang-windows", required: false, description: "Windows Yeonjang starts without console and screen capture smoke passes." },
    { id: "channel-smoke", required: true, description: "At least WebUI dry-run smoke passes; live Telegram/Slack smoke is required before public publish." },
  ]
}

export function buildReleaseUpdatePreflightReport(input: {
  rootDir?: string
  targetPlatforms?: ReleaseTargetPlatform[]
  promptSourceCount?: number
} = {}): ReleaseUpdatePreflightReport {
  const rootDir = resolve(input.rootDir ?? getWorkspaceRootPath())
  const targetPlatforms = new Set(input.targetPlatforms ?? DEFAULT_TARGET_PLATFORMS)
  const checks: ReleaseUpdatePreflightCheck[] = []
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)

  checks.push({
    id: "node-22",
    ok: nodeMajor >= 22,
    required: true,
    message: nodeMajor >= 22 ? `Node.js ${process.version} is supported.` : `Node.js 22+ is required; current ${process.version}.`,
  })
  checks.push(commandCheck("pnpm", ["--version"], true, "pnpm is available for workspace install/build."))
  checks.push(commandCheck("cargo", ["--version"], targetPlatforms.size > 0, "Rust/Cargo is available for Yeonjang builds."))
  checks.push({
    id: "os-supported",
    ok: process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
    required: true,
    message: `Current OS platform is ${process.platform}.`,
  })
  checks.push({
    id: "write-permission",
    ok: canWrite(rootDir),
    required: true,
    message: canWrite(rootDir) ? "Workspace write permission is available." : "Workspace write permission is blocked.",
  })
  checks.push({
    id: "prompt-seed",
    ok: (input.promptSourceCount ?? safePromptSources(rootDir).length) > 0,
    required: true,
    message: `Prompt seed count: ${input.promptSourceCount ?? safePromptSources(rootDir).length}.`,
  })
  checks.push({
    id: "yeonjang-protocol",
    ok: existsSync(join(rootDir, "Yeonjang", "src", "protocol.rs")) && existsSync(join(rootDir, "Yeonjang", "manifests", "permissions.json")),
    required: true,
    message: "Yeonjang protocol and permission manifest must be packaged with the release.",
  })
  checks.push({
    id: "db-backup-required",
    ok: false,
    required: false,
    message: "A verified DB/prompt backup snapshot is required immediately before updating a live installation.",
  })

  return {
    ok: checks.every((check) => check.ok || !check.required),
    checks,
  }
}

export function writeReleasePackage(options: ReleaseManifestOptions & { outputDir: string; copyPayload?: boolean }): ReleasePackageWriteResult {
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
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8")
  writeFileSync(
    checksumPath,
    manifest.checksums.map((entry) => `${entry.checksum}  ${entry.packagePath}`).join("\n") + "\n",
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
  return { id, kind, sourcePath: resolve(rootDir, relativeSourcePath), packagePath, required: true, description, ...(platform ? { platform } : {}) }
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
  return { id, kind, sourcePath: resolve(rootDir, relativeSourcePath), packagePath, required: false, description, ...(platform ? { platform } : {}) }
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

function step(id: string, title: string, command: string[], required: boolean, smoke: boolean, description: string): ReleasePipelineStep {
  return { id, title, command, required, smoke, description }
}

function commandCheck(command: string, args: string[], required: boolean, successMessage: string): ReleaseUpdatePreflightCheck {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "ignore"] })
    return { id: `command:${command}`, ok: true, required, message: successMessage }
  } catch {
    return { id: `command:${command}`, ok: false, required, message: `${command} was not found or failed to run.` }
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

function safeBackupInventory(rootDir: string): { included: number; excluded: number; promptSources: number; logicalCoverage: string[] } {
  try {
    const inventory = buildBackupTargetInventory({ workDir: rootDir })
    return {
      included: inventory.included.length,
      excluded: inventory.excluded.length,
      promptSources: inventory.promptSources.length,
      logicalCoverage: inventory.targets.filter((target) => target.kind === "logical_sqlite_table").map((target) => target.relativePath),
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

function readGitValue(rootDir: string, args: string[]): string | null {
  try {
    const value = execFileSync("git", args, { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    return value || null
  } catch {
    return null
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
