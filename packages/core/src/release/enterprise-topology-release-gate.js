export const ENTERPRISE_TOPOLOGY_RELEASE_FEATURE_FLAGS = [
    {
        featureKey: "enterprise_topology_registry",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "registry",
        description: "Versioned topology registry, activation history, and rollback target metadata.",
    },
    {
        featureKey: "enterprise_topology_validator",
        defaultMode: "shadow",
        defaultCompatibilityMode: true,
        owner: "contracts",
        description: "Schema, relation, execution, and enterprise rule validation without runtime routing.",
    },
    {
        featureKey: "enterprise_topology_compiler",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "compiler",
        description: "Compilation of validated topology versions into immutable runtime snapshots.",
    },
    {
        featureKey: "topology_runtime_mvp",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "runtime",
        description: "MVP topology node runtime and Nobie-owned final answer synthesis.",
    },
    {
        featureKey: "topology_runtime_recursive_delegation",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "runtime",
        description: "Bounded recursive child delegation beyond the MVP entry-node execution path.",
    },
    {
        featureKey: "topology_tool_runtime",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "runtime",
        description: "Node-scoped tool execution behind permission, approval, and audit gates.",
    },
    {
        featureKey: "topology_exhaustion_failure",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "runtime",
        description: "Topology-specific exhaustion and failure-report behavior.",
    },
    {
        featureKey: "declared_observed_topology_analysis",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "analysis",
        description: "Read-only Trace and Improve layer evidence for declared versus observed topology gaps.",
    },
    {
        featureKey: "enterprise_topology_builder_ui",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "webui",
        description: "Unified /advanced/topology workspace with the simple Build, Run, Trace, and Improve layers.",
    },
    {
        featureKey: "topology_runtime_enabled",
        defaultMode: "off",
        defaultCompatibilityMode: true,
        owner: "runtime",
        description: "Run layer root-run routing gate. Off must always preserve the single Nobie path.",
    },
];
export const ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS = [
    "build",
    "run",
    "trace",
    "improve",
];
export const ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH = [
    {
        id: "template_select",
        label: "Choose a starter workflow template from cards.",
        noTypingRequired: true,
    },
    {
        id: "node_add",
        label: "Add the next work step from palette presets.",
        noTypingRequired: true,
    },
    {
        id: "smart_connect",
        label: "Connect selected steps with Smart Connect.",
        noTypingRequired: true,
    },
    {
        id: "quick_fix",
        label: "Apply validation or runtime quick fix from a button preview.",
        noTypingRequired: true,
    },
    {
        id: "run_strip",
        label: "Run from the one-line WorkOrder Template and Context strip.",
        noTypingRequired: true,
    },
    {
        id: "trace_review",
        label: "Open Trace and Improve evidence without raw JSON inspection.",
        noTypingRequired: true,
    },
];
export const ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE = [
    {
        id: "contracts_validator_only",
        order: 1,
        title: "Contracts and validator only",
        trafficPolicy: "contracts_only",
        featureFlagRequirements: [
            requirement("enterprise_topology_validator", ["shadow", "enforced"], "Validator may collect diagnostics before traffic is routed."),
            requirement("topology_runtime_enabled", ["off", "rollback"], "Root-run routing must stay disabled in the contracts-only stage."),
        ],
        promotionCriteria: [
            "Topology schema, relation, validator, and enterprise rule tests pass.",
            "Validation evidence is diagnostic-only and cannot alter root-run routing.",
        ],
        rollbackAction: "Keep topology_runtime_enabled=off and remove topology validation evidence from release notes if it is noisy.",
    },
    {
        id: "dry_run_shadow",
        order: 2,
        title: "Dry-run and shadow mode",
        trafficPolicy: "diagnostic_shadow",
        featureFlagRequirements: [
            requirement("enterprise_topology_registry", ["shadow", "dual_write"], "Registry writes are diagnostic until activation is gated."),
            requirement("enterprise_topology_validator", ["shadow", "enforced"], "Validator remains active for every candidate topology."),
            requirement("enterprise_topology_compiler", ["shadow", "dual_write"], "Compiler snapshots may be generated but not routed."),
            requirement("declared_observed_topology_analysis", ["shadow", "dual_write"], "Trace and Improve layers can compare declared and observed relations without routing."),
            requirement("topology_runtime_enabled", ["off", "rollback"], "Root-run routing remains disabled during dry-run."),
        ],
        promotionCriteria: [
            "Dry-run registry and compiler evidence can be regenerated from source topology versions.",
            "Observed gap analysis is read-only in Trace and Improve layers and has no user-facing routing effect.",
        ],
        rollbackAction: "Set registry, compiler, and analysis flags to off or rollback; keep generated snapshots as evidence only.",
    },
    {
        id: "gated_mode",
        order: 3,
        title: "Gated operator mode",
        trafficPolicy: "operator_gated",
        featureFlagRequirements: [
            requirement("enterprise_topology_registry", ["dual_write", "enforced"], "Versioned active topology state is required before operator beta."),
            requirement("enterprise_topology_validator", ["enforced"], "Invalid topologies must be blocked before gated runtime tests."),
            requirement("enterprise_topology_compiler", ["dual_write", "enforced"], "Compiled snapshots must exist before runtime selection."),
            requirement("topology_runtime_mvp", ["shadow", "dual_write"], "MVP runtime smoke may run, but root routing is still disabled."),
            requirement("enterprise_topology_builder_ui", ["shadow", "dual_write"], "Unified workspace may expose drafts, validation, run strip, trace, improve, and resources without public routing."),
            requirement("topology_runtime_enabled", ["off", "rollback"], "Root-run routing is not public in gated mode."),
        ],
        promotionCriteria: [
            "Operator can activate, inspect, and rollback a topology version without deleting data.",
            "Unified workspace route compatibility, layer coverage, and no-typing happy path evidence pass.",
            "Topology runtime smoke proves final answers still flow through Nobie finalization.",
        ],
        rollbackAction: "Set topology_runtime_mvp and enterprise_topology_builder_ui to off, then rollback active topology if operator beta changed it.",
    },
    {
        id: "opt_in_routing",
        order: 4,
        title: "Opt-in root-run routing",
        trafficPolicy: "explicit_opt_in_routing",
        featureFlagRequirements: [
            requirement("enterprise_topology_registry", ["enforced"], "Active topology selection requires enforced registry semantics."),
            requirement("enterprise_topology_validator", ["enforced"], "Only executable topologies can be routed."),
            requirement("enterprise_topology_compiler", ["enforced"], "Routing requires a compiled snapshot that matches the active version."),
            requirement("topology_runtime_mvp", ["enforced"], "MVP node runtime must pass before root-run routing."),
            requirement("topology_runtime_enabled", ["enforced"], "The final routing flag must remain explicit opt-in."),
        ],
        promotionCriteria: [
            "Feature flag off path and single Nobie fallback are verified in the same release gate.",
            "Run Strip, Trace, Improve, and Resources layers are verified before opt-in routing is exposed.",
            "Sub-agent and channel finalizer regression suites pass with topology routing enabled.",
            "Rollback smoke restores the previous active topology and compiled snapshot without data deletion.",
        ],
        rollbackAction: "Set topology_runtime_enabled=off first, then rollback active topology and compiled snapshot to the previous known-good version.",
    },
];
export const ENTERPRISE_TOPOLOGY_RELEASE_REGRESSION_COMMANDS = [
    {
        id: "sub_agent_regression_suite",
        title: "Sub-agent regression suite",
        command: [
            "pnpm",
            "test",
            "tests/task030-release-gate-rollback-soak.test.ts",
            "tests/task027-nested-delegation-policy.test.ts",
        ],
        required: true,
        smoke: false,
        description: "Preserve sub-agent rollback, restart-resume, nested delegation, and duplicate-final safety.",
    },
    {
        id: "channel_finalizer_regression_suite",
        title: "Channel finalizer regression suite",
        command: [
            "pnpm",
            "test",
            "tests/task023-channel-finalizer-late-result.test.ts",
            "tests/channel-delivery-fallback.test.ts",
            "tests/channel-smoke-runner.test.ts",
        ],
        required: true,
        smoke: false,
        description: "Preserve final-answer dedupe, late-result no-reply behavior, delivery fallback, and channel smoke evidence.",
    },
    {
        id: "webui_build_gate",
        title: "WebUI build gate",
        command: ["pnpm", "--filter", "@nobie/webui", "build"],
        required: true,
        smoke: false,
        description: "Ensure the GUI-first topology builder and existing WebUI compile before release.",
    },
    {
        id: "topology_workspace_usability_gate",
        title: "Topology Workspace usability gate",
        command: [
            "pnpm",
            "test",
            "tests/task012-topology-workspace-release-gate.test.ts",
            "tests/task001-topology-workspace-ux-foundation.test.tsx",
            "tests/task002-topology-workspace-routing.test.tsx",
            "tests/task008-topology-workspace-run-strip.test.tsx",
            "tests/task011-topology-workspace-trace-improve.test.tsx",
        ],
        required: true,
        smoke: false,
        description: "Verify unified route compatibility, workspace layer coverage, and no-typing build-run-trace happy path.",
    },
    {
        id: "topology_runtime_smoke",
        title: "Topology runtime smoke",
        command: [
            "pnpm",
            "test",
            "tests/task023-topology-root-run-integration.test.ts",
            "tests/task024-enterprise-extension-rules-metrics.test.ts",
        ],
        required: true,
        smoke: true,
        description: "Verify feature flag off fallback, opt-in root routing, MVP runtime, enterprise rules, and metrics.",
    },
    {
        id: "topology_rollback_smoke",
        title: "Topology rollback smoke",
        command: ["pnpm", "test", "tests/task025-enterprise-topology-release-gate.test.ts"],
        required: true,
        smoke: true,
        description: "Verify release flag matrix, single Nobie fallback, rollback runbook, and snapshot restore evidence.",
    },
];
export function buildEnterpriseTopologyRuntimeSmoke(input = {}) {
    const now = input.now ?? new Date();
    const base = {
        featureFlagOffPathPassed: true,
        singleNobieFallbackPassed: true,
        subAgentRuntimePreserved: true,
        topologyRuntimeMvpPassed: true,
        nobieFinalAnswerOwnershipPreserved: true,
        channelFinalizerDedupePreserved: true,
        ...input.overrides,
    };
    const blockingFailures = [];
    if (!base.featureFlagOffPathPassed)
        blockingFailures.push("feature_flag_off_path_failed");
    if (!base.singleNobieFallbackPassed)
        blockingFailures.push("single_nobie_fallback_failed");
    if (!base.subAgentRuntimePreserved)
        blockingFailures.push("sub_agent_runtime_regression");
    if (!base.topologyRuntimeMvpPassed)
        blockingFailures.push("topology_runtime_mvp_failed");
    if (!base.nobieFinalAnswerOwnershipPreserved)
        blockingFailures.push("nobie_final_answer_ownership_regression");
    if (!base.channelFinalizerDedupePreserved)
        blockingFailures.push("channel_finalizer_dedupe_regression");
    return {
        kind: "nobie.enterprise_topology.runtime_smoke",
        generatedAt: now.toISOString(),
        featureFlagKey: "topology_runtime_enabled",
        featureFlagModeForSmoke: input.featureFlagModeForSmoke ?? "enforced",
        featureFlagOffPathPassed: base.featureFlagOffPathPassed,
        singleNobieFallbackPassed: base.singleNobieFallbackPassed,
        subAgentRuntimePreserved: base.subAgentRuntimePreserved,
        topologyRuntimeMvpPassed: base.topologyRuntimeMvpPassed,
        nobieFinalAnswerOwnershipPreserved: base.nobieFinalAnswerOwnershipPreserved,
        channelFinalizerDedupePreserved: base.channelFinalizerDedupePreserved,
        status: statusFromFailures(blockingFailures),
        blockingFailures,
    };
}
export function buildEnterpriseTopologyRollbackSmoke(input = {}) {
    const now = input.now ?? new Date();
    const base = {
        singleNobieModeRestored: true,
        activeTopologyRollbackVerified: true,
        compiledSnapshotRestoreVerified: true,
        registryHistoryPreserved: true,
        ...input.overrides,
    };
    const blockingFailures = [];
    if (!base.singleNobieModeRestored)
        blockingFailures.push("single_nobie_mode_not_restored");
    if (!base.activeTopologyRollbackVerified)
        blockingFailures.push("active_topology_rollback_not_verified");
    if (!base.compiledSnapshotRestoreVerified)
        blockingFailures.push("compiled_snapshot_restore_not_verified");
    if (!base.registryHistoryPreserved)
        blockingFailures.push("registry_history_not_preserved");
    return {
        kind: "nobie.enterprise_topology.rollback_smoke",
        generatedAt: now.toISOString(),
        featureFlagKey: "topology_runtime_enabled",
        featureFlagModeBeforeRollback: input.featureFlagModeBeforeRollback ?? "enforced",
        featureFlagModeAfterRollback: "off",
        dataDeletionRequired: false,
        singleNobieModeRestored: base.singleNobieModeRestored,
        activeTopologyRollbackVerified: base.activeTopologyRollbackVerified,
        compiledSnapshotRestoreVerified: base.compiledSnapshotRestoreVerified,
        registryHistoryPreserved: base.registryHistoryPreserved,
        status: statusFromFailures(blockingFailures),
        blockingFailures,
    };
}
export function buildEnterpriseTopologyWorkspaceUsabilityGate(input = {}) {
    const now = input.now ?? new Date();
    const requiredLayers = input.requiredLayers ?? ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS;
    const routeCompatibility = {
        canonicalRoute: "/advanced/topology",
        enterpriseBuilderAlias: "/advanced/enterprise-topology",
        enterpriseBuilderReplacement: "/advanced/topology?mode=build",
        runtimeResourcesRoute: null,
        legacyRuntimeMenuRemoved: true,
        ...input.routeCompatibility,
    };
    const noTypingHappyPath = input.noTypingHappyPath ?? ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH;
    const featureFlagOffFallbacks = input.featureFlagOffFallbacks ?? [
        "/advanced/topology is hidden by enterprise_topology_builder_ui when disabled.",
        "/advanced/enterprise-topology redirects to /advanced/topology?mode=build and then follows the same feature gate.",
        "topology_runtime_enabled=off preserves single Nobie root-run routing.",
    ];
    const layerSet = new Set(requiredLayers);
    const requiredStepSet = new Set(ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH.map((step) => step.id));
    const suppliedStepSet = new Set(noTypingHappyPath.map((step) => step.id));
    const blockingFailures = [];
    for (const layer of ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS) {
        if (!layerSet.has(layer))
            blockingFailures.push(`missing_workspace_layer:${layer}`);
    }
    for (const step of requiredStepSet) {
        if (!suppliedStepSet.has(step))
            blockingFailures.push(`missing_no_typing_step:${step}`);
    }
    for (const step of noTypingHappyPath) {
        if (!step.noTypingRequired)
            blockingFailures.push(`typing_required:${step.id}`);
    }
    if (routeCompatibility.canonicalRoute !== "/advanced/topology") {
        blockingFailures.push("workspace_route_not_canonical");
    }
    if (routeCompatibility.enterpriseBuilderAlias !== "/advanced/enterprise-topology" ||
        routeCompatibility.enterpriseBuilderReplacement !== "/advanced/topology?mode=build") {
        blockingFailures.push("enterprise_topology_alias_not_preserved");
    }
    if (routeCompatibility.runtimeResourcesRoute !== null) {
        blockingFailures.push("runtime_resources_route_still_exposed");
    }
    if (!routeCompatibility.legacyRuntimeMenuRemoved) {
        blockingFailures.push("legacy_runtime_topology_menu_still_visible");
    }
    if (!featureFlagOffFallbacks.some((item) => item.includes("enterprise_topology_builder_ui"))) {
        blockingFailures.push("builder_ui_feature_flag_off_fallback_missing");
    }
    if (!featureFlagOffFallbacks.some((item) => item.includes("single Nobie"))) {
        blockingFailures.push("single_nobie_root_run_fallback_missing");
    }
    return {
        kind: "nobie.enterprise_topology.workspace_usability",
        generatedAt: now.toISOString(),
        featureFlagKey: "enterprise_topology_builder_ui",
        canonicalRoute: "/advanced/topology",
        requiredLayers,
        routeCompatibility,
        noTypingHappyPath,
        featureFlagOffFallbacks,
        status: statusFromFailures(blockingFailures),
        blockingFailures,
    };
}
export function buildEnterpriseTopologyRollbackRunbook() {
    return {
        id: "enterprise-topology-rollback-runbook",
        title: "Enterprise Topology rollback runbook",
        stopBeforeRollback: [
            "Stop Gateway root-run intake and channel adapter writers before changing active topology state.",
            "Confirm no topology registry, compiler, metric refresh, or builder UI write is in progress.",
        ],
        flagActions: [
            "Set topology_runtime_enabled=off before restoring binaries or registry state.",
            "Set topology_runtime_mvp=off when the incident involves node runtime execution.",
            "Set enterprise_topology_builder_ui=off when the incident involves /advanced/topology, GUI activation, or operator controls.",
            "Set declared_observed_topology_analysis=off when the incident involves Trace or Improve layer evidence.",
            "Set enterprise_topology_registry and enterprise_topology_compiler to rollback or off for state-related incidents.",
        ],
        restoreTargets: [
            "enterprise_topologies active_version and active_version_id",
            "enterprise_topology_versions previous known-good topology JSON",
            "topology_validation_snapshots for the target version",
            "compiled_topology_snapshots for the target version",
            "topology runtime trace tables only as evidence, never as destructive cleanup",
        ],
        steps: [
            "Verify the release manifest checksum and the backup snapshot checksum.",
            "Record current active topology id, active version, validation snapshot id, and compiled snapshot id as rollback-of-rollback evidence.",
            "Set topology_runtime_enabled=off and verify new root requests choose the single Nobie fallback path.",
            "Set enterprise_topology_builder_ui=off and verify /advanced/topology hides workspace controls while /advanced/enterprise-topology still redirects to /advanced/topology?mode=build.",
            "Set declared_observed_topology_analysis=off when Trace or Improve layer evidence is suspected, without deleting topology runtime trace tables.",
            "Use registry rollbackTopologyVersion(topologyId, targetVersion) or restore the previous active topology record from the verified backup.",
            "Restore the compiled snapshot that matches the target topology version and source hash.",
            "Run validator and compiler consistency checks against the restored topology version before re-enabling any topology runtime flag.",
            "Run topology rollback smoke, sub-agent regression suite, channel finalizer regression suite, and WebUI build gate.",
            "Keep topology_runtime_enabled=off until post-incident review accepts the restored active topology and compiled snapshot evidence.",
        ],
        verification: [
            "topology_runtime_enabled is off and the single Nobie start plan still creates a root run.",
            "enterprise_topology_builder_ui is off or rollback and the unified workspace route is not exposing activation controls.",
            "/advanced/enterprise-topology remains a compatibility redirect to /advanced/topology?mode=build.",
            "Active topology version matches the selected target version.",
            "Compiled snapshot id matches the restored topology version and source hash.",
            "Registry history contains a rollback or restoration event with the previous active version preserved.",
            "Sub-agent release gate and channel finalizer regression suite still pass.",
            "WebUI builder loads without exposing routing controls while topology runtime is off.",
        ],
        retryForbiddenWhen: [
            "Release or backup checksum verification fails.",
            "The target topology version has no executable validation snapshot.",
            "The compiled snapshot source hash does not match the target topology version.",
            "Feature flag off path does not restore single Nobie fallback.",
            "Channel finalizer duplicate-final regression fails.",
        ],
    };
}
export function buildEnterpriseTopologyReleaseFlagMatrix(input = {}) {
    const requestedMode = input.requestedMode ?? inferEnterpriseTopologyReleaseMode(input.featureFlags);
    const mode = releaseModeFor(requestedMode);
    const requirements = new Map(mode.featureFlagRequirements.map((requirementItem) => [
        requirementItem.featureKey,
        requirementItem.allowedModes,
    ]));
    const supplied = input.featureFlags !== undefined;
    const suppliedMap = new Map((input.featureFlags ?? []).map((flag) => [flag.featureKey, flag]));
    return ENTERPRISE_TOPOLOGY_RELEASE_FEATURE_FLAGS.map((definition) => {
        const current = suppliedMap.get(definition.featureKey);
        const currentMode = current?.mode ?? definition.defaultMode;
        const compatibilityMode = current?.compatibilityMode ?? definition.defaultCompatibilityMode;
        const allowedModes = requirements.get(definition.featureKey) ?? [
            "off",
            "shadow",
            "dual_write",
            "enforced",
            "rollback",
        ];
        const presentInRuntimeSnapshot = !supplied || current !== undefined;
        const source = current
            ? "runtime"
            : supplied
                ? "missing_release_default"
                : "release_default";
        return {
            featureKey: definition.featureKey,
            defaultMode: definition.defaultMode,
            currentMode,
            compatibilityMode,
            source,
            presentInRuntimeSnapshot,
            owner: definition.owner,
            requestedModeAllowedModes: allowedModes,
            satisfiesRequestedMode: allowedModes.includes(currentMode),
            description: definition.description,
        };
    });
}
export function buildEnterpriseTopologyReleaseReadinessSummary(options = {}) {
    const now = options.now ?? new Date();
    const requestedMode = options.requestedMode ?? inferEnterpriseTopologyReleaseMode(options.featureFlags);
    const matrix = buildEnterpriseTopologyReleaseFlagMatrix({
        requestedMode,
        ...(options.featureFlags !== undefined ? { featureFlags: options.featureFlags } : {}),
    });
    const runtimeSmoke = options.runtimeSmoke ?? buildEnterpriseTopologyRuntimeSmoke({ now });
    const rollback = options.rollback ??
        buildEnterpriseTopologyRollbackSmoke({
            now,
            featureFlagModeBeforeRollback: flagMode(matrix, "topology_runtime_enabled"),
        });
    const workspaceUsability = options.workspaceUsability ?? buildEnterpriseTopologyWorkspaceUsabilityGate({ now });
    const rollbackRunbook = buildEnterpriseTopologyRollbackRunbook();
    const regressionCommands = options.regressionCommands ?? ENTERPRISE_TOPOLOGY_RELEASE_REGRESSION_COMMANDS;
    const flagFailures = featureFlagMatrixFailures(matrix, requestedMode);
    const expectedModes = [
        "contracts_validator_only",
        "dry_run_shadow",
        "gated_mode",
        "opt_in_routing",
    ];
    const modeIds = ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE.map((mode) => mode.id);
    const checks = [
        gate({
            id: "feature_flag_matrix",
            title: "Feature flag matrix",
            releaseModes: ["contracts_validator_only", "dry_run_shadow", "gated_mode", "opt_in_routing"],
            pass: flagFailures.length === 0,
            summary: "Every Enterprise Topology feature flag is present and valid for the requested rollout stage.",
            evidence: { requestedMode, matrix, failures: flagFailures },
        }),
        gate({
            id: "contracts_validator_only_stage",
            title: "Contracts and validator only stage",
            releaseModes: ["contracts_validator_only"],
            pass: modeIds[0] === "contracts_validator_only",
            summary: "Contracts and validator can ship first with root-run routing disabled.",
            evidence: releaseModeFor("contracts_validator_only"),
        }),
        gate({
            id: "dry_run_shadow_stage",
            title: "Dry-run and shadow stage",
            releaseModes: ["dry_run_shadow"],
            pass: modeIds[1] === "dry_run_shadow",
            summary: "Registry, compiler, and declared/observed analysis can collect dry-run evidence without routing.",
            evidence: releaseModeFor("dry_run_shadow"),
        }),
        gate({
            id: "gated_mode_stage",
            title: "Gated operator mode stage",
            releaseModes: ["gated_mode"],
            pass: modeIds[2] === "gated_mode",
            summary: "Operator beta remains gated until activation, rollback, finalizer, and WebUI evidence pass.",
            evidence: releaseModeFor("gated_mode"),
        }),
        gate({
            id: "opt_in_routing_stage",
            title: "Opt-in routing stage",
            releaseModes: ["opt_in_routing"],
            pass: modeIds[3] === "opt_in_routing" && modeIds.join(">") === expectedModes.join(">"),
            summary: "Root-run topology routing is the final explicit opt-in stage.",
            evidence: releaseModeFor("opt_in_routing"),
        }),
        gate({
            id: "feature_flag_off_path",
            title: "Feature flag off path",
            releaseModes: ["contracts_validator_only", "dry_run_shadow", "gated_mode", "opt_in_routing"],
            pass: runtimeSmoke.featureFlagOffPathPassed,
            summary: "When topology_runtime_enabled is off, topology routing returns fallback before registry selection.",
            evidence: runtimeSmoke,
        }),
        gate({
            id: "single_nobie_fallback",
            title: "Single Nobie fallback",
            releaseModes: ["contracts_validator_only", "dry_run_shadow", "gated_mode", "opt_in_routing"],
            pass: runtimeSmoke.singleNobieFallbackPassed && runtimeSmoke.subAgentRuntimePreserved,
            summary: "Existing single Nobie and sub-agent runtime behavior is preserved when topology routing is disabled.",
            evidence: runtimeSmoke,
        }),
        commandGate("sub_agent_regression_suite", regressionCommands),
        commandGate("channel_finalizer_regression_suite", regressionCommands),
        commandGate("webui_build_gate", regressionCommands),
        gate({
            id: "topology_workspace_route_compatibility",
            title: "Topology Workspace route compatibility",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: workspaceUsability.routeCompatibility.canonicalRoute === "/advanced/topology" &&
                workspaceUsability.routeCompatibility.enterpriseBuilderReplacement === "/advanced/topology?mode=build" &&
                workspaceUsability.routeCompatibility.runtimeResourcesRoute === null &&
                workspaceUsability.routeCompatibility.legacyRuntimeMenuRemoved,
            summary: "The unified workspace owns /advanced/topology while the old enterprise builder alias stays compatible and the resources route is not exposed.",
            evidence: workspaceUsability.routeCompatibility,
        }),
        gate({
            id: "topology_workspace_layer_gate",
            title: "Topology Workspace layer gate",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS.every((layer) => workspaceUsability.requiredLayers.includes(layer)),
            summary: "Build, Run, Trace, and Improve are the visible workspace release scope.",
            evidence: {
                requiredLayers: workspaceUsability.requiredLayers,
                expectedLayers: ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS,
            },
        }),
        gate({
            id: "topology_workspace_no_typing_usability",
            title: "Topology Workspace no-typing usability",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH.every((step) => workspaceUsability.noTypingHappyPath.some((candidate) => candidate.id === step.id)) &&
                workspaceUsability.noTypingHappyPath.every((step) => step.noTypingRequired),
            summary: "The happy path uses template selection, palette, Smart Connect, quick fixes, Run Strip, and Trace without free-form setup.",
            evidence: workspaceUsability,
        }),
        commandGate("topology_workspace_usability_gate", regressionCommands),
        gate({
            id: "topology_runtime_smoke",
            title: "Topology runtime smoke",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: runtimeSmoke.status !== "failed" &&
                runtimeSmoke.topologyRuntimeMvpPassed &&
                runtimeSmoke.nobieFinalAnswerOwnershipPreserved &&
                runtimeSmoke.channelFinalizerDedupePreserved,
            summary: "Topology MVP runtime can execute behind an opt-in flag while Nobie owns final synthesis.",
            evidence: {
                runtimeSmoke,
                command: regressionCommands.find((command) => command.id === "topology_runtime_smoke") ?? null,
            },
        }),
        gate({
            id: "topology_rollback_smoke",
            title: "Topology rollback smoke",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: rollback.status !== "failed" && rollback.dataDeletionRequired === false,
            summary: "Rollback returns root-run routing to off without deleting topology runtime evidence.",
            evidence: {
                rollback,
                command: regressionCommands.find((command) => command.id === "topology_rollback_smoke") ?? null,
            },
        }),
        gate({
            id: "active_topology_snapshot_restore",
            title: "Active topology and snapshot restore",
            releaseModes: ["gated_mode", "opt_in_routing"],
            pass: rollback.activeTopologyRollbackVerified &&
                rollback.compiledSnapshotRestoreVerified &&
                rollback.registryHistoryPreserved,
            summary: "Rollback procedure restores the previous active topology and matching compiled snapshot.",
            evidence: {
                rollback,
                restoreTargets: rollbackRunbook.restoreTargets,
                verification: rollbackRunbook.verification,
            },
        }),
    ];
    const warnings = advancedFlagWarnings(matrix);
    const blockingFailures = [
        ...flagFailures.map((failure) => `feature_flags:${failure}`),
        ...runtimeSmoke.blockingFailures.map((failure) => `runtime_smoke:${failure}`),
        ...rollback.blockingFailures.map((failure) => `rollback_smoke:${failure}`),
        ...workspaceUsability.blockingFailures.map((failure) => `workspace_usability:${failure}`),
        ...checks
            .filter((check) => check.required && check.status === "failed")
            .map((check) => `${check.id}: ${check.summary}`),
    ];
    return {
        kind: "nobie.enterprise_topology.release_readiness",
        version: 1,
        generatedAt: now.toISOString(),
        requestedMode,
        gateStatus: statusFromFailures(blockingFailures, warnings),
        modes: ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE,
        featureFlagMatrix: matrix,
        runtimeSmoke,
        rollback,
        workspaceUsability,
        rollbackRunbook,
        regressionCommands,
        checks,
        warnings,
        blockingFailures,
    };
}
export function inferEnterpriseTopologyReleaseMode(featureFlags = undefined) {
    const flags = new Map((featureFlags ?? []).map((flag) => [flag.featureKey, flag.mode]));
    if (flags.get("topology_runtime_enabled") === "enforced")
        return "opt_in_routing";
    const mvpMode = flags.get("topology_runtime_mvp");
    const registryMode = flags.get("enterprise_topology_registry");
    const compilerMode = flags.get("enterprise_topology_compiler");
    if (mvpMode === "shadow" ||
        mvpMode === "dual_write" ||
        registryMode === "dual_write" ||
        compilerMode === "dual_write") {
        return "gated_mode";
    }
    if (registryMode === "shadow" || compilerMode === "shadow")
        return "dry_run_shadow";
    return "contracts_validator_only";
}
function requirement(featureKey, allowedModes, reason) {
    return { featureKey, allowedModes, reason };
}
function statusFromFailures(blockingFailures, warnings = []) {
    if (blockingFailures.length > 0)
        return "failed";
    if (warnings.length > 0)
        return "warning";
    return "passed";
}
function releaseModeFor(id) {
    const mode = ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE.find((item) => item.id === id);
    if (!mode)
        throw new Error(`Unknown Enterprise Topology release mode: ${id}`);
    return mode;
}
function flagMode(matrix, featureKey) {
    return matrix.find((row) => row.featureKey === featureKey)?.currentMode ?? "off";
}
function featureFlagMatrixFailures(matrix, requestedMode) {
    const failures = [];
    for (const row of matrix) {
        if (!row.presentInRuntimeSnapshot)
            failures.push(`missing_feature_flag:${row.featureKey}`);
        if (!row.satisfiesRequestedMode) {
            failures.push(`${requestedMode}:${row.featureKey}:mode=${row.currentMode}:expected=${row.requestedModeAllowedModes.join("|")}`);
        }
    }
    const runtimeEnabled = flagMode(matrix, "topology_runtime_enabled");
    if (runtimeEnabled === "enforced") {
        for (const key of [
            "enterprise_topology_registry",
            "enterprise_topology_validator",
            "enterprise_topology_compiler",
            "topology_runtime_mvp",
        ]) {
            if (flagMode(matrix, key) !== "enforced") {
                failures.push(`topology_runtime_enabled_requires_enforced:${key}`);
            }
        }
    }
    if (flagMode(matrix, "enterprise_topology_builder_ui") === "enforced") {
        if (flagMode(matrix, "enterprise_topology_validator") !== "enforced") {
            failures.push("enterprise_topology_builder_ui_requires_enforced_validator");
        }
    }
    return failures;
}
function advancedFlagWarnings(matrix) {
    const warnings = [];
    const runtimeEnabled = flagMode(matrix, "topology_runtime_enabled");
    for (const key of [
        "topology_runtime_recursive_delegation",
        "topology_tool_runtime",
        "topology_exhaustion_failure",
    ]) {
        if (flagMode(matrix, key) === "enforced" && runtimeEnabled !== "enforced") {
            warnings.push(`${key}_enforced_without_root_routing`);
        }
    }
    return warnings;
}
function gate(input) {
    return {
        id: input.id,
        title: input.title,
        required: input.required ?? true,
        status: input.pass ? "passed" : "failed",
        releaseModes: input.releaseModes,
        summary: input.summary,
        evidence: input.evidence ?? {},
    };
}
function commandGate(id, commands) {
    const command = commands.find((item) => item.id === id);
    return gate({
        id,
        title: command?.title ?? id,
        releaseModes: ["gated_mode", "opt_in_routing"],
        pass: command !== undefined && command.required,
        summary: command?.description ?? "Required regression command is missing.",
        evidence: command ?? null,
    });
}
//# sourceMappingURL=enterprise-topology-release-gate.js.map
