import type { ChannelIdentity, ChannelProvider, ChannelProviderId, ChannelRoom } from "./contracts.js";
export type ChannelPrincipalKind = "user" | "room" | "thread" | "bot" | "workspace" | "unknown";
export type ChannelPrincipalScopeKind = "team" | "workspace" | "tenant" | "organization";
export interface ChannelPrincipalScope {
    kind: ChannelPrincipalScopeKind;
    id: string | number;
}
export interface NamespacedChannelPrincipalInput {
    provider: string;
    kind: ChannelPrincipalKind;
    providerIdentityId: string | number;
    scope?: ChannelPrincipalScope | ChannelPrincipalScope[] | undefined;
}
export interface ParsedNamespacedChannelPrincipal {
    provider: ChannelProvider;
    kind: ChannelPrincipalKind;
    providerIdentityId: string;
    scopes: ChannelPrincipalScope[];
}
export declare function namespaceChannelPrincipal(input: NamespacedChannelPrincipalInput): string;
export declare function namespaceChannelUser(input: {
    provider: string;
    userId: string | number;
    teamId?: string | number | undefined;
    workspaceId?: string | number | undefined;
}): string;
export declare function namespaceChannelRoom(input: {
    provider: string;
    roomId: string | number;
    teamId?: string | number | undefined;
    workspaceId?: string | number | undefined;
}): string;
export declare function namespaceChannelThread(input: {
    provider: string;
    threadId: string | number;
    teamId?: string | number | undefined;
    workspaceId?: string | number | undefined;
}): string;
export declare function namespaceChannelWorkspace(provider: string, workspaceId: string | number): string;
export declare function parseNamespacedChannelPrincipal(namespaceId: string): ParsedNamespacedChannelPrincipal | null;
export declare function buildIdentityNamespaceCandidates(input: {
    provider: ChannelProviderId;
    identity: ChannelIdentity;
    workspaceId?: string | number | undefined;
}): string[];
export declare function buildRoomNamespaceCandidates(input: {
    provider: ChannelProviderId;
    room: ChannelRoom;
    workspaceId?: string | number | undefined;
}): string[];
//# sourceMappingURL=identity.d.ts.map