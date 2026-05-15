import { getConfig } from "../config/index.js";
import { createLogger } from "../logger/index.js";
import { getFeatureFlag } from "../runtime/rollout-safety.js";
import { buildCompatChannelConnectionsFromConfig, persistChannelConnections } from "./connections.js";
import { ChannelRegistry } from "./registry.js";
import { CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY, resolveChannelRegistryRuntimeMode } from "./runtime.js";
import { SlackChannel } from "./slack/bot.js";
import { getActiveSlackChannel, setActiveSlackChannel, setSlackRuntimeError, stopActiveSlackChannel } from "./slack/runtime.js";
import { TelegramChannel } from "./telegram/bot.js";
import { getActiveTelegramChannel, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "./telegram/runtime.js";
import { DiscordChannelAdapter } from "./discord/adapter.js";
import { setDiscordRuntimeError, stopDiscordRuntime } from "./discord/runtime.js";
import { GoogleChatChannelAdapter } from "./google-chat/adapter.js";
import { setGoogleChatRuntimeError, stopGoogleChatRuntime } from "./google-chat/runtime.js";
export { TelegramChannel } from "./telegram/bot.js";
export { TelegramChannelAdapter, buildTelegramCapabilityManifest, buildTelegramContinuationLookupCandidate, createTelegramChannelAdapter, normalizeTelegramInboundUpdate, normalizeTelegramInteractionUpdate, resolveTelegramConnectionPolicy, validateTelegramWebhookSecretToken, } from "./telegram/adapter.js";
export { SlackChannel } from "./slack/bot.js";
export { SlackChannelAdapter, buildSlackCapabilityManifest, buildSlackContinuationLookupCandidate, createSlackChannelAdapter, normalizeSlackInboundEvent, normalizeSlackInteractionPayload, resolveSlackConnectionPolicy, } from "./slack/adapter.js";
export { DiscordChannelAdapter, buildDiscordCapabilityManifest, buildDiscordContinuationLookupCandidate, buildDiscordPermissionDoctor, createDiscordChannelAdapter, normalizeDiscordComponentInteraction, normalizeDiscordInboundEvent, normalizeDiscordInteractionRequest, resolveDiscordConnectionPolicy, validateDiscordInteractionSignature, } from "./discord/adapter.js";
export { GoogleChatChannelAdapter, buildGoogleChatCapabilityManifest, buildGoogleChatContinuationLookupCandidate, buildGoogleChatWorkspaceDoctor, createGoogleChatChannelAdapter, normalizeGoogleChatCardAction, normalizeGoogleChatInboundEvent, resolveGoogleChatConnectionPolicy, validateGoogleChatRequestAuth, } from "./google-chat/adapter.js";
export { LocalBridgeChannelAdapter, buildLocalBridgeCapabilityManifest, buildLocalBridgeDoctor, createLocalBridgeChannelAdapter, } from "./local-bridge/adapter.js";
export { buildIMessageCapabilityManifest, buildIMessageLocalBridgeConfig, buildIMessageLocalBridgeDoctor, createIMessageChannelAdapter, } from "./imessage/adapter.js";
export { buildKakaoTalkLocalBridgeCapabilityManifest, buildKakaoTalkLocalBridgeConfig, buildKakaoTalkLocalBridgeDoctor, buildKakaoTalkOfficialCapabilityManifest, buildKakaoTalkOfficialDoctor, createKakaoTalkLocalBridgeChannelAdapter, } from "./kakaotalk/adapter.js";
export { ChannelRegistry, buildChannelRegistryRuntimeDiagnostics, createBuiltInChannelProviderFactories } from "./registry.js";
export { CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY, buildChannelRuntimeSummary, recordChannelRuntimeEvent, resolveChannelRegistryRuntimeMode, updateConnectionRuntimeHealth, } from "./runtime.js";
export { buildAccessPolicyFromAllowedIds, evaluateInboundAccessPolicy, recordChannelAccessPolicyResult, } from "./access-policy.js";
export { buildContinuationConfirmationPrompt, resolveChannelContinuation, } from "./continuation.js";
export { buildIdentityNamespaceCandidates, buildRoomNamespaceCandidates, namespaceChannelPrincipal, namespaceChannelRoom, namespaceChannelThread, namespaceChannelUser, namespaceChannelWorkspace, parseNamespacedChannelPrincipal, } from "./identity.js";
export { applyChannelConnectionSettingsCompatPatch, buildCompatChannelConnectionsFromConfig, buildSettingsChannelConnectionSnapshot, channelConnectionSecretsToJson, namespaceChannelIdentity, parseNamespacedChannelIdentity, persistChannelConnections, } from "./connections.js";
export { buildCapabilityFallbackNotice, describeUnsupportedCapability, resolveChannelDeliveryFallbackPlan, splitTextForChannel, } from "./delivery-fallback.js";
export { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, isBuiltInChannelProvider, isExternalChannelProvider, isInternalChannelSurface, isPositiveDeliveryReceipt, normalizeChannelSource, resolveDeliveryReceiptStatus, resolveChannelSurface, sanitizeChannelContractValue, } from "./contracts.js";
export { getDefaultChannelSmokeScenarios, createDryRunChannelSmokeExecutor, resolveChannelSmokeReadiness, runPersistedChannelSmokeScenarios, runChannelSmokeScenarios, sanitizeChannelSmokeTrace, sanitizeChannelSmokeValue, validateChannelSmokeTrace, } from "./smoke-runner.js";
const log = createLogger("channels");
export async function startChannels() {
    const config = getConfig();
    try {
        persistChannelConnections(buildCompatChannelConnectionsFromConfig(config));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to sync channel connection compatibility rows: ${message}`);
    }
    stopActiveSlackChannel();
    stopActiveTelegramChannel();
    stopDiscordRuntime();
    stopGoogleChatRuntime();
    setSlackRuntimeError(null);
    setTelegramRuntimeError(null);
    setDiscordRuntimeError(null);
    setGoogleChatRuntimeError(null);
    const runtimeFlag = getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY);
    if (resolveChannelRegistryRuntimeMode(runtimeFlag) === "registry") {
        const registry = new ChannelRegistry({ config });
        await registry.startEnabled();
        return;
    }
    if (config.slack?.enabled) {
        const channel = new SlackChannel(config.slack);
        try {
            await channel.start();
            setActiveSlackChannel(channel);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (getActiveSlackChannel() === channel)
                setActiveSlackChannel(null);
            setSlackRuntimeError(message);
            log.warn(`Failed to start Slack channel: ${message}`);
        }
    }
    if (config.telegram?.enabled) {
        const channel = new TelegramChannel(config.telegram);
        try {
            await channel.start();
            setActiveTelegramChannel(channel);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (getActiveTelegramChannel() === channel)
                setActiveTelegramChannel(null);
            setTelegramRuntimeError(message);
            log.warn(`Failed to start Telegram channel: ${message}`);
        }
    }
    if (config.discord?.enabled) {
        const adapter = new DiscordChannelAdapter({ config: config.discord });
        try {
            await adapter.start();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setDiscordRuntimeError(message);
            log.warn(`Failed to start Discord channel: ${message}`);
        }
    }
    if (config.googleChat?.enabled) {
        const adapter = new GoogleChatChannelAdapter({ config: config.googleChat });
        try {
            await adapter.start();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setGoogleChatRuntimeError(message);
            log.warn(`Failed to start Google Chat channel: ${message}`);
        }
    }
}
//# sourceMappingURL=index.js.map