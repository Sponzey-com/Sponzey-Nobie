import type { CapabilityRiskLevel, SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration.js";
import type { OrchestrationPlannerIntent } from "./planner.js";
export type CommandPaletteResultKind = "agent" | "team" | "sub_session" | "command" | "agent_template" | "team_template";
export type FocusTargetKind = "agent" | "team" | "sub_session";
export interface FocusTarget {
    kind: FocusTargetKind;
    id: string;
    label?: string;
}
export interface FocusBinding {
    schemaVersion: 1;
    threadId: string;
    parentAgentId: string;
    target: FocusTarget;
    source: "api" | "command_palette" | "webui";
    reasonCode: "focus_bound_explicit_planner_target";
    finalAnswerOwner: "unchanged_parent";
    memoryIsolation: "unchanged";
    createdAt: number;
    updatedAt: number;
}
export interface FocusResolveSuccess {
    ok: true;
    binding: FocusBinding;
    plannerIntent: OrchestrationPlannerIntent;
    plannerTarget: {
        kind: "explicit_agent" | "explicit_team";
        id: string;
        sourceTarget: FocusTarget;
    };
    enforcement: {
        directChildVisibility: "checked";
        permissionVisibility: "checked";
        finalAnswerOwnerUnchanged: true;
        memoryIsolationUnchanged: true;
        reasonCodes: string[];
    };
}
export interface FocusResolveFailure {
    ok: false;
    reasonCode: string;
    statusCode: 400 | 404 | 409;
    binding?: FocusBinding;
    details?: Record<string, unknown>;
}
export type FocusResolveResult = FocusResolveSuccess | FocusResolveFailure;
export interface CommandPaletteSearchResult {
    id: string;
    kind: CommandPaletteResultKind;
    title: string;
    subtitle?: string;
    status?: string;
    target?: FocusTarget;
    command?: string;
    route?: string;
    reasonCodes: string[];
}
export interface CommandPaletteSearchResponse {
    query: string;
    generatedAt: number;
    results: CommandPaletteSearchResult[];
}
export interface AgentTemplateDefinition {
    templateId: string;
    displayName: string;
    role: string;
    description: string;
    specialtyTags: string[];
    riskCeiling: CapabilityRiskLevel;
    enabledSkillIds: string[];
    enabledToolNames: string[];
}
export interface TeamTemplateDefinition {
    templateId: string;
    displayName: string;
    purpose: string;
    roleHints: string[];
    requiredTeamRoles: string[];
    requiredCapabilityTags: string[];
}
export interface AgentDescriptionLintWarning {
    code: "description_too_short" | "description_too_broad" | "missing_domain_or_specialty" | "missing_boundaries";
    severity: "warning";
    message: string;
    matched?: string;
}
export declare const AGENT_TEMPLATES: AgentTemplateDefinition[];
export declare const TEAM_TEMPLATES: TeamTemplateDefinition[];
export declare function searchCommandPalette(input?: {
    query?: string;
    scope?: CommandPaletteResultKind | "all";
    limit?: number;
}): CommandPaletteSearchResponse;
export declare function setFocusBinding(input: {
    threadId?: string;
    parentAgentId?: string;
    target: FocusTarget;
    source?: FocusBinding["source"];
}): FocusResolveResult;
export declare function getFocusBinding(threadId?: string): FocusBinding | undefined;
export declare function clearFocusBinding(threadId?: string): {
    ok: true;
    threadId: string;
    cleared: boolean;
    reasonCode: "focus_binding_cleared";
};
export declare function resolveFocusBinding(input: {
    threadId?: string;
    parentAgentId?: string;
}): FocusResolveResult;
export declare function instantiateAgentTemplate(input: {
    templateId: string;
    overrides?: unknown;
    persist?: boolean;
}): {
    ok: true;
    template: AgentTemplateDefinition;
    draft: {
        agent: SubAgentConfig;
        disabled: true;
        reviewRequired: true;
        executionCandidate: false;
        reasonCodes: string[];
    };
    persisted: boolean;
} | {
    ok: false;
    reasonCode: string;
    issues?: unknown;
};
export declare function instantiateTeamTemplate(input: {
    templateId: string;
    overrides?: unknown;
    persist?: boolean;
}): {
    ok: true;
    template: TeamTemplateDefinition;
    draft: {
        team: TeamConfig;
        disabled: true;
        reviewRequired: true;
        executionCandidate: false;
        reasonCodes: string[];
    };
    persisted: boolean;
} | {
    ok: false;
    reasonCode: string;
    issues?: unknown;
};
export declare function importExternalAgentProfileDraft(input: {
    profile: unknown;
    source?: string;
    overrides?: unknown;
    persist?: boolean;
}): {
    ok: true;
    draft: {
        agent: SubAgentConfig;
        disabled: true;
        imported: true;
        reviewRequired: true;
        preflightRequired: true;
        executionCandidate: false;
        reasonCodes: string[];
    };
    importSummary: {
        source: string;
        redactedPreview: unknown;
        redactionCount: number;
    };
    persisted: boolean;
} | {
    ok: false;
    reasonCode: string;
    issues?: unknown;
};
export declare function lintAgentDescription(description: string): {
    ok: true;
    warnings: AgentDescriptionLintWarning[];
    reasonCodes: string[];
};
export declare function executeWorkspaceCommand(input: {
    command: string;
    threadId?: string;
    parentAgentId?: string;
    payload?: unknown;
}): {
    ok: boolean;
    command: string;
    reasonCode: string;
    result?: unknown;
    statusCode?: number;
};
export declare function createOneClickBackgroundTask(input: {
    message?: string;
    sessionId?: string;
    parentRunId?: string;
    targetAgentId?: string;
    dryRun?: boolean;
}): {
    ok: boolean;
    reasonCode: string;
    backgroundTask?: {
        mode: "background_sub_session";
        status: "draft" | "queued";
        parentRunId: string;
        sessionId?: string;
        targetAgentId: string;
        message: string;
        command: string;
        subSessionDraft: Record<string, unknown>;
        finalAnswerOwnerUnchanged: true;
        memoryIsolationUnchanged: true;
    };
    statusCode?: number;
};
//# sourceMappingURL=command-workspace.d.ts.map