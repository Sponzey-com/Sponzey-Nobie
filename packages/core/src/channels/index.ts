import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { getFeatureFlag } from "../runtime/rollout-safety.js"
import { buildCompatChannelConnectionsFromConfig, persistChannelConnections } from "./connections.js"
import { ChannelRegistry, buildChannelRegistryRuntimeDiagnostics, createBuiltInChannelProviderFactories } from "./registry.js"
import { CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY, resolveChannelRegistryRuntimeMode } from "./runtime.js"
import { SlackChannel } from "./slack/bot.js"
import { getActiveSlackChannel, setActiveSlackChannel, setSlackRuntimeError, stopActiveSlackChannel } from "./slack/runtime.js"
import { TelegramChannel } from "./telegram/bot.js"
import { getActiveTelegramChannel, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "./telegram/runtime.js"
import { DiscordChannelAdapter } from "./discord/adapter.js"
import { setDiscordRuntimeError, stopDiscordRuntime } from "./discord/runtime.js"
import { GoogleChatChannelAdapter } from "./google-chat/adapter.js"
import { setGoogleChatRuntimeError, stopGoogleChatRuntime } from "./google-chat/runtime.js"

export { TelegramChannel } from "./telegram/bot.js"
export {
  TelegramChannelAdapter,
  buildTelegramCapabilityManifest,
  buildTelegramContinuationLookupCandidate,
  createTelegramChannelAdapter,
  normalizeTelegramInboundUpdate,
  normalizeTelegramInteractionUpdate,
  resolveTelegramConnectionPolicy,
  validateTelegramWebhookSecretToken,
} from "./telegram/adapter.js"
export type {
  TelegramAdapterTransport,
  TelegramConnectionMode,
  TelegramConnectionPolicy,
  TelegramContinuationLookupCandidate,
  TelegramWebhookSecretValidation,
} from "./telegram/adapter.js"
export { SlackChannel } from "./slack/bot.js"
export {
  SlackChannelAdapter,
  buildSlackCapabilityManifest,
  buildSlackContinuationLookupCandidate,
  createSlackChannelAdapter,
  normalizeSlackInboundEvent,
  normalizeSlackInteractionPayload,
  resolveSlackConnectionPolicy,
} from "./slack/adapter.js"
export type {
  SlackAdapterTransport,
  SlackConnectionMode,
  SlackConnectionPolicy,
  SlackContinuationLookupCandidate,
} from "./slack/adapter.js"
export {
  DiscordChannelAdapter,
  buildDiscordCapabilityManifest,
  buildDiscordContinuationLookupCandidate,
  buildDiscordPermissionDoctor,
  createDiscordChannelAdapter,
  normalizeDiscordComponentInteraction,
  normalizeDiscordInboundEvent,
  normalizeDiscordInteractionRequest,
  resolveDiscordConnectionPolicy,
  validateDiscordInteractionSignature,
} from "./discord/adapter.js"
export type {
  DiscordAdapterTransport,
  DiscordConnectionMode,
  DiscordConnectionPolicy,
  DiscordContinuationLookupCandidate,
  DiscordDoctorIssue,
  DiscordInteractionSignatureValidation,
  DiscordPermissionDoctor,
} from "./discord/adapter.js"
export {
  GoogleChatChannelAdapter,
  buildGoogleChatCapabilityManifest,
  buildGoogleChatContinuationLookupCandidate,
  buildGoogleChatWorkspaceDoctor,
  createGoogleChatChannelAdapter,
  normalizeGoogleChatCardAction,
  normalizeGoogleChatInboundEvent,
  resolveGoogleChatConnectionPolicy,
  validateGoogleChatRequestAuth,
} from "./google-chat/adapter.js"
export type {
  GoogleChatAdapterTransport,
  GoogleChatConnectionMode,
  GoogleChatConnectionPolicy,
  GoogleChatContinuationLookupCandidate,
  GoogleChatDoctorIssue,
  GoogleChatRequestAuthValidation,
  GoogleChatWorkspaceDoctor,
} from "./google-chat/adapter.js"
export {
  LocalBridgeChannelAdapter,
  buildLocalBridgeCapabilityManifest,
  buildLocalBridgeDoctor,
  createLocalBridgeChannelAdapter,
} from "./local-bridge/adapter.js"
export type {
  LocalBridgeConfig,
  LocalBridgeDoctor,
  LocalBridgeDoctorIssue,
  LocalBridgeMode,
  LocalBridgeProvider,
  LocalBridgeTransport,
} from "./local-bridge/adapter.js"
export {
  buildIMessageCapabilityManifest,
  buildIMessageLocalBridgeConfig,
  buildIMessageLocalBridgeDoctor,
  createIMessageChannelAdapter,
} from "./imessage/adapter.js"
export {
  buildKakaoTalkLocalBridgeCapabilityManifest,
  buildKakaoTalkLocalBridgeConfig,
  buildKakaoTalkLocalBridgeDoctor,
  buildKakaoTalkOfficialCapabilityManifest,
  buildKakaoTalkOfficialDoctor,
  createKakaoTalkLocalBridgeChannelAdapter,
} from "./kakaotalk/adapter.js"
export { ChannelRegistry, buildChannelRegistryRuntimeDiagnostics, createBuiltInChannelProviderFactories } from "./registry.js"
export {
  CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY,
  buildChannelRuntimeSummary,
  recordChannelRuntimeEvent,
  resolveChannelRegistryRuntimeMode,
  updateConnectionRuntimeHealth,
} from "./runtime.js"
export type {
  ChannelProviderFactory,
  ChannelProviderFactoryContext,
  ChannelRegistryRuntimeMode,
  ChannelRuntimeAdapter,
  ChannelRuntimeHealth,
  ChannelRuntimeStartDisposition,
  ChannelRuntimeStartResult,
  ChannelRuntimeSummary,
} from "./runtime.js"
export {
  buildAccessPolicyFromAllowedIds,
  evaluateInboundAccessPolicy,
  recordChannelAccessPolicyResult,
} from "./access-policy.js"
export type {
  ChannelAccessDecision,
  ChannelAccessPolicy,
  ChannelAccessPolicyPrincipal,
  ChannelAccessPolicyResult,
  ChannelAccessReasonCode,
} from "./access-policy.js"
export {
  buildContinuationConfirmationPrompt,
  resolveChannelContinuation,
} from "./continuation.js"
export type {
  ChannelContinuationCandidateSource,
  ChannelContinuationLookupCandidate,
  ChannelContinuationLookupInput,
  ChannelContinuationLookupResult,
  ChannelContinuationLookupStatus,
} from "./continuation.js"
export {
  buildIdentityNamespaceCandidates,
  buildRoomNamespaceCandidates,
  namespaceChannelPrincipal,
  namespaceChannelRoom,
  namespaceChannelThread,
  namespaceChannelUser,
  namespaceChannelWorkspace,
  parseNamespacedChannelPrincipal,
} from "./identity.js"
export type {
  ChannelPrincipalKind,
  ChannelPrincipalScope,
  ChannelPrincipalScopeKind,
  NamespacedChannelPrincipalInput,
  ParsedNamespacedChannelPrincipal,
} from "./identity.js"
export {
  applyChannelConnectionSettingsCompatPatch,
  buildCompatChannelConnectionsFromConfig,
  buildSettingsChannelConnectionSnapshot,
  channelConnectionSecretsToJson,
  namespaceChannelIdentity,
  parseNamespacedChannelIdentity,
  persistChannelConnections,
} from "./connections.js"
export type {
  BuildChannelConnectionSnapshotInput,
  ChannelAllowedPrincipal,
  ChannelConnectionConfigSource,
  ChannelConnectionHealthStatus,
  ChannelConnectionMode,
  ChannelConnectionRecord,
  ChannelConnectionSettingsPatchResult,
  ChannelDeliveryPolicy,
  ChannelIdentityKind,
  ChannelRuntimeSnapshot,
  ChannelSecretRef,
} from "./connections.js"
export {
  buildCapabilityFallbackNotice,
  describeUnsupportedCapability,
  resolveChannelDeliveryFallbackPlan,
  splitTextForChannel,
} from "./delivery-fallback.js"
export type {
  ChannelArtifactFallbackMode,
  ChannelDeliveryCapability,
  ChannelDeliveryFallbackAction,
  ChannelDeliveryFallbackIssue,
  ChannelDeliveryFallbackPlan,
  ChannelDeliveryFallbackSeverity,
  ResolveChannelDeliveryFallbackPlanInput,
} from "./delivery-fallback.js"
export {
  buildUnsupportedCapabilityReceipt,
  createRawPayloadRef,
  defineChannelAdapter,
  defineChannelCapabilities,
  isBuiltInChannelProvider,
  isExternalChannelProvider,
  isInternalChannelSurface,
  isPositiveDeliveryReceipt,
  normalizeChannelSource,
  resolveDeliveryReceiptStatus,
  resolveChannelSurface,
  sanitizeChannelContractValue,
} from "./contracts.js"
export type {
  ApprovalInteractionDecision,
  BuiltInChannelProvider,
  ChannelAction,
  ChannelActionKind,
  ChannelAdapter,
  ChannelAccessPolicySnapshot,
  ChannelAttachment,
  ChannelBlock,
  ChannelCapabilities,
  ChannelConnectionId,
  ChannelConnectionKind,
  ChannelDeliveryStateCapabilities,
  ChannelHealthCheck,
  ChannelHealthStatus,
  ChannelId,
  ChannelIdentity,
  ChannelMention,
  ChannelProvider,
  ChannelProviderId,
  ChannelRateLimitPolicy,
  ChannelRiskLevel,
  ChannelRoom,
  ChannelSource,
  ChannelSurface,
  ChannelTarget,
  ChannelTypingIndicator,
  ChannelUploadOptions,
  ChannelWorkspace,
  DeliveryReceipt,
  DeliveryReceiptPart,
  DeliveryReceiptStatus,
  InboundEnvelope,
  InteractionEnvelope,
  InteractionKind,
  InternalChannelSurface,
  JsonPrimitive,
  JsonValue,
  KnownChannelProvider,
  KnownChannelSource,
  OutboundChunkMode,
  OutboundChunkPolicy,
  OutboundDeliveryMode,
  OutboundMessage,
  OutboundPriority,
  OutboundRedactionPolicy,
  OutboundThreadPolicy,
  OutboundThreadPolicyMode,
  RawPayloadRedactionState,
  RawPayloadRef,
  RawPayloadStorage,
  ResolveDeliveryReceiptStatusInput,
} from "./contracts.js"
export {
  getDefaultChannelSmokeScenarios,
  createDryRunChannelSmokeExecutor,
  resolveChannelSmokeReadiness,
  runPersistedChannelSmokeScenarios,
  runChannelSmokeScenarios,
  sanitizeChannelSmokeTrace,
  sanitizeChannelSmokeValue,
  validateChannelSmokeTrace,
  type ChannelSmokeArtifactMode,
  type ChannelSmokeArtifactTrace,
  type ChannelSmokeChannel,
  type ChannelSmokeCapabilityFallbackTrace,
  type ChannelSmokeCorrelationKey,
  type ChannelSmokeReadiness,
  type ChannelSmokeReleaseGateMode,
  type ChannelSmokeRunMode,
  type ChannelSmokeRunResult,
  type ChannelSmokeRunnerOptions,
  type ChannelSmokeScenario,
  type ChannelSmokeScenarioKind,
  type ChannelSmokeStatus,
  type ChannelSmokeToolTrace,
  type ChannelSmokeTrace,
  type ChannelSmokeValidation,
  type PersistedChannelSmokeRunnerOptions,
  type PersistedChannelSmokeRunResult,
} from "./smoke-runner.js"

const log = createLogger("channels")

export async function startChannels(): Promise<void> {
  const config = getConfig()

  try {
    persistChannelConnections(buildCompatChannelConnectionsFromConfig(config))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`Failed to sync channel connection compatibility rows: ${message}`)
  }

  stopActiveSlackChannel()
  stopActiveTelegramChannel()
  stopDiscordRuntime()
  stopGoogleChatRuntime()
  setSlackRuntimeError(null)
  setTelegramRuntimeError(null)
  setDiscordRuntimeError(null)
  setGoogleChatRuntimeError(null)

  const runtimeFlag = getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY)
  if (resolveChannelRegistryRuntimeMode(runtimeFlag) === "registry") {
    const registry = new ChannelRegistry({ config })
    await registry.startEnabled()
    return
  }

  if (config.slack?.enabled) {
    const channel = new SlackChannel(config.slack)
    try {
      await channel.start()
      setActiveSlackChannel(channel)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (getActiveSlackChannel() === channel) setActiveSlackChannel(null)
      setSlackRuntimeError(message)
      log.warn(`Failed to start Slack channel: ${message}`)
    }
  }

  if (config.telegram?.enabled) {
    const channel = new TelegramChannel(config.telegram)
    try {
      await channel.start()
      setActiveTelegramChannel(channel)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (getActiveTelegramChannel() === channel) setActiveTelegramChannel(null)
      setTelegramRuntimeError(message)
      log.warn(`Failed to start Telegram channel: ${message}`)
    }
  }

  if (config.discord?.enabled) {
    const adapter = new DiscordChannelAdapter({ config: config.discord })
    try {
      await adapter.start()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setDiscordRuntimeError(message)
      log.warn(`Failed to start Discord channel: ${message}`)
    }
  }

  if (config.googleChat?.enabled) {
    const adapter = new GoogleChatChannelAdapter({ config: config.googleChat })
    try {
      await adapter.start()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setGoogleChatRuntimeError(message)
      log.warn(`Failed to start Google Chat channel: ${message}`)
    }
  }
}
