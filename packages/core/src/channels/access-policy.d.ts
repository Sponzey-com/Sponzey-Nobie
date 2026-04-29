import type { ChannelAccessPolicySnapshot, ChannelProviderId, InboundEnvelope } from "./contracts.js";
export type ChannelAccessDecision = "allowed" | "blocked";
export type ChannelAccessReasonCode = "allowlist_empty" | "allowed_principal" | "allowed_user" | "allowed_room" | "allowed_user_and_room" | "unlisted_allowed" | "blocked_user" | "blocked_room" | "blocked_user_and_room" | "missing_sender" | "missing_room";
export interface ChannelAccessPolicyPrincipal {
    namespaceId: string;
    provider?: ChannelProviderId | string;
    kind?: "user" | "room" | string;
    providerIdentityId?: string | number;
    displayNameSnapshot?: string | null;
}
export interface ChannelAccessPolicy {
    allowedUsers?: Array<string | ChannelAccessPolicyPrincipal> | undefined;
    allowedRooms?: Array<string | ChannelAccessPolicyPrincipal> | undefined;
    requireAllowedPrincipal?: boolean | undefined;
    allowUnlisted?: boolean | undefined;
    emptyAllowlistAllows?: boolean | undefined;
}
export interface ChannelAccessPolicyResult {
    allowed: boolean;
    envelope: InboundEnvelope;
    policy: ChannelAccessPolicySnapshot;
    responseText?: string;
}
export declare function buildAccessPolicyFromAllowedIds(input: {
    provider: ChannelProviderId | string;
    allowedUserIds?: Array<string | number> | undefined;
    allowedRoomIds?: Array<string | number> | undefined;
    teamId?: string | number | undefined;
    workspaceId?: string | number | undefined;
    requireAllowedPrincipal?: boolean | undefined;
    allowUnlisted?: boolean | undefined;
    emptyAllowlistAllows?: boolean | undefined;
}): ChannelAccessPolicy;
export declare function evaluateInboundAccessPolicy(input: {
    envelope: InboundEnvelope;
    policy?: ChannelAccessPolicy | undefined;
    workspaceId?: string | number | undefined;
}): ChannelAccessPolicyResult;
export declare function recordChannelAccessPolicyResult(result: ChannelAccessPolicyResult): string | null;
//# sourceMappingURL=access-policy.d.ts.map