// Config
export { loadConfig, loadEnv, getConfig, reloadConfig, PATHS } from "./config/index.js";
export { generateAuthToken } from "./config/auth.js";
export { MIGRATION_ROLLBACK_RUNBOOK, buildBackupTargetInventory, buildMigrationPreflightReport, createBackupSnapshot, formatInventoryPathForDisplay, runRestoreRehearsal, verifyBackupSnapshotManifest, } from "./config/backup-rehearsal.js";
export { getCurrentAppVersion, getCurrentDisplayVersion, getWorkspacePackageJsonPath, getWorkspaceRootPath, } from "./version.js";
// Runtime manifest and diagnostics
export { buildRuntimeManifest, getLastRuntimeManifest, refreshRuntimeManifest, } from "./runtime/manifest.js";
export { buildRolloutSafetySnapshot, ensureRolloutSafetyTables, getFeatureFlag, listFeatureFlags, recordRolloutEvidence, recordShadowCompare, setFeatureFlagMode, shouldReadCompatibilityPath, shouldShadowWrite, shouldUseNewPath, } from "./runtime/rollout-safety.js";
export { AGENT_PROMPT_BUNDLE_VERSION, buildAgentPromptBundle, buildAgentPromptBundleCacheKey, createPromptBundleCache, redactPromptSecrets, renderAgentPromptBundleText, } from "./orchestration/prompt-bundle.js";
export { controlSubSession, getSubSessionInfo, killAllSubSessionsForRun, listSubSessionLogs, sanitizeSubSessionControlText, spawnSubSessionAck, } from "./orchestration/sub-session-control.js";
export { InvalidSubSessionStatusTransitionError, ResourceLockManager, SUB_SESSION_STATUS_TRANSITIONS, SubSessionRunner, applyParallelSubSessionBudget, buildSubSessionContract, canTransitionSubSessionStatus, classifySubSessionRecovery, createDryRunSubSessionHandler, createSubSessionRunner, createTextResultReport, loadSubSessionByIdempotencyKey, planOrchestrationExecutionWaves, planSubSessionExecutionWaves, recoverInterruptedSubSessions, runParallelSubSessionGroup, transitionSubSessionStatus, } from "./orchestration/sub-session-runner.js";
export { buildFeedbackLoopPackage, buildRedelegatedSubSessionInput, decideFeedbackLoopContinuation, validateRedelegationTarget, } from "./orchestration/feedback-loop.js";
export { FAST_PATH_CLASSIFIER_TARGET_P95_MS, ORCHESTRATION_PLANNER_TARGET_P95_MS, createOrchestrationPlanner, classifyFastPath, buildDefaultStructuredTaskScope, buildOrchestrationPlan, } from "./orchestration/planner.js";
export { buildOrchestrationRegistrySnapshot, clearAgentCapabilityIndexCache, createAgentRegistryService, createTeamRegistryService, } from "./orchestration/registry.js";
export { buildAgentCapabilitySummary, buildAgentModelSummary, resolveAgentCapabilityModelSummary, } from "./orchestration/capability-model.js";
export { ORCHESTRATION_EVENT_KINDS, buildOrchestrationMonitoringSnapshot, buildRestartResumeProjection, formatOrchestrationEventSse, installOrchestrationEventProjection, listOrchestrationEventLedger, openOrchestrationEventRawPayload, parseOrchestrationReplayCursor, recordOrchestrationEvent, resetOrchestrationEventProjectionForTest, validateOrchestrationEventInput, } from "./orchestration/event-ledger.js";
export { DEFAULT_MODEL_RETRY_COUNT, DEFAULT_MODEL_TIMEOUT_MS, DEFAULT_PROVIDER_MODEL_CAPABILITY_MATRIX, buildModelAvailabilityDoctorSnapshot, buildModelExecutionAuditSummary, estimateModelExecutionCost, estimateTokenCount, resolveFallbackModelExecutionPolicy, resolveModelExecutionPolicy, } from "./orchestration/model-execution-policy.js";
export { createAgentHierarchyService } from "./orchestration/hierarchy.js";
export { createTeamCompositionService } from "./orchestration/team-composition.js";
export { buildTeamExecutionPlan, createTeamExecutionPlanService, } from "./orchestration/team-execution-plan.js";
export { orchestrationCapabilityStatus, resolveOrchestrationModeSnapshot, resolveOrchestrationModeSnapshotSync, } from "./orchestration/mode.js";
export { MIGRATION_ROLLBACK_RUNBOOK_REF, assertMigrationWriteAllowed, beginMigrationLock, checkMigrationWriteGuard, ensureMigrationSafetyTables, failMigrationLock, getActiveMigrationLock, getLatestMigrationLock, releaseMigrationLock, updateMigrationLockPhase, verifyMigrationState, } from "./db/migration-safety.js";
export { lastDoctorReportExists, runDoctor, writeDoctorReportArtifact, } from "./diagnostics/doctor.js";
export { buildReleaseNoteEvidenceSummary, parseTaskMetadata, runPlanDriftCheck, } from "./diagnostics/plan-drift.js";
export { attachCapabilityProfileToTrace, buildProviderProfileId, clearProviderCapabilityCache, getProviderCapabilityMatrix, resolveEmbeddingProviderResolutionSnapshot, } from "./ai/capabilities.js";
// Release package
export { buildCleanMachineInstallChecklist, buildReleaseArtifactDefinitions, buildReleaseManifest, buildReleasePipelinePlan, buildReleaseRollbackRunbook, buildReleaseUpdatePreflightReport, writeReleasePackage, } from "./release/package.js";
export { RELEASE_PERFORMANCE_TARGETS, buildReleasePerformanceSummary, } from "./release/performance-gate.js";
// Logger
export { createLogger, logger } from "./logger/index.js";
// Events
export { eventBus } from "./events/index.js";
// Control-plane timeline
export { exportControlTimeline, getControlTimeline, installControlEventProjection, recordControlEvent, recordControlEventFromLedger, resetControlEventProjectionForTest, } from "./control-plane/timeline.js";
// Message ledger and delivery finalization
export { buildArtifactDeliveryKey as buildMessageLedgerArtifactDeliveryKey, buildTextDeliveryKey as buildMessageLedgerTextDeliveryKey, buildToolCallIdempotencyKey, finalizeDeliveryForRun, findDuplicateToolCall, getAllowRepeatReason, hashLedgerValue, isDedupeTargetTool, recordMessageLedgerEvent, stableStringify, } from "./runs/message-ledger.js";
export { WEB_RETRIEVAL_FIXTURE_SCHEMA_VERSION, buildFixtureRegressionFromWorkspace, buildWebRetrievalReleaseGateSummary, createDryRunWebRetrievalLiveSmokeExecutor, fixtureFileNameForId, getDefaultWebRetrievalLiveSmokeScenarios, isLiveWebSmokeEnabled, loadWebRetrievalFixturesFromDir, runWebRetrievalFixtureRegression, runWebRetrievalLiveSmokeScenarios, validateWebRetrievalLiveSmokeTrace, writeWebRetrievalSmokeArtifact, } from "./runs/web-retrieval-smoke.js";
export { WEB_RETRIEVAL_POLICY_VERSION } from "./runs/web-retrieval-policy.js";
export { DEFAULT_QUEUE_BUDGETS, QUEUE_NAMES, QueueBackpressureError, buildBackpressureUserMessage, buildQueueBackpressureSnapshot, enqueueBackpressureTask, recordQueueBackpressureEvent, recordRetryBudgetAttempt, resetQueueBackpressureState, resetRetryBudget, } from "./runs/queue-backpressure.js";
export { ContextPreflightBlockedError, chatWithContextPreflight, estimateContextTokens, estimateMessagesTokens, prepareChatContext, pruneMessagesForContext, runContextPreflight, validateAgentPromptBundleContextScope, } from "./runs/context-preflight.js";
export { buildDataExchangeJournalRecord } from "./runs/journaling.js";
export { buildFeedbackRequest, collectResultReviewIssues, decideSubSessionCompletionIntegration, getSubAgentResultRetryBudgetLimit, normalizeResultReviewFailureKey, reviewSubAgentResult, } from "./agent/sub-agent-result-review.js";
export { canRetrySubSessionRevision, getSubSessionRevisionBudgetLimit, } from "./runs/recovery-budget.js";
export { decideSubSessionReviewGate } from "./runs/review-gate.js";
export { buildSubSessionFeedbackCycleDirective } from "./runs/review-cycle-pass.js";
export { decideSubSessionCompletionPass } from "./runs/completion-pass.js";
export { activateExtensionWithTrustPolicy, buildExtensionRegistrySnapshot, createExtensionRollbackPoint, extensionIdsForToolName, getExtensionFailureState, isToolExtensionSelectable, listExtensionFailureStates, recordExtensionFailure, recordExtensionRegistryChange, recordExtensionToolFailure, resetExtensionFailureState, rollbackExtensionToPoint, runExtensionHookSafely, } from "./security/extension-governance.js";
export { DEFAULT_EVIDENCE_CONFLICT_POLICY, conflictResolutionToVerdict, conflictSufficiencyIsBlocking, resolveEvidenceConflict, } from "./runs/web-conflict-resolver.js";
export { DEFAULT_RETRIEVAL_CACHE_TTL_POLICY, InMemoryRetrievalCache, buildRetrievalCacheEntry, buildRetrievalCacheKey, buildRetrievalTargetHash, createInMemoryRetrievalCache, evaluateRetrievalCacheEntry, getPersistentRetrievalCacheEntry, listPersistentRetrievalCacheEntriesForTarget, putPersistentRetrievalCacheEntry, resolveRetrievalCacheTtlMs, } from "./runs/web-retrieval-cache.js";
export { buildAnswerDirective, buildWebRetrievalPolicyDecision, evaluateSourceReliabilityGuard, extractSourceTimestampFromHtml, recordBrowserSearchEvidence, } from "./runs/web-retrieval-policy.js";
export { RetrievalSessionController, buildRetrievalDedupeKey, buildRetrievalSessionDirective, createGenericTargetFromPolicy, createRetrievalSessionController, createRetrievalTargetContract, defaultRetrievalBudget, defaultSourceLadder, evaluateLimitedCompletionReadiness, getNextRetrievalMethods, isRetrievalSessionRecoverable, } from "./runs/web-retrieval-session.js";
export { buildCandidateExtractionFailureEvent, extractRetrievedValueCandidates, sourceKindSatisfiesOfficialRequired, verifyRetrievedValueCandidate, verifyRetrievedValueCandidates, } from "./runs/web-retrieval-verification.js";
export { attemptsToPlannerSummaries, buildPlannerCallIdempotencyKey, buildWebRetrievalPlannerPrompt, methodToToolName, runWebRetrievalPlanner, validateWebRetrievalPlannerOutput, } from "./runs/web-retrieval-planner.js";
export { buildFinalAnswerDeliveryKey, buildFinalAnswerIdempotencyKey, buildProgressMessageIdempotencyKey, canGenerateFinalAnswerFromVerdict, finalizeRetrievalCompletion, protectRunFailureAfterFinalAnswer, recordFinalAnswerDelivery, recordProgressMessageSent, } from "./runs/retrieval-finalizer.js";
export { buildFinanceKnownSources, buildFinanceSourceEvidence, buildWeatherKnownSources, buildWeatherSourceEvidence, buildWebSourceAdapterDegradationState, buildWebSourceAdapterRegistrySnapshot, checkAdapterFixtureParserVersions, createFinanceIndexTargetContract, createWeatherTargetContract, createWebLocationContract, FINANCE_ADAPTER_ID, FINANCE_ADAPTER_METADATA, FINANCE_ADAPTER_VERSION, FINANCE_INDEX_DEFINITIONS, FINANCE_PARSER_VERSION, listWebSourceAdapters, locationHierarchyContains, parseFinanceQuoteCandidates, parseWeatherMetricCandidates, rankWebSourceAdaptersForTarget, resolveFinanceIndexTarget, resolveWeatherLocationContract, stableAdapterChecksum, WEATHER_ADAPTER_ID, WEATHER_ADAPTER_METADATA, WEATHER_ADAPTER_VERSION, WEATHER_PARSER_VERSION, DEFAULT_ADAPTER_DEGRADATION_POLICY, withAdapterChecksum, } from "./runs/web-source-adapters/index.js";
// Contracts
export { CANONICAL_JSON_POLICY, CONTRACT_SCHEMA_VERSION, buildDeliveryDedupeKey, buildDeliveryKey, buildDeliveryProjection, buildPayloadHash, buildScheduleIdentityKey, buildScheduleIdentityProjection, buildSchedulePayloadProjection, buildToolTargetProjection, formatContractValidationFailureForUser, stableContractHash, toCanonicalJson, validateDeliveryContract, validateIntentContract, validateScheduleContract, validateToolTargetContract, } from "./contracts/index.js";
export { intentContractFromTaskIntentEnvelope } from "./contracts/intake-adapter.js";
export { findNicknameNamespaceConflict, normalizeNickname, normalizeNicknameSnapshot, SUB_AGENT_CONTRACT_SCHEMA_VERSION, validateAgentRelationship, validateAgentConfig, validateAgentPromptBundle, validateCommandRequest, validateFeedbackRequest, validateNamedDeliveryEvent, validateNamedHandoffEvent, validateOrchestrationPlan, validateResultReport, validateDataExchangePackage as validateSubAgentDataExchangePackage, validateTeamExecutionPlan, validateTeamMembership, validateTeamConfig, validateUserVisibleAgentMessage, } from "./contracts/sub-agent-orchestration.js";
export { findScheduleCandidatesByContract, parseScheduleContractJson, scheduleContractDestinationEquals, scheduleContractTimeEquals, } from "./schedules/candidates.js";
export { buildScheduleContractComparisonSystemPrompt, compareScheduleContractsWithAI, parseScheduleContractComparisonResult, } from "./schedules/comparison.js";
// Candidate Providers
export { buildCandidateDecisionAuditDetails, createExplicitIdProvider, createMemoryVectorProvider, createStoreCandidateProvider, createStructuredKeyProvider, decideCandidateFinal, runCandidateProviders, } from "./candidates/index.js";
// Observability
export { LATENCY_BUDGET_MS, buildLatencyEventLabel, buildLatencyEventLabelForMeasurement, getFastResponseHealthSnapshot, listLatencyMetrics, recordLatencyMetric, resetLatencyMetrics, } from "./observability/latency.js";
// DB
export { getDb, closeDb, insertSession, getSession, insertMessage, getMessages, insertAuditLog, getChannelSmokeRun, getAgentCapabilityBinding, getCapabilityDelegation, listAgentCapabilityBindings, insertChannelSmokeRun, insertChannelSmokeStep, listCapabilityDelegations, listMcpServerCatalogEntries, listSkillCatalogEntries, listChannelSmokeRuns, listChannelSmokeSteps, upsertAgentCapabilityBinding, upsertMcpServerCatalogEntry, upsertSkillCatalogEntry, updateCapabilityDelegation, updateChannelSmokeRun, } from "./db/index.js";
// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js";
// Capability isolation
export { acquireAgentCapabilityRateLimit, buildCapabilityApprovalAggregationEvent, buildCapabilityDelegationRequest, buildCapabilityResultDataExchange, buildDangerousCapabilityFixtureMatrix, createCapabilityPolicySnapshot, applyCapabilityDelegationApprovalDecision, evaluateAgentToolCapabilityPolicy, evaluateDangerousCapabilityApprovalFixture, isMcpServerAllowed, isToolAllowedBySkillMcpAllowlist, mapDangerousFixtureRiskLevel, parseMcpRegisteredToolName, persistCapabilityResultDataExchange, recordCapabilityDelegationRequest, resetAgentCapabilityRateLimitsForTest, resolveToolCapabilityRisk, toAgentCapabilityCallContext, updateCapabilityDelegationLifecycle, } from "./security/capability-isolation.js";
// Agent
export { runAgent } from "./agent/index.js";
export { buildTaskIntakeSystemPrompt } from "./agent/intake-prompt.js";
export { approveLearningEvent, buildHistoryVersion, dbHistoryVersionToContract, dbLearningEventToContract, dbRestoreEventToContract, dryRunRestoreHistoryVersion, evaluateLearningPolicy, listAgentLearningEvents, listHistoryVersions, listRestoreEvents, recordHistoryVersion, recordLearningEvent, restoreHistoryVersion, } from "./agent/learning.js";
// Instructions
export { discoverInstructionChain } from "./instructions/discovery.js";
export { loadMergedInstructions } from "./instructions/merge.js";
// Memory
export { storeMemory, storeMemorySync, searchMemory, searchMemorySync, recentMemories, buildMemoryContext, } from "./memory/store.js";
export { runMemoryRetrievalEvaluation, seedMemoryRetrievalEvaluationFixture, evaluateMemoryRetrievalQuery, } from "./memory/evaluation.js";
export { diagnoseVectorEmbeddingRows } from "./memory/search.js";
export { buildLearningWritebackCandidate, listMemoryWritebackReviewItems, reviewMemoryWritebackCandidate, inspectMemoryWritebackSafety, } from "./memory/writeback.js";
export { MemoryIsolationError, assertMemoryAccessAllowed, buildDataExchangeAdminRawView, buildDataExchangeContextMemoryRefs, buildDataExchangeSanitizedView, buildMemorySummaryDataExchange, createDataExchangePackage, dbAgentDataExchangeToPackage, getDataExchangePackage, inspectDataExchangePayloadRisk, isDataExchangeUsableForMemoryAccess, listActiveDataExchangePackagesForRecipient, listActiveDataExchangePackagesForSource, memoryOwnerScopeKey, persistDataExchangePackage, prepareAgentMemoryWritebackQueueInput, preparePolicyControlledMemoryWritebackQueueInput, resolveMemoryOwnerScopePolicy, searchOwnerScopedMemory, storeOwnerScopedMemory, validateDataExchangePackage, } from "./memory/isolation.js";
export { loadNobieMd, initNobieMd, loadWizbyMd, initWizbyMd, loadHowieMd, initHowieMd, ensurePromptSourceFiles, loadFirstRunPromptSourceAssembly, loadPromptSourceRegistry, loadSystemPromptSourceAssembly, loadSystemPromptSources, dryRunPromptSourceAssembly, buildPromptSourceContentDiff, writePromptSourceWithBackup, rollbackPromptSourceBackup, checkPromptSourceLocaleParity, detectPromptSourceSecretMarkers, isPromptSourceContentSafe, } from "./memory/nobie-md.js";
export { runPromptSourceRegression } from "./memory/prompt-regression.js";
export { fileIndexer, FileIndexer } from "./memory/file-indexer.js";
export { getEmbeddingProvider, NullEmbeddingProvider, OllamaEmbeddingProvider, VoyageEmbeddingProvider, OpenAIEmbeddingProvider, } from "./memory/embedding.js";
// Plugins
export { pluginLoader, PluginLoader } from "./plugins/loader.js";
// MCP
export { filterMcpStatusesForAgentAllowlist, mcpRegistry } from "./mcp/registry.js";
export { McpStdioClient, buildMcpToolCallPayload } from "./mcp/client.js";
// MQTT
export { startMqttBroker, stopMqttBroker, getMqttBrokerSnapshot } from "./mqtt/broker.js";
// Channels
export { startChannels, TelegramChannel, SlackChannel, createDryRunChannelSmokeExecutor, getDefaultChannelSmokeScenarios, resolveChannelSmokeReadiness, runChannelSmokeScenarios, runPersistedChannelSmokeScenarios, sanitizeChannelSmokeTrace, sanitizeChannelSmokeValue, validateChannelSmokeTrace, } from "./channels/index.js";
// Runs
export { startRootRun } from "./runs/start.js";
export { buildIngressReceipt, resolveIngressStartParams, startIngressRun } from "./runs/ingress.js";
export { buildIngressDedupeKey } from "./runs/ingress.js";
export { buildInboundMessageKey, createInboundMessageRecord, detectExplicitToolIntent, hasExplicitContinuationReference, shouldInspectActiveRunCandidates, } from "./runs/request-isolation.js";
export { canTransitionRunStatus, deriveRunCompletionOutcome, isTerminalRunStatus, resolveRunFlowIdentifiers, } from "./runs/flow-contract.js";
export { buildStartupRecoverySummary, classifyStartupRecovery, getLastStartupRecoverySummary, } from "./runs/startup-recovery.js";
export { DEFAULT_RETENTION_POLICY, DEFAULT_RETRY_POLICIES, DEFAULT_SOAK_HEALTH_THRESHOLDS, DEFAULT_SOAK_PROFILES, buildSoakHealthSummary, buildSoakReportArtifact, buildSoakReportPayload, buildRetentionCleanupPlan, buildRetryFailureFingerprint, calculateSoakLatencyStats, collectSoakResourceMetrics, evaluateRetryBackoff, expandSoakOperationMix, getSoakProfile, runRetentionCleanup, runSoakProfile, shouldStopRepeatedFailure, } from "./runs/soak-retention.js";
// Scheduler
export { runSchedule, runScheduleAndWait } from "./scheduler/index.js";
// API server
export { startServer, closeServer } from "./api/server.js";
import { startServer as _startServer } from "./api/server.js";
import { startChannels as _startChannels } from "./channels/index.js";
// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js";
import { getDb as _getDb, insertAuditLog as _insertAuditLog, upsertPromptSources as _upsertPromptSources, } from "./db/index.js";
import { mcpRegistry as _mcpRegistry } from "./mcp/registry.js";
import { ensurePromptSourceFiles as _ensurePromptSourceFiles } from "./memory/nobie-md.js";
import { startMqttBroker as _startMqttBroker, stopMqttBroker as _stopMqttBroker, } from "./mqtt/broker.js";
import { recoverActiveRunsOnStartup as _recoverActiveRunsOnStartup } from "./runs/store.js";
import { refreshRuntimeManifest as _refreshRuntimeManifest } from "./runtime/manifest.js";
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js";
export function bootstrap() {
    _loadConfig();
    _getDb();
    try {
        const promptSeed = _ensurePromptSourceFiles(process.cwd());
        _upsertPromptSources(promptSeed.registry.map(({ content: _content, ...metadata }) => metadata));
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
        });
    }
    catch {
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
            });
        }
        catch {
            // Keep startup alive; prompt bootstrap failures are surfaced through diagnostics when DB is available.
        }
    }
    _registerBuiltinTools();
    try {
        _refreshRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false });
    }
    catch {
        // Runtime manifest failures are surfaced through doctor checks; bootstrap must stay alive.
    }
}
export async function bootstrapRuntime() {
    bootstrap();
    _recoverActiveRunsOnStartup();
    await _mcpRegistry.loadFromConfig();
}
export async function bootstrapAsync() {
    await bootstrapRuntime();
    await _startMqttBroker();
    await _startChannels();
    try {
        await _startServer();
    }
    catch (error) {
        await _stopMqttBroker();
        throw error;
    }
}
//# sourceMappingURL=index.js.map