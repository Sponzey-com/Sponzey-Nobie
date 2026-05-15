import type { FeatureFlagMode } from "../runtime/rollout-safety.js";
export type EnterpriseTopologyReleaseModeId = "contracts_validator_only" | "dry_run_shadow" | "gated_mode" | "opt_in_routing";
export type EnterpriseTopologyReleaseGateStatus = "passed" | "warning" | "failed";
export type EnterpriseTopologyReleaseFeatureFlagKey = "enterprise_topology_registry" | "enterprise_topology_validator" | "enterprise_topology_compiler" | "topology_runtime_mvp" | "topology_runtime_recursive_delegation" | "topology_tool_runtime" | "topology_exhaustion_failure" | "declared_observed_topology_analysis" | "enterprise_topology_builder_ui" | "topology_runtime_enabled";
export type EnterpriseTopologyReleaseGateCheckId = "feature_flag_matrix" | "contracts_validator_only_stage" | "dry_run_shadow_stage" | "gated_mode_stage" | "opt_in_routing_stage" | "feature_flag_off_path" | "single_nobie_fallback" | "sub_agent_regression_suite" | "channel_finalizer_regression_suite" | "webui_build_gate" | "topology_workspace_route_compatibility" | "topology_workspace_layer_gate" | "topology_workspace_executor_first_usability" | "topology_workspace_usability_gate" | "topology_runtime_smoke" | "topology_rollback_smoke" | "active_topology_snapshot_restore";
export type EnterpriseTopologyWorkspaceLayerId = "build" | "run" | "trace" | "improve";
export interface EnterpriseTopologyReleaseFeatureFlagDefinition {
    featureKey: EnterpriseTopologyReleaseFeatureFlagKey;
    defaultMode: FeatureFlagMode;
    defaultCompatibilityMode: boolean;
    owner: "contracts" | "registry" | "compiler" | "runtime" | "analysis" | "webui";
    description: string;
}
export interface EnterpriseTopologyReleaseFlagRequirement {
    featureKey: EnterpriseTopologyReleaseFeatureFlagKey;
    allowedModes: FeatureFlagMode[];
    reason: string;
}
export interface EnterpriseTopologyReleaseModeDefinition {
    id: EnterpriseTopologyReleaseModeId;
    order: number;
    title: string;
    trafficPolicy: "contracts_only" | "diagnostic_shadow" | "operator_gated" | "explicit_opt_in_routing";
    featureFlagRequirements: EnterpriseTopologyReleaseFlagRequirement[];
    promotionCriteria: string[];
    rollbackAction: string;
}
export interface EnterpriseTopologyReleaseFlagMatrixRow {
    featureKey: EnterpriseTopologyReleaseFeatureFlagKey;
    defaultMode: FeatureFlagMode;
    currentMode: FeatureFlagMode;
    compatibilityMode: boolean;
    source: "runtime" | "release_default" | "missing_release_default";
    presentInRuntimeSnapshot: boolean;
    owner: EnterpriseTopologyReleaseFeatureFlagDefinition["owner"];
    requestedModeAllowedModes: FeatureFlagMode[];
    satisfiesRequestedMode: boolean;
    description: string;
}
export interface EnterpriseTopologyRuntimeSmoke {
    kind: "nobie.enterprise_topology.runtime_smoke";
    generatedAt: string;
    featureFlagKey: "topology_runtime_enabled";
    featureFlagModeForSmoke: FeatureFlagMode;
    featureFlagOffPathPassed: boolean;
    singleNobieFallbackPassed: boolean;
    subAgentRuntimePreserved: boolean;
    topologyRuntimeMvpPassed: boolean;
    nobieFinalAnswerOwnershipPreserved: boolean;
    channelFinalizerDedupePreserved: boolean;
    status: EnterpriseTopologyReleaseGateStatus;
    blockingFailures: string[];
}
export interface EnterpriseTopologyRollbackSmoke {
    kind: "nobie.enterprise_topology.rollback_smoke";
    generatedAt: string;
    featureFlagKey: "topology_runtime_enabled";
    featureFlagModeBeforeRollback: FeatureFlagMode;
    featureFlagModeAfterRollback: "off";
    dataDeletionRequired: false;
    singleNobieModeRestored: boolean;
    activeTopologyRollbackVerified: boolean;
    compiledSnapshotRestoreVerified: boolean;
    registryHistoryPreserved: boolean;
    status: EnterpriseTopologyReleaseGateStatus;
    blockingFailures: string[];
}
export interface EnterpriseTopologyRollbackRunbook {
    id: "enterprise-topology-rollback-runbook";
    title: string;
    stopBeforeRollback: string[];
    flagActions: string[];
    restoreTargets: string[];
    steps: string[];
    verification: string[];
    retryForbiddenWhen: string[];
}
export interface EnterpriseTopologyWorkspaceUsabilityStep {
    id: "template_select" | "node_add" | "smart_connect" | "quick_fix" | "run_strip" | "trace_review";
    label: string;
    noTypingRequired: boolean;
}
export type EnterpriseTopologyExecutorFirstInputKind = "executor_name" | "executor_work" | "run_input";
export interface EnterpriseTopologyExecutorFirstUsabilityStep {
    id: "add_first_executor" | "enter_executor_name" | "enter_executor_work" | "review_understanding" | "add_second_executor" | "connect_executors" | "enter_run_input" | "run" | "review_history";
    label: string;
    actionKind: "button" | "text_input" | "chip_or_button" | "auto_inference" | "review";
    inputKind?: EnterpriseTopologyExecutorFirstInputKind;
}
export interface EnterpriseTopologyWorkspaceInternalStability {
    executorGraphCompilesToEnterpriseTopology: boolean;
    executorGraphMetadataProjectionOnly: boolean;
    ruleBasedInferenceFallback: boolean;
    featureFlagOffSingleNobieFallback: boolean;
    advancedTopologySurfaceRemoved: boolean;
    rollbackProjectionRestoreVerified: boolean;
}
export interface EnterpriseTopologyWorkspaceRouteCompatibility {
    canonicalRoute: "/advanced/topology";
    enterpriseBuilderAlias: "/advanced/enterprise-topology";
    enterpriseBuilderReplacement: "/advanced/topology?mode=build";
    runtimeResourcesRoute: null;
    legacyRuntimeMenuRemoved: boolean;
}
export interface EnterpriseTopologyWorkspaceUsabilityGate {
    kind: "nobie.enterprise_topology.workspace_usability";
    generatedAt: string;
    featureFlagKey: "enterprise_topology_builder_ui";
    canonicalRoute: "/advanced/topology";
    requiredLayers: EnterpriseTopologyWorkspaceLayerId[];
    routeCompatibility: EnterpriseTopologyWorkspaceRouteCompatibility;
    noTypingHappyPath: EnterpriseTopologyWorkspaceUsabilityStep[];
    executorFirstHappyPath: EnterpriseTopologyExecutorFirstUsabilityStep[];
    allowedTypingInputs: EnterpriseTopologyExecutorFirstInputKind[];
    defaultHiddenConcepts: string[];
    defaultRequiredSurfaces: string[];
    internalStability: EnterpriseTopologyWorkspaceInternalStability;
    featureFlagOffFallbacks: string[];
    status: EnterpriseTopologyReleaseGateStatus;
    blockingFailures: string[];
}
export interface EnterpriseTopologyRegressionCommand {
    id: "sub_agent_regression_suite" | "channel_finalizer_regression_suite" | "webui_build_gate" | "topology_workspace_usability_gate" | "topology_runtime_smoke" | "topology_rollback_smoke";
    title: string;
    command: string[];
    required: boolean;
    smoke: boolean;
    description: string;
}
export interface EnterpriseTopologyReleaseGateCheck {
    id: EnterpriseTopologyReleaseGateCheckId;
    title: string;
    required: boolean;
    status: EnterpriseTopologyReleaseGateStatus;
    releaseModes: EnterpriseTopologyReleaseModeId[];
    summary: string;
    evidence: unknown;
}
export interface EnterpriseTopologyReleaseReadinessSummary {
    kind: "nobie.enterprise_topology.release_readiness";
    version: 1;
    generatedAt: string;
    requestedMode: EnterpriseTopologyReleaseModeId;
    gateStatus: EnterpriseTopologyReleaseGateStatus;
    modes: EnterpriseTopologyReleaseModeDefinition[];
    featureFlagMatrix: EnterpriseTopologyReleaseFlagMatrixRow[];
    runtimeSmoke: EnterpriseTopologyRuntimeSmoke;
    rollback: EnterpriseTopologyRollbackSmoke;
    workspaceUsability: EnterpriseTopologyWorkspaceUsabilityGate;
    rollbackRunbook: EnterpriseTopologyRollbackRunbook;
    regressionCommands: EnterpriseTopologyRegressionCommand[];
    checks: EnterpriseTopologyReleaseGateCheck[];
    warnings: string[];
    blockingFailures: string[];
}
export interface EnterpriseTopologyReleaseReadinessOptions {
    now?: Date;
    requestedMode?: EnterpriseTopologyReleaseModeId;
    featureFlags?: Array<{
        featureKey: string;
        mode: FeatureFlagMode;
        compatibilityMode: boolean;
        source?: string;
    }>;
    runtimeSmoke?: EnterpriseTopologyRuntimeSmoke;
    rollback?: EnterpriseTopologyRollbackSmoke;
    workspaceUsability?: EnterpriseTopologyWorkspaceUsabilityGate;
    regressionCommands?: EnterpriseTopologyRegressionCommand[];
}
export declare const ENTERPRISE_TOPOLOGY_RELEASE_FEATURE_FLAGS: EnterpriseTopologyReleaseFeatureFlagDefinition[];
export declare const ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS: EnterpriseTopologyWorkspaceLayerId[];
export declare const ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH: EnterpriseTopologyWorkspaceUsabilityStep[];
export declare const ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_ALLOWED_TYPING_INPUTS: EnterpriseTopologyExecutorFirstInputKind[];
export declare const ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH: EnterpriseTopologyExecutorFirstUsabilityStep[];
export declare const ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS: string[];
export declare const ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_REQUIRED_SURFACES: string[];
export declare const ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_INTERNAL_STABILITY: EnterpriseTopologyWorkspaceInternalStability;
export declare const ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE: EnterpriseTopologyReleaseModeDefinition[];
export declare const ENTERPRISE_TOPOLOGY_RELEASE_REGRESSION_COMMANDS: EnterpriseTopologyRegressionCommand[];
export declare function buildEnterpriseTopologyRuntimeSmoke(input?: {
    now?: Date;
    featureFlagModeForSmoke?: FeatureFlagMode;
    overrides?: Partial<Pick<EnterpriseTopologyRuntimeSmoke, "featureFlagOffPathPassed" | "singleNobieFallbackPassed" | "subAgentRuntimePreserved" | "topologyRuntimeMvpPassed" | "nobieFinalAnswerOwnershipPreserved" | "channelFinalizerDedupePreserved">>;
}): EnterpriseTopologyRuntimeSmoke;
export declare function buildEnterpriseTopologyRollbackSmoke(input?: {
    now?: Date;
    featureFlagModeBeforeRollback?: FeatureFlagMode;
    overrides?: Partial<Pick<EnterpriseTopologyRollbackSmoke, "singleNobieModeRestored" | "activeTopologyRollbackVerified" | "compiledSnapshotRestoreVerified" | "registryHistoryPreserved">>;
}): EnterpriseTopologyRollbackSmoke;
export declare function buildEnterpriseTopologyWorkspaceUsabilityGate(input?: {
    now?: Date;
    requiredLayers?: EnterpriseTopologyWorkspaceLayerId[];
    routeCompatibility?: Partial<EnterpriseTopologyWorkspaceRouteCompatibility>;
    noTypingHappyPath?: EnterpriseTopologyWorkspaceUsabilityStep[];
    executorFirstHappyPath?: EnterpriseTopologyExecutorFirstUsabilityStep[];
    allowedTypingInputs?: EnterpriseTopologyExecutorFirstInputKind[];
    defaultHiddenConcepts?: string[];
    defaultRequiredSurfaces?: string[];
    internalStability?: Partial<EnterpriseTopologyWorkspaceInternalStability>;
    featureFlagOffFallbacks?: string[];
}): EnterpriseTopologyWorkspaceUsabilityGate;
export declare function buildEnterpriseTopologyRollbackRunbook(): EnterpriseTopologyRollbackRunbook;
export declare function buildEnterpriseTopologyReleaseFlagMatrix(input?: {
    requestedMode?: EnterpriseTopologyReleaseModeId;
    featureFlags?: EnterpriseTopologyReleaseReadinessOptions["featureFlags"];
}): EnterpriseTopologyReleaseFlagMatrixRow[];
export declare function buildEnterpriseTopologyReleaseReadinessSummary(options?: EnterpriseTopologyReleaseReadinessOptions): EnterpriseTopologyReleaseReadinessSummary;
export declare function inferEnterpriseTopologyReleaseMode(featureFlags?: EnterpriseTopologyReleaseReadinessOptions["featureFlags"]): EnterpriseTopologyReleaseModeId;
//# sourceMappingURL=enterprise-topology-release-gate.d.ts.map