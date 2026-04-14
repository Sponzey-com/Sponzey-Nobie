import { type SetupMcpServerDraft, type SetupSkillDraftItem } from "./setup-extensions.js";
export type CapabilityStatus = "ready" | "disabled" | "planned" | "error";
export interface FeatureCapability {
    key: string;
    label: string;
    area: "setup" | "gateway" | "runs" | "chat" | "ai" | "security" | "telegram" | "slack" | "scheduler" | "plugins" | "memory" | "mcp" | "mqtt";
    status: CapabilityStatus;
    implemented: boolean;
    enabled: boolean;
    reason?: string;
    dependsOn?: string[];
}
export interface CapabilityCounts {
    ready: number;
    disabled: number;
    planned: number;
    error: number;
}
export interface AIBackendCard {
    id: string;
    label: string;
    kind: "provider";
    providerType: "openai" | "ollama" | "llama" | "anthropic" | "gemini" | "custom";
    authMode: "api_key" | "chatgpt_oauth";
    credentials: {
        apiKey?: string;
        username?: string;
        password?: string;
        oauthAuthFilePath?: string;
    };
    local: boolean;
    enabled: boolean;
    availableModels: string[];
    defaultModel: string;
    status: CapabilityStatus;
    summary: string;
    tags: string[];
    reason?: string;
    endpoint?: string;
}
export interface RoutingProfile {
    id: "default" | "general_chat" | "planning" | "coding" | "review" | "research" | "private_local" | "summarization" | "operations";
    label: string;
    targets: string[];
}
export interface SetupState {
    version: 1;
    completed: boolean;
    currentStep: "welcome" | "personal" | "ai_backends" | "ai_routing" | "mcp" | "skills" | "security" | "channels" | "remote_access" | "review" | "done";
    completedAt?: number;
    skipped: {
        telegram: boolean;
        remoteAccess: boolean;
    };
}
export interface SetupDraft {
    personal: {
        profileName: string;
        displayName: string;
        language: string;
        timezone: string;
        workspace: string;
    };
    aiBackends: AIBackendCard[];
    routingProfiles: RoutingProfile[];
    mcp: {
        servers: SetupMcpServerDraft[];
    };
    skills: {
        items: SetupSkillDraftItem[];
    };
    security: {
        approvalMode: "always" | "on-miss" | "off";
        approvalTimeout: number;
        approvalTimeoutFallback: "deny" | "allow";
        maxDelegationTurns: number;
    };
    channels: {
        telegramEnabled: boolean;
        botToken: string;
        allowedUserIds: string;
        allowedGroupIds: string;
        slackEnabled: boolean;
        slackBotToken: string;
        slackAppToken: string;
        slackAllowedUserIds: string;
        slackAllowedChannelIds: string;
    };
    mqtt: {
        enabled: boolean;
        host: string;
        port: number;
        username: string;
        password: string;
    };
    remoteAccess: {
        authEnabled: boolean;
        authToken: string;
        host: string;
        port: number;
    };
}
export interface SetupChecks {
    stateDir: string;
    configFile: string;
    setupStateFile: string;
    setupCompleted: boolean;
    telegramConfigured: boolean;
    authEnabled: boolean;
    schedulerEnabled: boolean;
}
export declare function readSetupState(): SetupState;
export declare function writeSetupState(state: SetupState): SetupState;
export declare function buildSetupDraft(): SetupDraft;
export declare function saveSetupDraft(draft: SetupDraft, state?: SetupState): {
    draft: SetupDraft;
    state: SetupState;
};
export declare function resetSetupEnvironment(): {
    draft: SetupDraft;
    state: SetupState;
    checks: SetupChecks;
};
export declare function completeSetup(): SetupState;
export declare function createSetupChecks(): SetupChecks;
export declare function createTransientAuthToken(): string;
export declare function createCapabilities(): FeatureCapability[];
export declare function createCapabilityCounts(): CapabilityCounts;
export declare function getPrimaryAiTarget(): string | null;
export declare function discoverModelsFromEndpoint(endpoint: string, providerType?: AIBackendCard["providerType"], credentials?: AIBackendCard["credentials"], authMode?: AIBackendCard["authMode"]): Promise<{
    models: string[];
    sourceUrl: string;
}>;
//# sourceMappingURL=index.d.ts.map