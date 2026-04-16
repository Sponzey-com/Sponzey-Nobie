import type { MqttConfig } from "../config/types.js";
export interface MqttBrokerSnapshot {
    enabled: boolean;
    running: boolean;
    host: string;
    port: number;
    url: string;
    clientCount: number;
    authEnabled: boolean;
    allowAnonymous: boolean;
    reason: string | null;
}
type ExtensionTopicKind = "status" | "capabilities" | "request" | "response" | "event";
export interface MqttExtensionSnapshot {
    extensionId: string;
    clientId: string | null;
    displayName: string | null;
    state: string | null;
    message: string | null;
    version: string | null;
    protocolVersion?: string | null;
    gitTag?: string | null;
    gitCommit?: string | null;
    buildTarget?: string | null;
    platform?: string | null;
    os?: string | null;
    arch?: string | null;
    transport?: string[];
    capabilityHash?: string | null;
    methods: string[];
    permissions?: Record<string, unknown>;
    toolHealth?: Record<string, unknown>;
    capabilityMatrix?: Record<string, unknown>;
    lastCapabilityRefreshAt?: number | null;
    lastSeenAt: number;
}
export interface MqttExchangeLogEntry {
    id: string;
    timestamp: number;
    direction: "nobie_to_extension" | "extension_to_nobie";
    topic: string;
    extensionId: string | null;
    kind: ExtensionTopicKind | "unknown";
    clientId: string | null;
    payload: unknown;
}
export declare function validateMqttBrokerConfig(config: MqttConfig): string | null;
export declare function startMqttBroker(): Promise<void>;
export declare function stopMqttBroker(): Promise<void>;
export declare function getMqttBrokerSnapshot(): MqttBrokerSnapshot;
export declare function getMqttExtensionSnapshots(): MqttExtensionSnapshot[];
export declare function getMqttExchangeLogs(): MqttExchangeLogEntry[];
export declare function disconnectMqttExtension(extensionId: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function restartMqttBrokerFromConfig(): Promise<void>;
export {};
//# sourceMappingURL=broker.d.ts.map