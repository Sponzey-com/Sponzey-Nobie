import type { AIConnectionConfig } from "../config/types.js";
import type { AIProvider } from "./types.js";
export type ProviderCredentialKind = "api_key" | "chatgpt_oauth" | "local_endpoint" | "custom_endpoint" | "none";
export interface ProviderResolutionSnapshot {
    source: "config.ai.connection";
    providerId: string;
    credentialKind: ProviderCredentialKind;
    authMode: "api_key" | "chatgpt_oauth";
    model: string;
    endpoint: string;
    configured: boolean;
    enabled: boolean;
    healthy: boolean;
    fallbackReason: string | null;
    diagnosticId: string;
}
export declare function resetAIProviderCache(): void;
export declare function getActiveAIConnection(config?: import("../config/types.js").NobieConfig): AIConnectionConfig;
export declare function resolveProviderResolutionSnapshot(providerId?: string, config?: import("../config/types.js").NobieConfig): ProviderResolutionSnapshot;
export declare function detectAvailableProvider(): string;
export declare function getDefaultModel(): string;
export declare function inferProviderId(_model: string): string;
export declare function getProvider(providerId?: string): AIProvider;
export declare function shouldForceReasoningMode(providerId: string, model: string): boolean;
export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js";
//# sourceMappingURL=index.d.ts.map
