export function nextApiKey(profile) {
    const now = Date.now();
    const { apiKeys, cooldowns } = profile;
    for (let i = 0; i < apiKeys.length; i++) {
        const idx = (profile.currentKeyIndex + i) % apiKeys.length;
        const key = apiKeys[idx];
        if (!key)
            continue;
        const cooldownUntil = cooldowns.get(key) ?? 0;
        if (now >= cooldownUntil) {
            profile.currentKeyIndex = idx;
            return key;
        }
    }
    return null;
}
export function markKeyFailure(profile, key, cooldownMs = 5 * 60 * 1000) {
    profile.cooldowns.set(key, Date.now() + cooldownMs);
}
//# sourceMappingURL=types.js.map