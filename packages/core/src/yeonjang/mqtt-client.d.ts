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
}
export interface YeonjangCapabilitiesPayload {
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
export declare function isYeonjangUnavailableError(error: unknown): boolean;
//# sourceMappingURL=mqtt-client.d.ts.map