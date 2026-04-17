import type { AIConnectionConfig } from "../config/types.js";
import type { AIProvider } from "./types.js";
export type ProviderCredentialKind = "api_key" | "chatgpt_oauth" | "local_endpoint" | "custom_endpoint" | "none";
export type ProviderAdapterType = "openai_chat" | "openai_codex_oauth" | "openai_compatible" | "anthropic" | "gemini" | "none";
export type ProviderBaseUrlClass = "official_openai" | "chatgpt_codex" | "local" | "custom" | "provider_native" | "none";
export interface ProviderAuditTrace {
    source: "config.ai.connection";
    profileId?: string | undefined;
    requestedProviderId: string;
    providerId: string;
    adapterType: ProviderAdapterType;
    baseUrlClass: ProviderBaseUrlClass;
    modelId: string;
    authType: ProviderCredentialKind;
    credentialSourceKind?: ProviderCredentialKind | undefined;
    resolverPath?: string | undefined;
    endpointMismatch?: boolean | undefined;
    configured: boolean;
    healthy: boolean;
    fallbackReason: string | null;
    diagnosticId: string;
}
export interface ProviderResolutionSnapshot {
    source: "config.ai.connection";
    providerId: string;
    credentialKind: ProviderCredentialKind;
    adapterType: ProviderAdapterType;
    authType: ProviderCredentialKind;
    baseUrlClass: ProviderBaseUrlClass;
    authMode: "api_key" | "chatgpt_oauth";
    model: string;
    endpoint: string;
    configured: boolean;
    enabled: boolean;
    healthy: boolean;
    fallbackReason: string | null;
    diagnosticId: string;
    auditTrace: ProviderAuditTrace;
}
export interface ResolvedAiConnection extends ProviderResolutionSnapshot {
    requestedProviderId: string;
    connection: AIConnectionConfig;
}
export interface ResolvedAiProvider {
    providerId: string;
    model: string;
    provider: AIProvider;
    resolution: ResolvedAiConnection;
}
export declare function normalizeOpenAICompatibleEndpoint(providerId: "openai" | "ollama" | "llama" | "custom", endpoint: string | undefined): string | undefined;
export declare function resetAIProviderCache(): void;
export declare function getActiveAIConnection(config?: import("../config/types.js").NobieConfig): AIConnectionConfig;
export declare function resolveAIConnection(connection: AIConnectionConfig, providerId?: string): ResolvedAiConnection;
export declare function resolveProviderResolutionSnapshot(providerId?: string, config?: import("../config/types.js").NobieConfig): ProviderResolutionSnapshot;
export declare function detectAvailableProvider(): string;
export declare function getDefaultModel(): string;
export declare function inferProviderId(_model: string): string;
export declare function createProviderForConnection(connection: AIConnectionConfig): AIProvider;
export declare function resolveProviderForConnection(connection: AIConnectionConfig, providerId?: string): ResolvedAiProvider | null;
export declare function getProvider(providerId?: string): AIProvider;
export declare function shouldForceReasoningMode(providerId: string, model: string): boolean;
export declare function formatProviderAuditTrace(trace: ProviderAuditTrace): string;
export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js";
//# sourceMappingURL=index.d.ts.map