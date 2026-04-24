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
export {
  getCurrentAppVersion,
  getCurrentDisplayVersion,
  getWorkspacePackageJsonPath,
  getWorkspaceRootPath,
} from "./version.js"

// Benchmarks
export {
  SUB_AGENT_BENCHMARK_SCENARIO_IDS,
  buildSubAgentBenchmarkReleaseGateSummary,
  evaluateSubAgentBenchmarkReleaseGate,
  getLatestSubAgentBenchmarkRun,
  getSubAgentBenchmarkRun,
  listSubAgentBenchmarkScenarios,
  resetSubAgentBenchmarkRunsForTest,
  runAndStoreSubAgentBenchmarkSuite,
  runSubAgentBenchmarkSuite,
} from "./benchmarks/sub-agent-benchmarks.js"
export type {
  CompiledWorkflowRecommendation,
  RunSubAgentBenchmarkSuiteInput,
  SubAgentBenchmarkAggregateMetrics,
  SubAgentBenchmarkReleaseGateSummary,
  SubAgentBenchmarkScenarioDefinition,
  SubAgentBenchmarkScenarioId,
  SubAgentBenchmarkScenarioMetrics,
  SubAgentBenchmarkScenarioResult,
  SubAgentBenchmarkStatus,
  SubAgentBenchmarkSuiteResult,
} from "./benchmarks/sub-agent-benchmarks.js"
export {
  DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS,
  SUB_AGENT_RELEASE_MODE_SEQUENCE,
  buildSubAgentReleaseReadinessSummary,
  buildSubAgentRollbackEvidence,
  runSubAgentRestartResumeSoak,
} from "./release/sub-agent-release-gate.js"
export type {
  SubAgentReleaseDryRunSummary,
  SubAgentReleaseGateCheck,
  SubAgentReleaseGateCheckId,
  SubAgentReleaseGateStatus,
  SubAgentReleaseModeDefinition,
  SubAgentReleaseModeId,
  SubAgentReleaseReadinessOptions,
  SubAgentReleaseReadinessSummary,
  SubAgentReleaseThresholds,
  SubAgentRestartResumeSoakResult,
  SubAgentRollbackEvidence,
} from "./release/sub-agent-release-gate.js"

// Runtime manifest and diagnostics
export {
  buildRuntimeManifest,
  getLastRuntimeManifest,
  refreshRuntimeManifest,
} from "./runtime/manifest.js"
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
  AGENT_PROMPT_BUNDLE_VERSION,
  buildAgentPromptBundle,
  buildAgentPromptBundleCacheKey,
  createPromptBundleCache,
  redactPromptSecrets,
  renderAgentPromptBundleText,
} from "./orchestration/prompt-bundle.js"
export {
  controlSubSession,
  getSubSessionInfo,
  killAllSubSessionsForRun,
  listSubSessionLogs,
  sanitizeSubSessionControlText,
  spawnSubSessionAck,
} from "./orchestration/sub-session-control.js"
export {
  InvalidSubSessionStatusTransitionError,
  ResourceLockManager,
  SUB_SESSION_STATUS_TRANSITIONS,
  SubSessionRunner,
  applyParallelSubSessionBudget,
  buildSubSessionContract,
  canTransitionSubSessionStatus,
  classifySubSessionRecovery,
  createDryRunSubSessionHandler,
  createSubSessionRunner,
  createTextResultReport,
  loadSubSessionByIdempotencyKey,
  planOrchestrationExecutionWaves,
  planSubSessionExecutionWaves,
  recoverInterruptedSubSessions,
  runParallelSubSessionGroup,
  transitionSubSessionStatus,
} from "./orchestration/sub-session-runner.js"
export {
  buildFeedbackLoopPackage,
  buildRedelegatedSubSessionInput,
  decideFeedbackLoopContinuation,
  validateRedelegationTarget,
} from "./orchestration/feedback-loop.js"
export {
  applyNestedSpawnBudget,
  buildNestedDelegationPlan,
  calculateSubSessionDepth,
  validateNestedCommandRequest,
} from "./orchestration/nested-delegation.js"
export {
  FAST_PATH_CLASSIFIER_TARGET_P95_MS,
  ORCHESTRATION_PLANNER_TARGET_P95_MS,
  createOrchestrationPlanner,
  classifyFastPath,
  buildDefaultStructuredTaskScope,
  buildOrchestrationPlan,
} from "./orchestration/planner.js"
export {
  buildOrchestrationRegistrySnapshot,
  clearAgentCapabilityIndexCache,
  createAgentRegistryService,
  createTeamRegistryService,
} from "./orchestration/registry.js"
export {
  buildAgentCapabilitySummary,
  buildAgentModelSummary,
  resolveAgentCapabilityModelSummary,
} from "./orchestration/capability-model.js"
export {
  ORCHESTRATION_EVENT_KINDS,
  buildOrchestrationMonitoringSnapshot,
  buildRestartResumeProjection,
  formatOrchestrationEventSse,
  installOrchestrationEventProjection,
  listOrchestrationEventLedger,
  openOrchestrationEventRawPayload,
  parseOrchestrationReplayCursor,
  recordOrchestrationEvent,
  resetOrchestrationEventProjectionForTest,
  validateOrchestrationEventInput,
} from "./orchestration/event-ledger.js"
export {
  DEFAULT_MODEL_RETRY_COUNT,
  DEFAULT_MODEL_TIMEOUT_MS,
  DEFAULT_PROVIDER_MODEL_CAPABILITY_MATRIX,
  buildModelAvailabilityDoctorSnapshot,
  buildModelExecutionAuditSummary,
  estimateModelExecutionCost,
  estimateTokenCount,
  resolveFallbackModelExecutionPolicy,
  resolveModelExecutionPolicy,
} from "./orchestration/model-execution-policy.js"
export { createAgentHierarchyService } from "./orchestration/hierarchy.js"
export { createAgentTopologyService } from "./orchestration/topology-projection.js"
export {
  AGENT_TEMPLATES,
  TEAM_TEMPLATES,
  clearFocusBinding,
  createOneClickBackgroundTask,
  executeWorkspaceCommand,
  getFocusBinding,
  importExternalAgentProfileDraft,
  instantiateAgentTemplate,
  instantiateTeamTemplate,
  lintAgentDescription,
  resolveFocusBinding,
  searchCommandPalette,
  setFocusBinding,
} from "./orchestration/command-workspace.js"
export { createTeamCompositionService } from "./orchestration/team-composition.js"
export {
  buildTeamExecutionPlan,
  createTeamExecutionPlanService,
} from "./orchestration/team-execution-plan.js"
export type {
  AgentDescriptionLintWarning,
  AgentTemplateDefinition,
  CommandPaletteResultKind,
  CommandPaletteSearchResponse,
  CommandPaletteSearchResult,
  FocusBinding,
  FocusResolveFailure,
  FocusResolveResult,
  FocusResolveSuccess,
  FocusTarget,
  FocusTargetKind,
  TeamTemplateDefinition,
} from "./orchestration/command-workspace.js"
export type {
  SubSessionControlAction,
  SubSessionControlResult,
  SubSessionInfo,
  SubSessionLogEntry,
  SubSessionSpawnAck,
  SubSessionSpawnAckStatus,
} from "./orchestration/sub-session-control.js"
export {
  orchestrationCapabilityStatus,
  resolveOrchestrationModeSnapshot,
  resolveOrchestrationModeSnapshotSync,
} from "./orchestration/mode.js"
export type {
  AgentPromptBundleBuildInput,
  AgentPromptBundleBuildResult,
  ImportedPromptFragmentInput,
  PromptBundleCacheEntry,
  PromptBundleCacheStats,
} from "./orchestration/prompt-bundle.js"
export type {
  AgentCapabilitySummary,
  AgentCapabilityBindingStatus,
  AgentCapabilityBindingSummary,
  AgentCapabilityCatalogStatus,
  AgentCapabilityModelSummary,
  AgentModelSummary,
  AgentSecretScopeSummary,
  AgentSkillMcpSummaryResolved,
  CapabilityModelAvailabilityStatus,
  CapabilityModelDiagnostic,
  CapabilityModelDiagnosticSeverity,
} from "./orchestration/capability-model.js"
export type {
  OrchestrationEvent,
  OrchestrationEventAppendResult,
  OrchestrationEventInput,
  OrchestrationEventKind,
  OrchestrationEventQuery,
  OrchestrationEventSeverity,
  OrchestrationMonitoringSnapshot,
} from "./orchestration/event-ledger.js"
export type {
  ModelAvailabilityDoctorSnapshot,
  ModelAvailabilityStatus,
  ModelExecutionAuditSummary,
  ProviderModelCapability,
  ResolvedModelExecutionPolicy,
} from "./orchestration/model-execution-policy.js"
export type {
  AgentHierarchyAgentSummary,
  AgentHierarchyDiagnostic,
  AgentHierarchyServiceDependencies,
  AgentHierarchyValidationResult,
  AgentTreeLayoutPreference,
  AgentTreeProjection,
  DirectChildProjection,
  HierarchyDiagnosticSeverity,
} from "./orchestration/hierarchy.js"
export type {
  AgentTopologyAgentInspector,
  AgentTopologyDiagnostic,
  AgentTopologyDiagnosticSeverity,
  AgentTopologyEdge,
  AgentTopologyEdgeKind,
  AgentTopologyEdgeStyle,
  AgentTopologyEdgeValidationInput,
  AgentTopologyEdgeValidationResult,
  AgentTopologyNode,
  AgentTopologyNodeKind,
  AgentTopologyPosition,
  AgentTopologyProjection,
  AgentTopologyServiceDependencies,
  AgentTopologyTeamBuilderCandidate,
  AgentTopologyTeamInspector,
  AgentTopologyTeamMemberInspector,
} from "./orchestration/topology-projection.js"
export type {
  TeamCompositionDiagnostic,
  TeamCompositionDiagnosticSeverity,
  TeamCompositionMemberCoverage,
  TeamCompositionServiceDependencies,
  TeamCompositionValidationResult,
  TeamCoverageDimension,
  TeamCoverageReport,
  TeamHealthReport,
  TeamHealthStatus,
  TeamMemberExecutionState,
} from "./orchestration/team-composition.js"
export type {
  TeamExecutionPlanBuildInput,
  TeamExecutionPlanBuildResult,
  TeamExecutionPlanDiagnostic,
  TeamExecutionPlanDiagnosticSeverity,
  TeamExecutionPlanServiceDependencies,
} from "./orchestration/team-execution-plan.js"
export type {
  ParallelSubSessionBudget,
  ParallelSubSessionBudgetDecision,
  ParallelSubSessionGroupRunResult,
  ParallelSubSessionGroupRunOptions,
  RunSubSessionInput,
  SubSessionCascadeStopResult,
  SubSessionConcurrencyLimits,
  SubSessionExecutionControls,
  SubSessionExecutionHandler,
  SubSessionExecutionPlanningOptions,
  SubSessionExecutionWave,
  SubSessionRecoveryDecision,
  SubSessionRecoveryResult,
  SubSessionReviewRuntimeEventInput,
  SubSessionRunOutcome,
  SubSessionParentAgentSnapshot,
  SubSessionRuntimeAgentSnapshot,
  SubSessionRuntimeDependencies,
  SubSessionWorkItem,
} from "./orchestration/sub-session-runner.js"
export type {
  BuildFeedbackLoopPackageInput,
  BuildRedelegatedSubSessionInput,
  FeedbackLoopContinuationAction,
  FeedbackLoopContinuationDecision,
  FeedbackLoopPackage,
  RedelegationTargetValidationInput,
  RedelegationTargetValidationResult,
} from "./orchestration/feedback-loop.js"
export type {
  NestedCommandValidationResult,
  NestedDelegationPlanResult,
  NestedDelegationPlannerInput,
  NestedSpawnBudgetDecision,
  NestedSpawnBudgetInput,
} from "./orchestration/nested-delegation.js"
export type {
  FastPathClassification,
  FastPathClassificationResult,
  FastPathClassifierInput,
  OrchestrationCandidateScore,
  OrchestrationPlanBuildResult,
  OrchestrationPlannerDiagnostic,
  OrchestrationPlannerInput,
  OrchestrationPlannerIntent,
  OrchestrationPlannerLearningHint,
} from "./orchestration/planner.js"
export type {
  AgentFailureRateSnapshot,
  AgentCapabilityIndex,
  AgentCapabilityIndexCandidate,
  AgentCapabilityIndexMetrics,
  AgentRegistryEntry,
  AgentRuntimeLoadSnapshot,
  AgentSkillMcpSummary,
  OrchestrationRegistrySnapshot,
  OrchestrationRegistryDiagnostic,
  OrchestrationRegistryDiagnosticSeverity,
  OrchestrationRegistryLatencyMetrics,
  OrchestrationRegistryStatus,
  RegistryServiceDependencies,
  RegistryCoverageDimensionSnapshot,
  RegistryHierarchyDirectChildSnapshot,
  RegistryHierarchySnapshot,
  RegistryInvalidationSnapshot,
  RegistryInvalidationTableFingerprint,
  RegistryTeamCoverageSnapshot,
  RegistryTeamHealthSnapshot,
  RegistryTeamMemberCoverageSnapshot,
  TeamRegistryEntry,
} from "./orchestration/registry.js"
export type {
  OrchestrationModeReasonCode,
  OrchestrationModeSnapshot,
  OrchestrationRegistryAgentSnapshot,
  OrchestrationRuntimeStatus,
  RegistryLoadResult,
} from "./orchestration/mode.js"
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
export type {
  MigrationLockPhase,
  MigrationLockRow,
  MigrationLockStatus,
  MigrationVerificationReport,
  MigrationWriteGuardResult,
} from "./db/migration-safety.js"
export {
  lastDoctorReportExists,
  runDoctor,
  writeDoctorReportArtifact,
} from "./diagnostics/doctor.js"
export type {
  DoctorCheckName,
  DoctorCheckResult,
  DoctorMode,
  DoctorReport,
  DoctorStatus,
  RunDoctorOptions,
} from "./diagnostics/doctor.js"
export {
  buildReleaseNoteEvidenceSummary,
  parseTaskMetadata,
  runPlanDriftCheck,
} from "./diagnostics/plan-drift.js"
export type {
  PlanDriftReport,
  PlanDriftReleaseNoteEvidence,
  PlanDriftWarning,
  TaskEvidenceMetadata,
} from "./diagnostics/plan-drift.js"
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
  ReleaseNoteSummary,
  ReleaseRollbackRunbook,
  ReleaseTargetPlatform,
  ReleaseUpdatePreflightCheck,
  ReleaseUpdatePreflightReport,
} from "./release/package.js"

export {
  RELEASE_PERFORMANCE_TARGETS,
  buildReleasePerformanceSummary,
} from "./release/performance-gate.js"
export type {
  ReleasePerformanceCounterResult,
  ReleasePerformanceGateStatus,
  ReleasePerformanceMetricResult,
  ReleasePerformanceSummary,
  ReleasePerformanceTarget,
  ReleasePerformanceTargetKind,
} from "./release/performance-gate.js"

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
export type {
  DeliveryFinalizerResult,
  MessageLedgerEventInput,
  MessageLedgerEventKind,
} from "./runs/message-ledger.js"
export {
  buildFinalDeliveryAttributions,
  buildNamedResultDeliveryEvent,
  buildNobieFinalAnswer,
  commitFinalDelivery,
  findCommittedFinalDelivery,
  listPendingFinalizers,
  recordApprovalAggregation,
  recordLateResultNoReply,
} from "./runs/channel-finalizer.js"
export type {
  ApprovalAggregationResult,
  FinalDeliveryAttribution,
  FinalDeliveryCommitResult,
  FinalDeliverySource,
  FinalDeliveryStatus,
  FinalizerApprovalState,
  FinalizerApprovalStatus,
  FinalizerReviewState,
  PendingFinalizerRestoreItem,
} from "./runs/channel-finalizer.js"
export { buildRunRuntimeInspectorProjection } from "./runs/runtime-inspector-projection.js"
export type {
  RunRuntimeInspectorApprovalSummary,
  RunRuntimeInspectorDataExchangeSummary,
  RunRuntimeInspectorExpectedOutput,
  RunRuntimeInspectorFeedback,
  RunRuntimeInspectorFinalizer,
  RunRuntimeInspectorModel,
  RunRuntimeInspectorPlanProjection,
  RunRuntimeInspectorPlanTask,
  RunRuntimeInspectorProgressItem,
  RunRuntimeInspectorProjection,
  RunRuntimeInspectorProjectionOptions,
  RunRuntimeInspectorResult,
  RunRuntimeInspectorReview,
  RunRuntimeInspectorSubSession,
  RunRuntimeInspectorTimelineEvent,
  RuntimeInspectorAllowedControlAction,
  RuntimeInspectorApprovalState,
  RuntimeInspectorControlAction,
} from "./runs/runtime-inspector-projection.js"
export {
  WEB_RETRIEVAL_FIXTURE_SCHEMA_VERSION,
  buildFixtureRegressionFromWorkspace,
  buildWebRetrievalReleaseGateSummary,
  createDryRunWebRetrievalLiveSmokeExecutor,
  fixtureFileNameForId,
  getDefaultWebRetrievalLiveSmokeScenarios,
  isLiveWebSmokeEnabled,
  loadWebRetrievalFixturesFromDir,
  runWebRetrievalFixtureRegression,
  runWebRetrievalLiveSmokeScenarios,
  validateWebRetrievalLiveSmokeTrace,
  writeWebRetrievalSmokeArtifact,
} from "./runs/web-retrieval-smoke.js"
export { WEB_RETRIEVAL_POLICY_VERSION } from "./runs/web-retrieval-policy.js"
export type {
  WebRetrievalFixture,
  WebRetrievalFixtureExpected,
  WebRetrievalFixtureRegressionResult,
  WebRetrievalFixtureRegressionSummary,
  WebRetrievalFixtureSource,
  WebRetrievalFixtureTargetInput,
  WebRetrievalLiveSmokeMode,
  WebRetrievalLiveSmokeResult,
  WebRetrievalLiveSmokeScenario,
  WebRetrievalLiveSmokeSummary,
  WebRetrievalLiveSmokeTrace,
  WebRetrievalReleaseGateSummary,
  WebRetrievalSmokeStatus,
} from "./runs/web-retrieval-smoke.js"
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
export type {
  QueueBudget,
  QueueName,
  QueueSnapshotItem,
  RetryBudgetDecision,
} from "./runs/queue-backpressure.js"
export {
  ContextPreflightBlockedError,
  chatWithContextPreflight,
  estimateContextTokens,
  estimateMessagesTokens,
  prepareChatContext,
  pruneMessagesForContext,
  runContextPreflight,
  validateAgentPromptBundleContextScope,
} from "./runs/context-preflight.js"
export { buildDataExchangeJournalRecord } from "./runs/journaling.js"
export type { DataExchangeJournalParams } from "./runs/journaling.js"
export type {
  ContextPreflightBreakdown,
  ContextPreflightMetadata,
  ContextPreflightPreparedChat,
  ContextPreflightResult,
  ContextPreflightStatus,
  ContextPruningDecision,
  PromptBundleContextMemoryRef,
  PromptBundleContextScopeValidation,
} from "./runs/context-preflight.js"
export {
  buildFeedbackRequest,
  collectResultReviewIssues,
  decideSubSessionCompletionIntegration,
  getSubAgentResultRetryBudgetLimit,
  normalizeResultReviewFailureKey,
  reviewSubAgentResult,
} from "./agent/sub-agent-result-review.js"
export type {
  SubAgentResultParentIntegrationStatus,
  SubAgentResultReview,
  SubAgentResultReviewInput,
  SubAgentResultReviewIssue,
  SubAgentResultReviewIssueCode,
  SubAgentResultReviewVerdict,
  SubAgentRetryClass,
  SubSessionCompletionIntegrationDecision,
} from "./agent/sub-agent-result-review.js"
export {
  canRetrySubSessionRevision,
  getSubSessionRevisionBudgetLimit,
} from "./runs/recovery-budget.js"
export type { SubSessionRevisionBudgetClass } from "./runs/recovery-budget.js"
export { decideSubSessionReviewGate } from "./runs/review-gate.js"
export type { SubSessionReviewGateDecision } from "./runs/review-gate.js"
export { buildSubSessionFeedbackCycleDirective } from "./runs/review-cycle-pass.js"
export type { SubSessionFeedbackCycleDirective } from "./runs/review-cycle-pass.js"
export { decideSubSessionCompletionPass } from "./runs/completion-pass.js"
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
  DEFAULT_EVIDENCE_CONFLICT_POLICY,
  conflictResolutionToVerdict,
  conflictSufficiencyIsBlocking,
  resolveEvidenceConflict,
} from "./runs/web-conflict-resolver.js"
export {
  DEFAULT_RETRIEVAL_CACHE_TTL_POLICY,
  InMemoryRetrievalCache,
  buildRetrievalCacheEntry,
  buildRetrievalCacheKey,
  buildRetrievalTargetHash,
  createInMemoryRetrievalCache,
  evaluateRetrievalCacheEntry,
  getPersistentRetrievalCacheEntry,
  listPersistentRetrievalCacheEntriesForTarget,
  putPersistentRetrievalCacheEntry,
  resolveRetrievalCacheTtlMs,
} from "./runs/web-retrieval-cache.js"
export {
  buildAnswerDirective,
  buildWebRetrievalPolicyDecision,
  evaluateSourceReliabilityGuard,
  extractSourceTimestampFromHtml,
  recordBrowserSearchEvidence,
} from "./runs/web-retrieval-policy.js"
export {
  RetrievalSessionController,
  buildRetrievalDedupeKey,
  buildRetrievalSessionDirective,
  createGenericTargetFromPolicy,
  createRetrievalSessionController,
  createRetrievalTargetContract,
  defaultRetrievalBudget,
  defaultSourceLadder,
  evaluateLimitedCompletionReadiness,
  getNextRetrievalMethods,
  isRetrievalSessionRecoverable,
} from "./runs/web-retrieval-session.js"
export {
  buildCandidateExtractionFailureEvent,
  extractRetrievedValueCandidates,
  sourceKindSatisfiesOfficialRequired,
  verifyRetrievedValueCandidate,
  verifyRetrievedValueCandidates,
} from "./runs/web-retrieval-verification.js"
export {
  attemptsToPlannerSummaries,
  buildPlannerCallIdempotencyKey,
  buildWebRetrievalPlannerPrompt,
  methodToToolName,
  runWebRetrievalPlanner,
  validateWebRetrievalPlannerOutput,
} from "./runs/web-retrieval-planner.js"
export {
  buildFinalAnswerDeliveryKey,
  buildFinalAnswerIdempotencyKey,
  buildProgressMessageIdempotencyKey,
  canGenerateFinalAnswerFromVerdict,
  finalizeRetrievalCompletion,
  protectRunFailureAfterFinalAnswer,
  recordFinalAnswerDelivery,
  recordProgressMessageSent,
} from "./runs/retrieval-finalizer.js"
export {
  buildFinanceKnownSources,
  buildFinanceSourceEvidence,
  buildWeatherKnownSources,
  buildWeatherSourceEvidence,
  buildWebSourceAdapterDegradationState,
  buildWebSourceAdapterRegistrySnapshot,
  checkAdapterFixtureParserVersions,
  createFinanceIndexTargetContract,
  createWeatherTargetContract,
  createWebLocationContract,
  FINANCE_ADAPTER_ID,
  FINANCE_ADAPTER_METADATA,
  FINANCE_ADAPTER_VERSION,
  FINANCE_INDEX_DEFINITIONS,
  FINANCE_PARSER_VERSION,
  listWebSourceAdapters,
  locationHierarchyContains,
  parseFinanceQuoteCandidates,
  parseWeatherMetricCandidates,
  rankWebSourceAdaptersForTarget,
  resolveFinanceIndexTarget,
  resolveWeatherLocationContract,
  stableAdapterChecksum,
  WEATHER_ADAPTER_ID,
  WEATHER_ADAPTER_METADATA,
  WEATHER_ADAPTER_VERSION,
  WEATHER_PARSER_VERSION,
  DEFAULT_ADAPTER_DEGRADATION_POLICY,
  withAdapterChecksum,
} from "./runs/web-source-adapters/index.js"
export type {
  EvidenceConflictPolicy,
  EvidenceConflictResolution,
  EvidenceConflictResolutionInput,
  EvidenceConflictResolutionStatus,
  EvidenceConflictTolerance,
} from "./runs/web-conflict-resolver.js"
export type {
  BuildRetrievalCacheEntryInput,
  EvaluateRetrievalCacheEntryInput,
  RetrievalCacheEntry,
  RetrievalCacheEvaluation,
  RetrievalCacheScope,
  RetrievalCacheStatus,
  RetrievalCacheTtlPolicy,
} from "./runs/web-retrieval-cache.js"
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
export type {
  LimitedCompletionReadiness,
  RecordRetrievalAttemptInput,
  RetrievalAttempt,
  RetrievalAttemptStatus,
  RetrievalBudget,
  RetrievalSession,
  RetrievalSessionControllerInput,
  RetrievalSessionDirective,
  RetrievalSessionStatus,
  RetrievalSourceMethod,
  RetrievalTargetContract,
  RetrievalTargetKind,
} from "./runs/web-retrieval-session.js"
export type {
  CandidateExtractionFailureEvent,
  CandidateExtractionHints,
  CandidateExtractionInput,
  RetrievedValueCandidate,
  RetrievalBindingSignal,
  RetrievalBindingSignalKind,
  RetrievalBindingStrength,
  RetrievalEvidenceSufficiency,
  RetrievalExtractionInputKind,
  RetrievalExtractionMethod,
  RetrievalVerificationPolicy,
  RetrievalVerificationVerdict,
  VerifyRetrievedValueCandidateInput,
} from "./runs/web-retrieval-verification.js"
export type {
  RejectedPlannerAction,
  RunWebRetrievalPlannerInput,
  WebRetrievalPlannerAction,
  WebRetrievalPlannerAttemptSummary,
  WebRetrievalPlannerDegradedReason,
  WebRetrievalPlannerDomainPolicy,
  WebRetrievalPlannerMethod,
  WebRetrievalPlannerOutput,
  WebRetrievalPlannerPromptInput,
  WebRetrievalPlannerRisk,
  WebRetrievalPlannerRunResult,
  WebRetrievalPlannerRunStatus,
  WebRetrievalPlannerStopReason,
  WebRetrievalPlannerValidationInput,
  WebRetrievalPlannerValidationResult,
} from "./runs/web-retrieval-planner.js"
export type {
  FailureProtectionResult,
  FinalAnswerDeliveryReceipt,
  FinalAnswerDeliveryStatus,
  FinalizedRetrievalCompletion,
  RecordFinalAnswerDeliveryInput,
  RecordProgressMessageInput,
  RetrievalCompletionStatus,
} from "./runs/retrieval-finalizer.js"
export type {
  FinanceIndexDefinition,
  FinanceIndexKey,
  FinanceKnownSource,
  FinanceQuoteParseInput,
  FinanceQuoteParseResult,
  FinanceTargetResolution,
  WeatherKnownSource,
  WeatherLocationBindingScope,
  WeatherMetric,
  WeatherMetricCandidate,
  WeatherParseInput,
  WeatherParseResult,
  WebLocationContract,
  WebLocationResolution,
  WebSourceAdapterFixtureVersionCheck,
  WebSourceAdapterDegradationPolicy,
  WebSourceAdapterDegradationState,
  WebSourceAdapterFailureSample,
  WebSourceAdapterMetadata,
  WebSourceAdapterRegistrySnapshot,
  WebSourceAdapterStatus,
} from "./runs/web-source-adapters/index.js"

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
  findNicknameNamespaceConflict,
  normalizeNickname,
  normalizeNicknameSnapshot,
  SUB_AGENT_CONTRACT_SCHEMA_VERSION,
  validateAgentRelationship,
  validateAgentConfig,
  validateAgentPromptBundle,
  validateCommandRequest,
  validateFeedbackRequest,
  validateNamedDeliveryEvent,
  validateNamedHandoffEvent,
  validateOrchestrationPlan,
  validateResultReport,
  validateDataExchangePackage as validateSubAgentDataExchangePackage,
  validateTeamExecutionPlan,
  validateTeamMembership,
  validateTeamConfig,
  validateUserVisibleAgentMessage,
} from "./contracts/sub-agent-orchestration.js"
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
  AgentConfig,
  AgentEntityType,
  AgentRelationship,
  AgentRelationshipStatus,
  AgentPromptBundle,
  AgentPromptBundleValidationSummary,
  AgentPromptFragment,
  AgentPromptFragmentKind,
  AgentPromptFragmentStatus,
  AgentStatus,
  BaseAgentConfig,
  CapabilityDelegationRequest,
  CapabilityPolicy,
  CapabilityRiskLevel,
  CommandRequest,
  DataExchangePackage,
  DataExchangeRetentionPolicy,
  DelegationPolicy,
  DependencyEdgeContract,
  DepthScopedToolKind,
  DepthScopedToolPolicy,
  ErrorReport,
  ExpectedOutputContract,
  FeedbackTargetAgentPolicy,
  FeedbackRequest,
  HistoryVersion,
  LearningApprovalState,
  LearningEvent,
  MemoryPolicy,
  ModelProfile,
  NamedDeliveryEvent,
  NamedDeliveryKind,
  NamedHandoffEvent,
  NicknameEntityType,
  NicknameNamespaceConflict,
  NicknameNamespaceEntry,
  NicknameSnapshot,
  NobieConfig as NobieAgentConfig,
  OrchestrationMode,
  OrchestrationPlan,
  OrchestrationTask,
  OwnerScope,
  ParallelSubSessionGroup,
  ParentLinkage,
  PermissionProfile,
  ProgressEvent,
  RelationshipEdgeType,
  RelationshipEntityType,
  RelationshipGraphEdge,
  RelationshipGraphNode,
  ResourceLockContract,
  ResourceLockKind,
  RestoreEvent,
  ResultReport,
  ResultReportImpossibleReason,
  ResultReportImpossibleReasonKind,
  RuntimeIdentity,
  SessionContract,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubAgentConfig,
  SubSessionContract,
  SubSessionStatus,
  TaskExecutionKind,
  TeamConfig,
  TeamConflictPolicyMode,
  TeamExecutionFallbackAssignment,
  TeamExecutionPlan,
  TeamExecutionPlanAssignment,
  TeamExecutionTaskSnapshot,
  TeamMembership,
  TeamMembershipStatus,
  TeamResultPolicyMode,
  UserVisibleAgentMessage,
} from "./contracts/sub-agent-orchestration.js"
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
  getAgentCapabilityBinding,
  getCapabilityDelegation,
  listAgentCapabilityBindings,
  insertChannelSmokeRun,
  insertChannelSmokeStep,
  listCapabilityDelegations,
  listMcpServerCatalogEntries,
  listSkillCatalogEntries,
  listChannelSmokeRuns,
  listChannelSmokeSteps,
  upsertAgentCapabilityBinding,
  upsertMcpServerCatalogEntry,
  upsertSkillCatalogEntry,
  updateCapabilityDelegation,
  updateChannelSmokeRun,
} from "./db/index.js"
export type {
  AgentCapabilityBindingInput,
  CapabilityCatalogPersistenceOptions,
  DbAgentCapabilityBinding,
  DbAgentCapabilityBindingStatus,
  DbAgentCapabilityKind,
  DbCapabilityCatalogStatus,
  DbMcpServerCatalogEntry,
  DbSkillCatalogEntry,
  McpServerCatalogEntryInput,
  SkillCatalogEntryInput,
} from "./db/index.js"

// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js"
export type {
  AgentScopedToolDispatchInput,
  AgentTool,
  AnyTool,
  ToolContext,
  ToolResult,
  RiskLevel,
} from "./tools/index.js"

// Capability isolation
export {
  acquireAgentCapabilityRateLimit,
  buildCapabilityApprovalAggregationEvent,
  buildCapabilityDelegationRequest,
  buildCapabilityResultDataExchange,
  buildDangerousCapabilityFixtureMatrix,
  createCapabilityPolicySnapshot,
  applyCapabilityDelegationApprovalDecision,
  classifyDepthScopedToolKind,
  evaluateAgentToolCapabilityPolicy,
  evaluateDepthScopedToolPolicy,
  evaluateDangerousCapabilityApprovalFixture,
  isMcpServerAllowed,
  isToolAllowedBySkillMcpAllowlist,
  mapDangerousFixtureRiskLevel,
  parseMcpRegisteredToolName,
  persistCapabilityResultDataExchange,
  recordCapabilityDelegationRequest,
  resetAgentCapabilityRateLimitsForTest,
  resolveToolCapabilityRisk,
  toAgentCapabilityCallContext,
  updateCapabilityDelegationLifecycle,
} from "./security/capability-isolation.js"
export type {
  AgentCapabilityCallContext,
  AgentCapabilityPolicyDecision,
  AgentCapabilityRateLimitLease,
  CapabilityApprovalAggregationEvent,
  CapabilityApprovalActor,
  CapabilityApprovalDecision,
  CapabilityApprovalDenialReason,
  CapabilityDelegationLifecycleResult,
  CapabilityPolicySnapshot,
  DangerousCapabilityApprovalFixture,
  DangerousCapabilityFixtureRiskLevel,
  DepthScopedToolPolicyDecision,
  McpRegisteredToolRef,
} from "./security/capability-isolation.js"

// Agent
export { runAgent } from "./agent/index.js"
export type { AgentChunk, RunAgentParams } from "./agent/index.js"
export { buildTaskIntakeSystemPrompt } from "./agent/intake-prompt.js"
export {
  approveLearningEvent,
  buildHistoryVersion,
  dbHistoryVersionToContract,
  dbLearningEventToContract,
  dbRestoreEventToContract,
  dryRunRestoreHistoryVersion,
  evaluateLearningPolicy,
  listAgentLearningEvents,
  listHistoryVersions,
  listLearningReviewQueue,
  listRestoreEvents,
  recordHistoryVersion,
  recordLearningEvent,
  restoreHistoryVersion,
} from "./agent/learning.js"
export type {
  TaskIntakeActionType,
  TaskIntakeIntentCategory,
  TaskIntakeMessageMode,
  TaskIntakePriority,
  TaskIntakePromptOptions,
  TaskIntakeTaskProfile,
} from "./agent/intake-prompt.js"
export type {
  ApproveLearningEventInput,
  ApproveLearningEventResult,
  HistoryVersionInput,
  LearningEventServiceInput,
  LearningEventServiceResult,
  LearningPolicyDecision,
  LearningPolicyInput,
  LearningPolicyReasonCode,
  LearningReviewQueueQuery,
  LearningRiskLevel,
  RestoreDryRunResult,
  RestoreHistoryVersionInput,
  RestoreHistoryVersionResult,
} from "./agent/learning.js"

// Instructions
export { discoverInstructionChain } from "./instructions/discovery.js"
export { loadMergedInstructions } from "./instructions/merge.js"
export type { InstructionChain, InstructionSource } from "./instructions/discovery.js"
export type { MergedInstructionBundle } from "./instructions/merge.js"

// Memory
export {
  storeMemory,
  storeMemorySync,
  searchMemory,
  searchMemorySync,
  recentMemories,
  buildMemoryContext,
} from "./memory/store.js"
export {
  runMemoryRetrievalEvaluation,
  seedMemoryRetrievalEvaluationFixture,
  evaluateMemoryRetrievalQuery,
} from "./memory/evaluation.js"
export { diagnoseVectorEmbeddingRows } from "./memory/search.js"
export {
  buildLearningWritebackCandidate,
  listMemoryWritebackReviewItems,
  reviewMemoryWritebackCandidate,
  inspectMemoryWritebackSafety,
} from "./memory/writeback.js"
export {
  MemoryIsolationError,
  assertMemoryAccessAllowed,
  buildDataExchangeAdminRawView,
  buildDataExchangeContextMemoryRefs,
  buildDataExchangeSanitizedView,
  buildMemorySummaryDataExchange,
  createDataExchangePackage,
  dbAgentDataExchangeToPackage,
  getDataExchangePackage,
  inspectDataExchangePayloadRisk,
  isDataExchangeUsableForMemoryAccess,
  listActiveDataExchangePackagesForRecipient,
  listActiveDataExchangePackagesForSource,
  memoryOwnerScopeKey,
  persistDataExchangePackage,
  prepareAgentMemoryWritebackQueueInput,
  preparePolicyControlledMemoryWritebackQueueInput,
  resolveMemoryOwnerScopePolicy,
  searchOwnerScopedMemory,
  storeOwnerScopedMemory,
  validateDataExchangePackage,
} from "./memory/isolation.js"
export type {
  CreateDataExchangePackageInput,
  DataExchangeAdminRawView,
  DataExchangeProvenanceKind,
  DataExchangeRedactionCategory,
  DataExchangeRedactionInspection,
  DataExchangeSanitizedView,
  DataExchangeValidationIssue,
  DataExchangeValidationIssueCode,
  DataExchangeValidationResult,
  MemoryAccessMode,
  MemoryOwnerScope,
  MemoryOwnerScopeKind,
  MemoryOwnerScopePolicy,
  MemoryVisibility,
  OwnerScopedMemorySearchParams,
  OwnerScopedMemorySearchResult,
  ParentMemoryWritebackPolicy,
  PreparePolicyControlledMemoryWritebackInput,
  RunMemoryOwnerScope,
  StoreOwnerScopedMemoryParams,
} from "./memory/isolation.js"
export type {
  MemoryRetrievalEvaluationFixture,
  MemoryRetrievalEvaluationMode,
  MemoryRetrievalEvaluationReport,
} from "./memory/evaluation.js"
export type { MemoryVectorDegradedReason, MemoryVectorDiagnostic } from "./memory/search.js"
export type {
  LearningWritebackCandidate,
  MemoryWritebackReviewAction,
  MemoryWritebackReviewItem,
  MemoryWritebackReviewResult,
  MemoryWritebackSafetyResult,
} from "./memory/writeback.js"
export type {
  PromptSourceBackupResult,
  PromptSourceDiffResult,
  PromptSourceDryRunResult,
  PromptSourceLocaleParityResult,
  PromptSourceRollbackResult,
  PromptSourceWriteResult,
} from "./memory/nobie-md.js"
export type {
  PromptImpactScenarioResult,
  PromptRegressionIssue,
  PromptRegressionLocale,
  PromptResponsibilityRuleResult,
  PromptSourceRegressionResult,
} from "./memory/prompt-regression.js"
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
export {
  getEmbeddingProvider,
  NullEmbeddingProvider,
  OllamaEmbeddingProvider,
  VoyageEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "./memory/embedding.js"

// Plugins
export { pluginLoader, PluginLoader } from "./plugins/loader.js"
export type {
  NobiePlugin,
  WizbyPlugin,
  HowiePlugin,
  PluginContext,
  PluginMeta,
} from "./plugins/types.js"

// MCP
export { filterMcpStatusesForAgentAllowlist, mcpRegistry } from "./mcp/registry.js"
export { McpStdioClient, buildMcpToolCallPayload } from "./mcp/client.js"
export type { McpServerStatus, McpSummary, McpToolStatus } from "./mcp/registry.js"
export type { McpAgentCallContext, McpToolCallPayload } from "./mcp/client.js"

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
export type {
  IngressExternalIdentity,
  IngressReceipt,
  IngressReceiptLanguage,
  ResolvedIngressStartParams,
  StartedIngressRun,
} from "./runs/ingress.js"
export {
  buildInboundMessageKey,
  createInboundMessageRecord,
  detectExplicitToolIntent,
  hasExplicitContinuationReference,
  shouldInspectActiveRunCandidates,
} from "./runs/request-isolation.js"
export type {
  ExplicitToolIntentName,
  InboundMessageInput,
  InboundMessageRecord,
} from "./runs/request-isolation.js"
export {
  canTransitionRunStatus,
  deriveRunCompletionOutcome,
  isTerminalRunStatus,
  resolveRunFlowIdentifiers,
} from "./runs/flow-contract.js"
export type {
  RunCompletionOutcome,
  RunCompletionOutcomeInput,
  RunCompletionOutcomeStatus,
  RunFlowIdentifiers,
  RunFlowStatusTransitionDecision,
} from "./runs/flow-contract.js"
export {
  buildStartupRecoverySummary,
  classifyStartupRecovery,
  getLastStartupRecoverySummary,
} from "./runs/startup-recovery.js"
export type {
  StartupRecoveryClassification,
  StartupRecoveryRunSummary,
  StartupRecoveryScheduleSummary,
  StartupRecoveryStatus,
  StartupRecoverySummary,
} from "./runs/startup-recovery.js"
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

import { startServer as _startServer } from "./api/server.js"
import { startChannels as _startChannels } from "./channels/index.js"
// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js"
import {
  getDb as _getDb,
  insertAuditLog as _insertAuditLog,
  upsertPromptSources as _upsertPromptSources,
} from "./db/index.js"
import { mcpRegistry as _mcpRegistry } from "./mcp/registry.js"
import { ensurePromptSourceFiles as _ensurePromptSourceFiles } from "./memory/nobie-md.js"
import {
  startMqttBroker as _startMqttBroker,
  stopMqttBroker as _stopMqttBroker,
} from "./mqtt/broker.js"
import { recoverActiveRunsOnStartup as _recoverActiveRunsOnStartup } from "./runs/store.js"
import { refreshRuntimeManifest as _refreshRuntimeManifest } from "./runtime/manifest.js"
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js"

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
      output: JSON.stringify({
        created: promptSeed.created,
        existing: promptSeed.existing.length,
        sources: promptSeed.registry.length,
      }),
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
