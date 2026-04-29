function normalizeProvider(provider) {
    return provider.trim().toLowerCase().replace(/^provider:/, "").replace(/[-\s]+/g, "_");
}
function normalizeIdentityPart(value, label) {
    const normalized = String(value).trim();
    if (!normalized)
        throw new Error(`channel ${label} is required`);
    return normalized;
}
function normalizeScopes(scope) {
    if (!scope)
        return [];
    return Array.isArray(scope) ? scope : [scope];
}
export function namespaceChannelPrincipal(input) {
    const provider = normalizeProvider(input.provider);
    const id = normalizeIdentityPart(input.providerIdentityId, "identity id");
    if (!provider)
        throw new Error("channel identity provider is required");
    const scopeParts = normalizeScopes(input.scope).flatMap((scope) => [
        normalizeIdentityPart(scope.kind, "scope kind"),
        normalizeIdentityPart(scope.id, "scope id"),
    ]);
    return [provider, ...scopeParts, input.kind, id].join(":");
}
export function namespaceChannelUser(input) {
    return namespaceChannelPrincipal({
        provider: input.provider,
        kind: "user",
        providerIdentityId: input.userId,
        scope: resolveProviderScope(input),
    });
}
export function namespaceChannelRoom(input) {
    return namespaceChannelPrincipal({
        provider: input.provider,
        kind: "room",
        providerIdentityId: input.roomId,
        scope: resolveProviderScope(input),
    });
}
export function namespaceChannelThread(input) {
    return namespaceChannelPrincipal({
        provider: input.provider,
        kind: "thread",
        providerIdentityId: input.threadId,
        scope: resolveProviderScope(input),
    });
}
export function namespaceChannelWorkspace(provider, workspaceId) {
    return namespaceChannelPrincipal({
        provider,
        kind: "workspace",
        providerIdentityId: workspaceId,
    });
}
export function parseNamespacedChannelPrincipal(namespaceId) {
    const parts = namespaceId.split(":").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3)
        return null;
    const provider = normalizeProvider(parts[0]);
    const providerIdentityId = parts.at(-1);
    const kind = parts.at(-2);
    if (!provider || !providerIdentityId || !kind || !isChannelPrincipalKind(kind))
        return null;
    const scopeParts = parts.slice(1, -2);
    if (scopeParts.length % 2 !== 0)
        return null;
    const scopes = [];
    for (let index = 0; index < scopeParts.length; index += 2) {
        const scopeKind = scopeParts[index];
        const scopeId = scopeParts[index + 1];
        if (!scopeKind || !scopeId || !isChannelPrincipalScopeKind(scopeKind))
            return null;
        scopes.push({ kind: scopeKind, id: scopeId });
    }
    return {
        provider,
        kind,
        providerIdentityId,
        scopes,
    };
}
export function buildIdentityNamespaceCandidates(input) {
    const candidates = new Set();
    if (input.workspaceId !== undefined) {
        candidates.add(namespaceChannelUser({
            provider: input.provider,
            userId: input.identity.id,
            teamId: input.provider === "slack" ? input.workspaceId : undefined,
            workspaceId: input.provider === "slack" ? undefined : input.workspaceId,
        }));
    }
    candidates.add(namespaceChannelUser({ provider: input.provider, userId: input.identity.id }));
    return [...candidates];
}
export function buildRoomNamespaceCandidates(input) {
    const candidates = new Set();
    if (input.workspaceId !== undefined) {
        candidates.add(namespaceChannelRoom({
            provider: input.provider,
            roomId: input.room.id,
            teamId: input.provider === "slack" ? input.workspaceId : undefined,
            workspaceId: input.provider === "slack" ? undefined : input.workspaceId,
        }));
    }
    candidates.add(namespaceChannelRoom({ provider: input.provider, roomId: input.room.id }));
    return [...candidates];
}
function resolveProviderScope(input) {
    if (input.teamId !== undefined)
        return { kind: "team", id: input.teamId };
    if (input.workspaceId !== undefined)
        return { kind: "workspace", id: input.workspaceId };
    return undefined;
}
function isChannelPrincipalKind(value) {
    return value === "user"
        || value === "room"
        || value === "thread"
        || value === "bot"
        || value === "workspace"
        || value === "unknown";
}
function isChannelPrincipalScopeKind(value) {
    return value === "team"
        || value === "workspace"
        || value === "tenant"
        || value === "organization";
}
//# sourceMappingURL=identity.js.map