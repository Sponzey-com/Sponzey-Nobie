import type { NobieConfig as NobieAgentConfig, SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration.js";
export type AIConnectionProvider = "openai" | "anthropic" | "gemini" | "ollama" | "llama" | "custom" | "";
export interface AIConnectionConfig {
    provider: AIConnectionProvider;
    model: string;
    endpoint?: string;
    auth?: {
        mode?: "api_key" | "chatgpt_oauth";
        apiKey?: string;
        username?: string;
        password?: string;
        oauthAuthFilePath?: string;
        clientId?: string;
    };
}
export interface ProfileConfig {
    profileName: string;
    displayName: string;
    language: string;
    timezone: string;
    workspace: string;
}
export interface SecurityConfig {
    allowedPaths: string[];
    approvalMode: "always" | "on-miss" | "off";
    approvalTimeout: number;
    approvalTimeoutFallback: "allow" | "deny";
    allowedCommands: string[];
}
export interface TelegramConfig {
    enabled: boolean;
    botToken: string;
    allowedUserIds: number[];
    allowedGroupIds: number[];
}
export interface SlackConfig {
    enabled: boolean;
    botToken: string;
    appToken: string;
    allowedUserIds: string[];
    allowedChannelIds: string[];
}
export interface DiscordConfig {
    enabled: boolean;
    botToken: string;
    applicationId: string;
    publicKey: string;
    allowedUserIds: string[];
    allowedGuildIds: string[];
    allowedChannelIds: string[];
    grantedIntents?: string[];
    botPermissions?: string[];
    installedGuildIds?: string[];
    largeGuildMode?: boolean;
}
export interface GoogleChatConfig {
    enabled: boolean;
    projectId: string;
    appCredentialJson: string;
    serviceAccountEmail: string;
    webhookUrl: string;
    verificationToken: string;
    allowedUserIds: string[];
    allowedSpaceIds: string[];
    deployedSpaceIds?: string[];
    grantedScopes?: string[];
    appPublished?: boolean;
    domainWideDelegation?: boolean;
}
export interface IMessageConfig {
    enabled: boolean;
    mode: "outgoing_only" | "manual_confirm";
    localBridgeEnabled: boolean;
    yeonjangBridgeEnabled: boolean;
    riskAcknowledged: boolean;
    messagesAppAvailable?: boolean;
    userSessionActive?: boolean;
    automationPermissionGranted?: boolean;
    allowedRecipientIds: string[];
    manualConfirmationRequired: boolean;
}
export interface KakaoTalkConfig {
    enabled: boolean;
    mode: "official" | "local_bridge";
    businessApiEnabled: boolean;
    businessApiKey: string;
    channelId: string;
    localBridgeEnabled: boolean;
    yeonjangBridgeEnabled: boolean;
    riskAcknowledged: boolean;
    kakaoTalkAppAvailable?: boolean;
    userSessionActive?: boolean;
    automationPermissionGranted?: boolean;
    allowedUserIds: string[];
    allowedRoomIds: string[];
    manualConfirmationRequired: boolean;
    rateLimitPerMinute: number;
}
export interface WebuiConfig {
    enabled: boolean;
    port: number;
    host: string;
    preferredUiMode?: "beginner" | "advanced";
    admin: {
        enabled: boolean;
    };
    auth: {
        enabled: boolean;
        token?: string;
    };
}
export interface SchedulerConfig {
    enabled: boolean;
    timezone: string;
}
export interface MqttConfig {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
    allowAnonymous: boolean;
}
export interface SearchConfig {
    web?: {
        provider: "brave" | "tavily" | "duckduckgo";
        apiKey?: string;
        maxResults: number;
    };
    files?: {
        indexedPaths: string[];
        excludePatterns: string[];
    };
}
export interface MemoryConfig {
    embedding?: {
        provider: "openai" | "ollama" | "voyage";
        model: string;
        apiKey?: string;
        baseUrl?: string;
    };
    compaction?: {
        modelId?: string;
        fallbackModelId?: string;
        minContextTokens?: number;
    };
    searchMode?: "fts" | "vector" | "hybrid";
    sessionRetentionDays: number;
    indexedPaths?: string[];
    excludePatterns?: string[];
}
export interface OrchestrationConfig {
    maxDelegationTurns: number;
    mode?: "single_nobie" | "orchestration";
    featureFlagEnabled?: boolean;
    nobie?: NobieAgentConfig;
    subAgents?: SubAgentConfig[];
    teams?: TeamConfig[];
}
export interface McpServerConfig {
    enabled?: boolean;
    transport?: "stdio" | "http";
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    required?: boolean;
    startupTimeoutSec?: number;
    toolTimeoutSec?: number;
    enabledTools?: string[];
    disabledTools?: string[];
}
export interface McpConfig {
    servers?: Record<string, McpServerConfig>;
}
export interface SkillConfigItem {
    id: string;
    label: string;
    description: string;
    source: "local" | "builtin";
    path?: string;
    enabled: boolean;
    required?: boolean;
}
export interface SkillsConfig {
    items: SkillConfigItem[];
}
export interface NobieConfig {
    profile: ProfileConfig;
    ai: {
        connection: AIConnectionConfig;
    };
    security: SecurityConfig;
    telegram?: TelegramConfig;
    slack?: SlackConfig;
    discord?: DiscordConfig;
    googleChat?: GoogleChatConfig;
    imessage?: IMessageConfig;
    kakaoTalk?: KakaoTalkConfig;
    webui: WebuiConfig;
    scheduler: SchedulerConfig;
    mqtt: MqttConfig;
    search: SearchConfig;
    memory: MemoryConfig;
    orchestration: OrchestrationConfig;
    mcp?: McpConfig;
    skills?: SkillsConfig;
}
export type WizbyConfig = NobieConfig;
export type HowieConfig = NobieConfig;
export declare const DEFAULT_CONFIG: NobieConfig;
//# sourceMappingURL=types.d.ts.map