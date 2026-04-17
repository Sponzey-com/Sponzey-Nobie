import type { AIConnectionConfig, MemoryConfig } from "../config/types.js";
import { type ProviderAdapterType, type ProviderAuditTrace, type ProviderBaseUrlClass, type ProviderCredentialKind } from "./index.js";
export type ProviderCapabilityStatus = "supported" | "unsupported" | "warning" | "unknown";
export interface ProviderCapabilityItem {
    status: ProviderCapabilityStatus;
    detail: string;
}
export interface ProviderCapabilityMatrix {
    profileId: string;
    providerId: string;
    adapterType: ProviderAdapterType;
    authType: ProviderCredentialKind;
    baseUrlClass: ProviderBaseUrlClass;
    endpoint: string;
    modelId: string;
    chatCompletions: ProviderCapabilityItem;
    responsesApi: ProviderCapabilityItem;
    streaming: ProviderCapabilityItem;
    toolCalling: ProviderCapabilityItem;
    jsonSchemaOutput: ProviderCapabilityItem;
    embeddings: ProviderCapabilityItem;
    modelListing: ProviderCapabilityItem;
    imageInput: ProviderCapabilityItem;
    imageOutput: ProviderCapabilityItem;
    contextWindow: ProviderCapabilityItem & {
        tokens: number | null;
    };
    authRefresh: ProviderCapabilityItem;
    endpointMismatch: ProviderCapabilityItem;
    createdAt: string;
    expiresAt: string;
    lastCheckResult: {
        status: "ok" | "warning" | "failed" | "not_checked";
        checkedAt: string | null;
        message: string;
        sourceUrl: string | null;
    };
}
export interface EmbeddingProviderResolutionSnapshot {
    providerId: string;
    modelId: string;
    configured: boolean;
    credentialKind: "api_key" | "local_endpoint" | "none";
    baseUrlClass: ProviderBaseUrlClass;
    degradedReason: string | null;
}
export declare function buildProviderProfileId(input: {
    connection: AIConnectionConfig;
    embedding?: MemoryConfig["embedding"] | undefined;
}): string;
export declare function resolveEmbeddingProviderResolutionSnapshot(memory: MemoryConfig): EmbeddingProviderResolutionSnapshot;
export declare function getProviderCapabilityMatrix(params: {
    connection: AIConnectionConfig;
    memory?: MemoryConfig | undefined;
    now?: Date | undefined;
    forceRefresh?: boolean | undefined;
    checkResult?: ProviderCapabilityMatrix["lastCheckResult"] | undefined;
}): ProviderCapabilityMatrix;
export declare function clearProviderCapabilityCache(): void;
export declare function attachCapabilityProfileToTrace(trace: ProviderAuditTrace, matrix: ProviderCapabilityMatrix): ProviderAuditTrace;
//# sourceMappingURL=capabilities.d.ts.map