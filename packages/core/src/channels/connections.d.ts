import type { NobieConfig } from "../config/types.js";
import { type DbChannelConnectionHealthStatus, type DbChannelConnectionMode, type DbChannelIdentityKind } from "../db/index.js";
import { type ChannelCapabilities, type ChannelProvider, type JsonValue } from "./contracts.js";
import { type ChannelPrincipalScope } from "./identity.js";
export type ChannelConnectionConfigSource = "compat" | "manual" | "import" | "system";
export type ChannelConnectionHealthStatus = DbChannelConnectionHealthStatus;
export type ChannelConnectionMode = DbChannelConnectionMode;
export type ChannelIdentityKind = DbChannelIdentityKind;
export interface ChannelSecretRef {
    key: string;
    ref: string;
    source: "config" | "env" | "secret_store";
    present: boolean;
    redacted: true;
}
export interface ChannelAllowedPrincipal {
    namespaceId: string;
    provider: ChannelProvider;
    kind: "user" | "room";
    providerIdentityId: string;
    displayNameSnapshot?: string;
}
export interface ChannelDeliveryPolicy {
    inbound: {
        requireAllowedPrincipal: boolean;
        allowUnlisted: boolean;
    };
    outbound: {
        defaultThreadPolicy: "provider_default" | "reuse_origin_thread";
        fallbackChannel: "webui" | "none";
    };
}
export interface ChannelConnectionRecord {
    connectionId: string;
    provider: ChannelProvider;
    displayName: string;
    connectionMode: ChannelConnectionMode;
    enabled: boolean;
    configured: boolean;
    health: {
        status: ChannelConnectionHealthStatus;
        message: string | null;
        checkedAt: number;
    };
    capabilityManifest: ChannelCapabilities;
    authSecretRefs: ChannelSecretRef[];
    allowedUsers: ChannelAllowedPrincipal[];
    allowedRooms: ChannelAllowedPrincipal[];
    defaultDeliveryPolicy: ChannelDeliveryPolicy;
    source: ChannelProvider;
    configSource: ChannelConnectionConfigSource;
    createdAt: number;
    updatedAt: number;
    schemaVersion: 1;
}
export interface ChannelRuntimeSnapshot {
    isRunning: boolean;
    lastStartedAt: number | null;
    lastStoppedAt: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}
export interface BuildChannelConnectionSnapshotInput {
    config: NobieConfig;
    runtime?: Partial<Record<"telegram" | "slack", ChannelRuntimeSnapshot>>;
    persist?: boolean;
    now?: number;
}
export interface ChannelConnectionSettingsPatchResult {
    appliedConnectionIds: string[];
}
export declare function namespaceChannelIdentity(provider: string, kind: ChannelIdentityKind, providerIdentityId: string | number, scope?: ChannelPrincipalScope | ChannelPrincipalScope[] | undefined): string;
export declare function parseNamespacedChannelIdentity(namespaceId: string): {
    provider: ChannelProvider;
    kind: ChannelIdentityKind;
    providerIdentityId: string;
} | null;
export declare function buildCompatChannelConnectionsFromConfig(config: NobieConfig, options?: Omit<BuildChannelConnectionSnapshotInput, "config" | "persist">): ChannelConnectionRecord[];
export declare function persistChannelConnections(connections: ChannelConnectionRecord[]): void;
export declare function buildSettingsChannelConnectionSnapshot(input: BuildChannelConnectionSnapshotInput): ChannelConnectionRecord[];
export declare function applyChannelConnectionSettingsCompatPatch(raw: Record<string, unknown>, channelsPatch: unknown): ChannelConnectionSettingsPatchResult;
export declare function channelConnectionSecretsToJson(value: ChannelConnectionRecord): JsonValue;
//# sourceMappingURL=connections.d.ts.map