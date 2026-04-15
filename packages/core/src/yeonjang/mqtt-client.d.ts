export interface YeonjangRequestEnvelope {
    id: string;
    method: string;
    params: Record<string, unknown>;
}
export interface YeonjangErrorBody {
    code: string;
    message: string;
}
export interface YeonjangResponseEnvelope<T = unknown> {
    id?: string;
    ok: boolean;
    result?: T;
    error?: YeonjangErrorBody;
}
export interface YeonjangClientOptions {
    extensionId?: string;
    timeoutMs?: number;
}
export interface YeonjangMethodCapability {
    name: string;
    implemented: boolean;
    supported?: boolean;
    requiresApproval?: boolean;
    requiresPermission?: boolean;
    permissionSetting?: string | null;
    knownLimitations?: string[];
    outputModes?: string[];
    lastCheckedAt?: number;
}
export interface YeonjangCapabilityMatrixEntry {
    supported?: boolean;
    requiresApproval?: boolean;
    requiresPermission?: boolean;
    permissionSetting?: string | null;
    knownLimitations?: string[];
    outputModes?: string[];
    lastCheckedAt?: number;
}
export interface YeonjangCapabilitiesPayload {
    node?: string;
    version?: string;
    gitTag?: string;
    git_tag?: string;
    gitCommit?: string;
    git_commit?: string;
    buildTarget?: string;
    build_target?: string;
    os?: string;
    arch?: string;
    platform?: string;
    transport?: string | string[];
    capabilityHash?: string;
    capability_hash?: string;
    capabilityMatrix?: Record<string, YeonjangCapabilityMatrixEntry>;
    capability_matrix?: Record<string, YeonjangCapabilityMatrixEntry>;
    methods?: YeonjangMethodCapability[];
}
export declare const DEFAULT_YEONJANG_EXTENSION_ID = "yeonjang-main";
export declare function buildYeonjangTopics(extensionId?: string): {
    statusTopic: string;
    capabilitiesTopic: string;
    requestTopic: string;
    responseTopic: string;
    eventTopic: string;
};
export declare function invokeYeonjangMethod<T = unknown>(method: string, params?: Record<string, unknown>, options?: YeonjangClientOptions): Promise<T>;
export declare function getYeonjangCapabilities(options?: YeonjangClientOptions): Promise<YeonjangCapabilitiesPayload>;
export declare function canYeonjangHandleMethod(method: string, options?: YeonjangClientOptions): Promise<boolean>;
export declare function resolveYeonjangMethodCapability(capabilities: YeonjangCapabilitiesPayload, method: string): YeonjangCapabilityMatrixEntry | YeonjangMethodCapability | null;
export declare function doesYeonjangCapabilitySupportMethod(capabilities: YeonjangCapabilitiesPayload, method: string): boolean;
export declare function hasYeonjangCapabilityMatrix(capabilities: YeonjangCapabilitiesPayload): boolean;
export declare function resolveYeonjangCapabilityOutputModes(capabilities: YeonjangCapabilitiesPayload, method: string): string[] | null;
export declare function doesYeonjangCapabilitySupportOutputMode(capabilities: YeonjangCapabilitiesPayload, method: string, outputMode: string): boolean | null;
export declare function isYeonjangUnavailableError(error: unknown): boolean;
//# sourceMappingURL=mqtt-client.d.ts.map
