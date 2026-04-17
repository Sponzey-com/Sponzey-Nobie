// Config
export { loadConfig, loadEnv, getConfig, reloadConfig, PATHS } from "./config/index.js"
export { generateAuthToken } from "./config/auth.js"
export {
  MIGRATION_ROLLBACK_RUNBOOK,
  buildBackupTargetInventory,
  buildMigrationPreflightReport,
  createBackupSnapshot,
  formatInventoryPathForDisplay,
  runRestoreRehearsal,
  verifyBackupSnapshotManifest,
} from "./config/backup-rehearsal.js"
export type {
  BackupInventoryTarget,
  BackupSnapshotFile,
  BackupSnapshotManifest,
  BackupSnapshotOptions,
  BackupTargetInventory,
  BackupTargetKind,
  BackupTargetReason,
  MigrationPreflightCheck,
  MigrationPreflightCheckName,
  MigrationPreflightOptions,
  MigrationPreflightReport,
  MigrationPreflightRisk,
  MigrationRollbackRunbook,
  NobieConfig,
  WizbyConfig,
  HowieConfig,
  SecurityConfig,
  TelegramConfig,
  MqttConfig,
  OrchestrationConfig,
  McpConfig,
  McpServerConfig,
  RestoreRehearsalCheck,
  RestoreRehearsalCheckName,
  RestoreRehearsalOptions,
  RestoreRehearsalReport,
  SnapshotVerificationResult,
} from "./config/index.js"
export { getCurrentAppVersion, getCurrentDisplayVersion, getWorkspacePackageJsonPath, getWorkspaceRootPath } from "./version.js"

// Runtime manifest and diagnostics
export { buildRuntimeManifest, getLastRuntimeManifest, refreshRuntimeManifest } from "./runtime/manifest.js"
export {
  buildRolloutSafetySnapshot,
  ensureRolloutSafetyTables,
  getFeatureFlag,
  listFeatureFlags,
  recordRolloutEvidence,
  recordShadowCompare,
  setFeatureFlagMode,
  shouldReadCompatibilityPath,
  shouldShadowWrite,
  shouldUseNewPath,
} from "./runtime/rollout-safety.js"
export type {
  RuntimeManifest,
  RuntimeManifestChannelSummary,
  RuntimeManifestDatabase,
  RuntimeManifestEnvironment,
  RuntimeManifestMemory,
  RuntimeManifestOptions,
  RuntimeManifestPromptSources,
  RuntimeManifestProviderProfile,
  RuntimeManifestReleasePackage,
  RuntimeManifestYeonjangNode,
} from "./runtime/manifest.js"
export type {
  FeatureFlagChangeResult,
  FeatureFlagMode,
  RolloutEvidenceRecord,
  RolloutEvidenceStatus,
  RolloutSafetySnapshot,
  RuntimeFeatureFlag,
  ShadowCompareRecord,
  ShadowCompareResult,
} from "./runtime/rollout-safety.js"
export {
  MIGRATION_ROLLBACK_RUNBOOK_REF,
  assertMigrationWriteAllowed,
  beginMigrationLock,
  checkMigrationWriteGuard,
  ensureMigrationSafetyTables,
  failMigrationLock,
  getActiveMigrationLock,
  getLatestMigrationLock,
  releaseMigrationLock,
  updateMigrationLockPhase,
  verifyMigrationState,
} from "./db/migration-safety.js"
export type { MigrationLockPhase, MigrationLockRow, MigrationLockStatus, MigrationVerificationReport, MigrationWriteGuardResult } from "./db/migration-safety.js"
export { lastDoctorReportExists, runDoctor, writeDoctorReportArtifact } from "./diagnostics/doctor.js"
export type { DoctorCheckName, DoctorCheckResult, DoctorMode, DoctorReport, DoctorStatus, RunDoctorOptions } from "./diagnostics/doctor.js"
export { buildReleaseNoteEvidenceSummary, parseTaskMetadata, runPlanDriftCheck } from "./diagnostics/plan-drift.js"
export type { PlanDriftReport, PlanDriftReleaseNoteEvidence, PlanDriftWarning, TaskEvidenceMetadata } from "./diagnostics/plan-drift.js"
export {
  attachCapabilityProfileToTrace,
  buildProviderProfileId,
  clearProviderCapabilityCache,
  getProviderCapabilityMatrix,
  resolveEmbeddingProviderResolutionSnapshot,
} from "./ai/capabilities.js"
export type {
  EmbeddingProviderResolutionSnapshot,
  ProviderCapabilityItem,
  ProviderCapabilityMatrix,
  ProviderCapabilityStatus,
} from "./ai/capabilities.js"

// Release package
export {
  buildCleanMachineInstallChecklist,
  buildReleaseArtifactDefinitions,
  buildReleaseManifest,
  buildReleasePipelinePlan,
  buildReleaseRollbackRunbook,
  buildReleaseUpdatePreflightReport,
  writeReleasePackage,
} from "./release/package.js"
export type {
  ReleaseArtifact,
  ReleaseArtifactDefinition,
  ReleaseArtifactKind,
  ReleaseArtifactStatus,
  ReleaseChecklistItem,
  ReleaseManifest,
  ReleaseManifestOptions,
  ReleasePackageWriteResult,
  ReleasePipelinePlan,
  ReleasePipelineStep,
  ReleaseRollbackRunbook,
  ReleaseTargetPlatform,
  ReleaseUpdatePreflightCheck,
  ReleaseUpdatePreflightReport,
} from "./release/package.js"

// Logger
export { createLogger, logger } from "./logger/index.js"
export type { Logger } from "./logger/index.js"

// Events
export { eventBus } from "./events/index.js"
export type { NobieEvents, WizbyEvents, HowieEvents } from "./events/index.js"

// Control-plane timeline
export {
  exportControlTimeline,
  getControlTimeline,
  installControlEventProjection,
  recordControlEvent,
  recordControlEventFromLedger,
  resetControlEventProjectionForTest,
} from "./control-plane/timeline.js"
export type {
  ControlEventInput,
  ControlEventSeverity,
  ControlExportAudience,
  ControlExportFormat,
  ControlTimeline,
  ControlTimelineEvent,
  ControlTimelineExport,
  ControlTimelineQuery,
  ControlTimelineSummary,
} from "./control-plane/timeline.js"

// Message ledger and delivery finalization
export {
  buildArtifactDeliveryKey as buildMessageLedgerArtifactDeliveryKey,
  buildTextDeliveryKey as buildMessageLedgerTextDeliveryKey,
  buildToolCallIdempotencyKey,
  finalizeDeliveryForRun,
  findDuplicateToolCall,
  getAllowRepeatReason,
  hashLedgerValue,
  isDedupeTargetTool,
  recordMessageLedgerEvent,
  stableStringify,
} from "./runs/message-ledger.js"
export type { DeliveryFinalizerResult, MessageLedgerEventInput, MessageLedgerEventKind } from "./runs/message-ledger.js"
export {
  DEFAULT_QUEUE_BUDGETS,
  QUEUE_NAMES,
  QueueBackpressureError,
  buildBackpressureUserMessage,
  buildQueueBackpressureSnapshot,
  enqueueBackpressureTask,
  recordQueueBackpressureEvent,
  recordRetryBudgetAttempt,
  resetQueueBackpressureState,
  resetRetryBudget,
} from "./runs/queue-backpressure.js"
export type { QueueBudget, QueueName, QueueSnapshotItem, RetryBudgetDecision } from "./runs/queue-backpressure.js"
export {
  ContextPreflightBlockedError,
  chatWithContextPreflight,
  estimateContextTokens,
  estimateMessagesTokens,
  prepareChatContext,
  pruneMessagesForContext,
  runContextPreflight,
} from "./runs/context-preflight.js"
export type {
  ContextPreflightBreakdown,
  ContextPreflightMetadata,
  ContextPreflightPreparedChat,
  ContextPreflightResult,
  ContextPreflightStatus,
  ContextPruningDecision,
} from "./runs/context-preflight.js"
export {
  activateExtensionWithTrustPolicy,
  buildExtensionRegistrySnapshot,
  createExtensionRollbackPoint,
  extensionIdsForToolName,
  getExtensionFailureState,
  isToolExtensionSelectable,
  listExtensionFailureStates,
  recordExtensionFailure,
  recordExtensionRegistryChange,
  recordExtensionToolFailure,
  resetExtensionFailureState,
  rollbackExtensionToPoint,
  runExtensionHookSafely,
} from "./security/extension-governance.js"
export type {
  ExtensionActivationResult,
  ExtensionFailureState,
  ExtensionKind,
  ExtensionPermissionScope,
  ExtensionRegistryEntry,
  ExtensionRegistrySnapshot,
  ExtensionRollbackPoint,
  ExtensionStatus,
  ExtensionTrustLevel,
  ExtensionTrustPolicy,
  MinimalMcpServerStatus,
  MinimalMcpToolStatus,
} from "./security/extension-governance.js"
export {
  buildAnswerDirective,
  buildWebRetrievalPolicyDecision,
  evaluateSourceReliabilityGuard,
  extractSourceTimestampFromHtml,
  recordBrowserSearchEvidence,
} from "./runs/web-retrieval-policy.js"
export type {
  BrowserSearchEvidenceArtifact,
  BrowserSearchEvidenceInput,
  SourceCompletionStatus,
  SourceEvidence,
  SourceFreshnessPolicy,
  SourceKind,
  SourceReliability,
  SourceReliabilityGuardResult,
  WebRetrievalMethod,
  WebRetrievalPolicyDecision,
  WebRetrievalPolicyInput,
} from "./runs/web-retrieval-policy.js"

// Contracts
export {
  CANONICAL_JSON_POLICY,
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryDedupeKey,
  buildDeliveryKey,
  buildDeliveryProjection,
  buildPayloadHash,
  buildScheduleIdentityKey,
  buildScheduleIdentityProjection,
  buildSchedulePayloadProjection,
  buildToolTargetProjection,
  formatContractValidationFailureForUser,
  stableContractHash,
  toCanonicalJson,
  validateDeliveryContract,
  validateIntentContract,
  validateScheduleContract,
  validateToolTargetContract,
} from "./contracts/index.js"
export { intentContractFromTaskIntentEnvelope } from "./contracts/intake-adapter.js"
export {
  findScheduleCandidatesByContract,
  parseScheduleContractJson,
  scheduleContractDestinationEquals,
  scheduleContractTimeEquals,
} from "./schedules/candidates.js"
export {
  buildScheduleContractComparisonSystemPrompt,
  compareScheduleContractsWithAI,
  parseScheduleContractComparisonResult,
} from "./schedules/comparison.js"
export type {
  ActionType,
  ContractAttachment,
  ContractLocaleHint,
  ContractSchemaVersion,
  ContractSource,
  ContractValidationErrorCode,
  ContractValidationIssue,
  ContractValidationResult,
  DeliveryChannel,
  DeliveryContract,
  DeliveryMode,
  IngressEnvelope,
  IntentContract,
  IntentType,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ScheduleContract,
  ScheduleKind,
  ScheduleMissedPolicy,
  SchedulePayloadContract,
  SchedulePayloadKind,
  ScheduleTimeContract,
  ToolTargetContract,
  ToolTargetKind,
} from "./contracts/index.js"
export type {
  FindScheduleCandidatesByContractInput,
  ScheduleCandidate,
  ScheduleCandidateConfidence,
  ScheduleCandidateReason,
} from "./schedules/candidates.js"
export type {
  ScheduleContractComparisonCandidate,
  ScheduleContractComparisonDecision,
  ScheduleContractComparisonReasonCode,
  ScheduleContractComparisonResult,
} from "./schedules/comparison.js"

// Candidate Providers
export {
  buildCandidateDecisionAuditDetails,
  createExplicitIdProvider,
  createMemoryVectorProvider,
  createStoreCandidateProvider,
  createStructuredKeyProvider,
  decideCandidateFinal,
  runCandidateProviders,
} from "./candidates/index.js"
export type {
  CandidateFinalDecision,
  CandidateFinalDecisionKind,
  CandidateFinalDecisionSource,
  CandidateKind,
  CandidateProvider,
  CandidateProviderContext,
  CandidateProviderStage,
  CandidateProviderTrace,
  CandidateReason,
  CandidateResult,
  CandidateScore,
  CandidateSearchInput,
  CandidateSearchResult,
  CandidateSource,
  DecisionConfidence,
} from "./candidates/index.js"

// Observability
export {
  LATENCY_BUDGET_MS,
  buildLatencyEventLabel,
  buildLatencyEventLabelForMeasurement,
  getFastResponseHealthSnapshot,
  listLatencyMetrics,
  recordLatencyMetric,
  resetLatencyMetrics,
} from "./observability/latency.js"
export type {
  FastResponseHealthSnapshot,
  LatencyMetricName,
  LatencyMetricRecord,
  LatencyMetricStatus,
  LatencyMetricSummary,
} from "./observability/latency.js"

// DB
export {
  getDb,
  closeDb,
  insertSession,
  getSession,
  insertMessage,
  getMessages,
  insertAuditLog,
  getChannelSmokeRun,
  insertChannelSmokeRun,
  insertChannelSmokeStep,
  listChannelSmokeRuns,
  listChannelSmokeSteps,
  updateChannelSmokeRun,
} from "./db/index.js"

// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js"
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./tools/index.js"

// Agent
export { runAgent } from "./agent/index.js"
export type { AgentChunk, RunAgentParams } from "./agent/index.js"
export { buildTaskIntakeSystemPrompt } from "./agent/intake-prompt.js"
export type {
  TaskIntakeActionType,
  TaskIntakeIntentCategory,
  TaskIntakeMessageMode,
  TaskIntakePriority,
  TaskIntakePromptOptions,
  TaskIntakeTaskProfile,
} from "./agent/intake-prompt.js"

// Instructions
export { discoverInstructionChain } from "./instructions/discovery.js"
export { loadMergedInstructions } from "./instructions/merge.js"
export type { InstructionChain, InstructionSource } from "./instructions/discovery.js"
export type { MergedInstructionBundle } from "./instructions/merge.js"

// Memory
export { storeMemory, storeMemorySync, searchMemory, searchMemorySync, recentMemories, buildMemoryContext } from "./memory/store.js"
export { runMemoryRetrievalEvaluation, seedMemoryRetrievalEvaluationFixture, evaluateMemoryRetrievalQuery } from "./memory/evaluation.js"
export { diagnoseVectorEmbeddingRows } from "./memory/search.js"
export { listMemoryWritebackReviewItems, reviewMemoryWritebackCandidate, inspectMemoryWritebackSafety } from "./memory/writeback.js"
export type { MemoryRetrievalEvaluationFixture, MemoryRetrievalEvaluationMode, MemoryRetrievalEvaluationReport } from "./memory/evaluation.js"
export type { MemoryVectorDegradedReason, MemoryVectorDiagnostic } from "./memory/search.js"
export type { MemoryWritebackReviewAction, MemoryWritebackReviewItem, MemoryWritebackReviewResult, MemoryWritebackSafetyResult } from "./memory/writeback.js"
export type { PromptSourceBackupResult, PromptSourceDiffResult, PromptSourceDryRunResult, PromptSourceLocaleParityResult, PromptSourceRollbackResult, PromptSourceWriteResult } from "./memory/nobie-md.js"
export type { PromptImpactScenarioResult, PromptRegressionIssue, PromptRegressionLocale, PromptResponsibilityRuleResult, PromptSourceRegressionResult } from "./memory/prompt-regression.js"
export {
  loadNobieMd,
  initNobieMd,
  loadWizbyMd,
  initWizbyMd,
  loadHowieMd,
  initHowieMd,
  ensurePromptSourceFiles,
  loadFirstRunPromptSourceAssembly,
  loadPromptSourceRegistry,
  loadSystemPromptSourceAssembly,
  loadSystemPromptSources,
  dryRunPromptSourceAssembly,
  buildPromptSourceContentDiff,
  writePromptSourceWithBackup,
  rollbackPromptSourceBackup,
  checkPromptSourceLocaleParity,
  detectPromptSourceSecretMarkers,
  isPromptSourceContentSafe,
} from "./memory/nobie-md.js"
export { runPromptSourceRegression } from "./memory/prompt-regression.js"
export { fileIndexer, FileIndexer } from "./memory/file-indexer.js"
export { getEmbeddingProvider, NullEmbeddingProvider, OllamaEmbeddingProvider, VoyageEmbeddingProvider, OpenAIEmbeddingProvider } from "./memory/embedding.js"

// Plugins
export { pluginLoader, PluginLoader } from "./plugins/loader.js"
export type { NobiePlugin, WizbyPlugin, HowiePlugin, PluginContext, PluginMeta } from "./plugins/types.js"

// MCP
export { mcpRegistry } from "./mcp/registry.js"
export { McpStdioClient } from "./mcp/client.js"
export type { McpServerStatus, McpSummary, McpToolStatus } from "./mcp/registry.js"

// MQTT
export { startMqttBroker, stopMqttBroker, getMqttBrokerSnapshot } from "./mqtt/broker.js"
export type { MqttBrokerSnapshot } from "./mqtt/broker.js"

// Channels
export {
  startChannels,
  TelegramChannel,
  SlackChannel,
  createDryRunChannelSmokeExecutor,
  getDefaultChannelSmokeScenarios,
  resolveChannelSmokeReadiness,
  runChannelSmokeScenarios,
  runPersistedChannelSmokeScenarios,
  sanitizeChannelSmokeTrace,
  sanitizeChannelSmokeValue,
  validateChannelSmokeTrace,
} from "./channels/index.js"
export type {
  ChannelSmokeArtifactMode,
  ChannelSmokeArtifactTrace,
  ChannelSmokeChannel,
  ChannelSmokeCorrelationKey,
  ChannelSmokeReadiness,
  ChannelSmokeRunMode,
  ChannelSmokeRunResult,
  ChannelSmokeRunnerOptions,
  ChannelSmokeScenario,
  ChannelSmokeScenarioKind,
  ChannelSmokeStatus,
  ChannelSmokeToolTrace,
  ChannelSmokeTrace,
  ChannelSmokeValidation,
  PersistedChannelSmokeRunnerOptions,
  PersistedChannelSmokeRunResult,
} from "./channels/index.js"

// Runs
export { startRootRun } from "./runs/start.js"
export type { StartRootRunParams, StartedRootRun } from "./runs/start.js"
export { buildIngressReceipt, resolveIngressStartParams, startIngressRun } from "./runs/ingress.js"
export { buildIngressDedupeKey } from "./runs/ingress.js"
export type { IngressExternalIdentity, IngressReceipt, IngressReceiptLanguage, ResolvedIngressStartParams, StartedIngressRun } from "./runs/ingress.js"
export { canTransitionRunStatus, deriveRunCompletionOutcome, isTerminalRunStatus, resolveRunFlowIdentifiers } from "./runs/flow-contract.js"
export type { RunCompletionOutcome, RunCompletionOutcomeInput, RunCompletionOutcomeStatus, RunFlowIdentifiers, RunFlowStatusTransitionDecision } from "./runs/flow-contract.js"
export { buildStartupRecoverySummary, classifyStartupRecovery, getLastStartupRecoverySummary } from "./runs/startup-recovery.js"
export type { StartupRecoveryClassification, StartupRecoveryRunSummary, StartupRecoveryScheduleSummary, StartupRecoveryStatus, StartupRecoverySummary } from "./runs/startup-recovery.js"
export {
  DEFAULT_RETENTION_POLICY,
  DEFAULT_RETRY_POLICIES,
  DEFAULT_SOAK_HEALTH_THRESHOLDS,
  DEFAULT_SOAK_PROFILES,
  buildSoakHealthSummary,
  buildSoakReportArtifact,
  buildSoakReportPayload,
  buildRetentionCleanupPlan,
  buildRetryFailureFingerprint,
  calculateSoakLatencyStats,
  collectSoakResourceMetrics,
  evaluateRetryBackoff,
  expandSoakOperationMix,
  getSoakProfile,
  runRetentionCleanup,
  runSoakProfile,
  shouldStopRepeatedFailure,
} from "./runs/soak-retention.js"
export type {
  RepeatedFailureStopDecision,
  RetentionCleanupApplyOptions,
  RetentionCleanupCandidate,
  RetentionCleanupFailure,
  RetentionCleanupKindSummary,
  RetentionCleanupOptions,
  RetentionCleanupPlan,
  RetentionCleanupReason,
  RetentionCleanupResult,
  RetentionDataKind,
  RetentionItem,
  RetentionKindPolicy,
  RetentionPolicy,
  RetryBackoffDecision,
  RetryBackoffInput,
  RetryFailureDomain,
  RetryFailureFingerprintInput,
  RetryPolicy,
  SoakChannelHealth,
  SoakHealthInput,
  SoakHealthStatus,
  SoakHealthSummary,
  SoakHealthThresholds,
  SoakLatencyStats,
  SoakOperationContext,
  SoakOperationExecution,
  SoakOperationKind,
  SoakOperationResult,
  SoakOperationWeight,
  SoakProfile,
  SoakProfileId,
  SoakReportPayload,
  SoakResourceMetrics,
  SoakRunSummary,
  SoakRunnerOptions,
} from "./runs/soak-retention.js"

// Scheduler
export { runSchedule, runScheduleAndWait } from "./scheduler/index.js"

// API server
export { startServer, closeServer } from "./api/server.js"

// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js"
import { getDb as _getDb, insertAuditLog as _insertAuditLog, upsertPromptSources as _upsertPromptSources } from "./db/index.js"
import { ensurePromptSourceFiles as _ensurePromptSourceFiles } from "./memory/nobie-md.js"
import { recoverActiveRunsOnStartup as _recoverActiveRunsOnStartup } from "./runs/store.js"
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js"
import { startServer as _startServer } from "./api/server.js"
import { mcpRegistry as _mcpRegistry } from "./mcp/registry.js"
import { startMqttBroker as _startMqttBroker, stopMqttBroker as _stopMqttBroker } from "./mqtt/broker.js"
import { startChannels as _startChannels } from "./channels/index.js"
import { refreshRuntimeManifest as _refreshRuntimeManifest } from "./runtime/manifest.js"

export function bootstrap(): void {
  _loadConfig()
  _getDb()
  try {
    const promptSeed = _ensurePromptSourceFiles(process.cwd())
    _upsertPromptSources(promptSeed.registry.map(({ content: _content, ...metadata }) => metadata))
    _insertAuditLog({
      timestamp: Date.now(),
      session_id: null,
      source: "system",
      tool_name: "prompt_bootstrap",
      params: JSON.stringify({ promptsDir: promptSeed.promptsDir }),
      output: JSON.stringify({ created: promptSeed.created, existing: promptSeed.existing.length, sources: promptSeed.registry.length }),
      result: "success",
      duration_ms: null,
      approval_required: 0,
      approved_by: null,
    })
  } catch {
    try {
      _insertAuditLog({
        timestamp: Date.now(),
        session_id: null,
        source: "system",
        tool_name: "prompt_bootstrap",
        params: null,
        output: "Prompt bootstrap failed with a safe initialization error summary.",
        result: "failed",
        duration_ms: null,
        approval_required: 0,
        approved_by: null,
      })
    } catch {
      // Keep startup alive; prompt bootstrap failures are surfaced through diagnostics when DB is available.
    }
  }
  _registerBuiltinTools()
  try {
    _refreshRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false })
  } catch {
    // Runtime manifest failures are surfaced through doctor checks; bootstrap must stay alive.
  }
}

export async function bootstrapRuntime(): Promise<void> {
  bootstrap()
  _recoverActiveRunsOnStartup()
  await _mcpRegistry.loadFromConfig()
}

export async function bootstrapAsync(): Promise<void> {
  await bootstrapRuntime()
  await _startMqttBroker()
  await _startChannels()
  try {
    await _startServer()
  } catch (error) {
    await _stopMqttBroker()
    throw error
  }
}
