import { recordMessageLedgerEvent } from "../runs/message-ledger.js";
import { buildIdentityNamespaceCandidates, buildRoomNamespaceCandidates, namespaceChannelRoom, namespaceChannelUser, } from "./identity.js";
export function buildAccessPolicyFromAllowedIds(input) {
    const scope = input.provider === "slack"
        ? { teamId: input.teamId ?? input.workspaceId }
        : { workspaceId: input.workspaceId };
    return {
        allowedUsers: (input.allowedUserIds ?? []).map((userId) => namespaceChannelUser({ provider: input.provider, userId, ...scope })),
        allowedRooms: (input.allowedRoomIds ?? []).map((roomId) => namespaceChannelRoom({ provider: input.provider, roomId, ...scope })),
        requireAllowedPrincipal: input.requireAllowedPrincipal,
        allowUnlisted: input.allowUnlisted,
        emptyAllowlistAllows: input.emptyAllowlistAllows,
    };
}
export function evaluateInboundAccessPolicy(input) {
    const policy = input.policy ?? {};
    const requireAllowedPrincipal = policy.requireAllowedPrincipal !== false;
    const allowUnlisted = policy.allowUnlisted === true;
    const emptyAllowlistAllows = policy.emptyAllowlistAllows !== false;
    const workspaceId = input.workspaceId ?? input.envelope.workspace?.id;
    const userCandidates = input.envelope.sender.id
        ? buildIdentityNamespaceCandidates({
            provider: input.envelope.provider,
            identity: input.envelope.sender,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
        })
        : [];
    const roomCandidates = input.envelope.room?.id
        ? buildRoomNamespaceCandidates({
            provider: input.envelope.provider,
            room: input.envelope.room,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
        })
        : [];
    const allowedUsers = normalizeAllowedPrincipals(policy.allowedUsers);
    const allowedRooms = normalizeAllowedPrincipals(policy.allowedRooms);
    const userListConfigured = allowedUsers.size > 0;
    const roomListConfigured = allowedRooms.size > 0;
    const matchedUsers = userCandidates.filter((candidate) => allowedUsers.has(candidate));
    const matchedRooms = roomCandidates.filter((candidate) => allowedRooms.has(candidate));
    const userAllowed = !userListConfigured || matchedUsers.length > 0;
    const roomAllowed = !roomListConfigured || matchedRooms.length > 0;
    const hasAnyAllowlist = userListConfigured || roomListConfigured;
    let decision = "allowed";
    let reasonCode = "allowlist_empty";
    if (!input.envelope.sender.id) {
        decision = "blocked";
        reasonCode = "missing_sender";
    }
    else if (allowUnlisted && !hasAnyAllowlist) {
        decision = "allowed";
        reasonCode = "unlisted_allowed";
    }
    else if (!requireAllowedPrincipal && !hasAnyAllowlist) {
        decision = "allowed";
        reasonCode = "unlisted_allowed";
    }
    else if (!hasAnyAllowlist) {
        decision = emptyAllowlistAllows ? "allowed" : "blocked";
        reasonCode = emptyAllowlistAllows ? "allowlist_empty" : "blocked_user";
    }
    else if (userAllowed && roomAllowed) {
        decision = "allowed";
        reasonCode = userListConfigured && roomListConfigured
            ? "allowed_user_and_room"
            : userListConfigured
                ? "allowed_user"
                : roomListConfigured
                    ? "allowed_room"
                    : "allowed_principal";
    }
    else {
        decision = "blocked";
        reasonCode = !userAllowed && !roomAllowed
            ? "blocked_user_and_room"
            : !userAllowed
                ? "blocked_user"
                : "blocked_room";
    }
    const matchedPrincipals = [...matchedUsers, ...matchedRooms];
    const summary = summarizePolicyDecision({
        provider: input.envelope.provider,
        sender: input.envelope.sender,
        room: input.envelope.room,
        decision,
        reasonCode,
    });
    const snapshot = {
        decision,
        reasonCode,
        principalKeys: {
            user: userCandidates,
            room: roomCandidates,
        },
        matchedPrincipals,
        requireAllowedPrincipal,
        allowUnlisted,
        summary,
    };
    const envelope = {
        ...input.envelope,
        accessPolicy: snapshot,
    };
    return {
        allowed: decision === "allowed",
        envelope,
        policy: snapshot,
        ...(decision === "blocked" ? { responseText: buildPolicyFailureText(snapshot) } : {}),
    };
}
export function recordChannelAccessPolicyResult(result) {
    return recordMessageLedgerEvent({
        sessionKey: result.envelope.dedupeKey,
        threadKey: result.envelope.threadId ?? result.envelope.room?.id ?? result.envelope.dedupeKey,
        channel: result.envelope.provider,
        eventKind: "channel_policy_evaluated",
        status: result.allowed ? "succeeded" : "failed",
        summary: result.policy.summary,
        detail: {
            messageId: result.envelope.messageId,
            threadId: result.envelope.threadId ?? null,
            replyToMessageId: result.envelope.replyToMessageId ?? null,
            roomId: result.envelope.room?.id ?? null,
            senderId: result.envelope.sender.id,
            policy: result.policy,
        },
    });
}
function normalizeAllowedPrincipals(values) {
    const normalized = new Set();
    for (const value of values ?? []) {
        const namespaceId = typeof value === "string" ? value : value.namespaceId;
        const trimmed = namespaceId.trim();
        if (trimmed)
            normalized.add(trimmed);
    }
    return normalized;
}
function summarizePolicyDecision(input) {
    const target = input.room?.id ? ` room=${input.room.id}` : "";
    return `Channel policy ${input.decision}: ${input.provider} user=${input.sender.id}${target} reason=${input.reasonCode}`;
}
function buildPolicyFailureText(snapshot) {
    if (snapshot.reasonCode === "blocked_room") {
        return "This room is not allowed to use Nobie. Ask an administrator to add it to the channel allowlist.";
    }
    if (snapshot.reasonCode === "blocked_user") {
        return "Your account is not allowed to use Nobie in this channel. Ask an administrator to add you to the channel allowlist.";
    }
    return "This channel request is blocked by Nobie's access policy. Ask an administrator to update the channel allowlist.";
}
//# sourceMappingURL=access-policy.js.map