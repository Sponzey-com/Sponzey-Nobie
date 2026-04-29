import {
  generateKeyPairSync,
  sign,
} from "node:crypto"
import {
  buildUnsupportedCapabilityReceipt,
  createRawPayloadRef,
  defineChannelAdapter,
  defineChannelCapabilities,
  resolveDeliveryReceiptStatus,
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelProviderId,
  type DeliveryReceipt,
  type InboundEnvelope,
  type InteractionEnvelope,
  type OutboundMessage,
} from "../../packages/core/src/channels/contracts.ts"
import type {
  ChannelInboundFixture,
  ChannelInteractionFixture,
} from "./channel-adapter-contract-runner.ts"

const TELEGRAM_SECRET = "123456789:abcdefghijklmnopqrstuvwxyz123456"
const SLACK_SECRET = "xoxb-slack-secret-token"
const DISCORD_SECRET = "discord-bot-secret-token"
const GOOGLE_CHAT_SECRET = "google-chat-verification-token"
const DISCORD_SIGNATURE_TIMESTAMP = "1710000200"
const DISCORD_INTERACTION_NOW = 1_710_000_200_000
const GOOGLE_CHAT_NOW = 1_710_000_300_000
const DISCORD_KEY_PAIR = generateKeyPairSync("ed25519")
export const DISCORD_PUBLIC_KEY = Buffer.from(
  DISCORD_KEY_PAIR.publicKey.export({ format: "der", type: "spki" }),
).subarray(-32).toString("hex")

function clone<T>(value: T): T {
  return structuredClone(value)
}

function fixtureKey(value: unknown): string {
  return JSON.stringify(value)
}

function telegramRawRef(payload: unknown, createdAt: number) {
  return createRawPayloadRef({ provider: "telegram", payload, createdAt })
}

function slackRawRef(payload: unknown, createdAt: number) {
  return createRawPayloadRef({ provider: "slack", payload, createdAt })
}

function discordRawRef(payload: unknown, createdAt: number) {
  return createRawPayloadRef({ provider: "discord", payload, createdAt })
}

function googleChatRawRef(payload: unknown, createdAt: number) {
  return createRawPayloadRef({ provider: "google_chat", payload, createdAt })
}

function signDiscordInteraction(body: Record<string, unknown>) {
  const rawBody = JSON.stringify(body)
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(DISCORD_SIGNATURE_TIMESTAMP, "utf8"), Buffer.from(rawBody, "utf8")]),
    DISCORD_KEY_PAIR.privateKey,
  ).toString("hex")
  return {
    headers: {
      "x-signature-ed25519": signature,
      "x-signature-timestamp": DISCORD_SIGNATURE_TIMESTAMP,
    },
    rawBody,
    body,
  }
}

export function telegramFixtureCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "telegram",
    connectionKind: "bot_api",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: true,
    supportsDeletes: false,
    supportsReactions: false,
    supportsButtons: true,
    supportsModals: false,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: true,
    maxMessageLength: 4096,
    maxAttachmentSizeBytes: 50 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: false,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "low",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

export function slackFixtureCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "slack",
    connectionKind: "socket",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: true,
    supportsDeletes: true,
    supportsReactions: true,
    supportsButtons: true,
    supportsModals: true,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: false,
    maxMessageLength: 3000,
    maxAttachmentSizeBytes: 1024 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: false,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "low",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

export function discordFixtureCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "discord",
    connectionKind: "socket",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: false,
    supportsDeletes: false,
    supportsReactions: true,
    supportsButtons: true,
    supportsModals: false,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: true,
    maxMessageLength: 2000,
    maxAttachmentSizeBytes: 25 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: true,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "medium",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

export function googleChatFixtureCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "google_chat",
    connectionKind: "webhook",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: false,
    supportsDeletes: false,
    supportsReactions: false,
    supportsButtons: true,
    supportsModals: false,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: false,
    maxMessageLength: 4096,
    maxAttachmentSizeBytes: 25 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: true,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "medium",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

export function noButtonFixtureCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "imessage",
    connectionKind: "local_bridge",
    supportsThreads: false,
    supportsReplies: true,
    supportsEdits: false,
    supportsDeletes: false,
    supportsReactions: false,
    supportsButtons: false,
    supportsModals: false,
    supportsFiles: false,
    supportsImages: false,
    supportsTypingIndicator: false,
    maxMessageLength: 2000,
    rateLimitPolicy: { strategy: "manual" },
    requiresWebhook: false,
    requiresLocalBridge: true,
    requiresUserSession: true,
    riskLevel: "experimental",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

const telegramMessagePayload = {
  update_id: 1001,
  botToken: TELEGRAM_SECRET,
  message: {
    message_id: 313,
    date: 1_710_000_000,
    text: "/ask deploy status",
    from: {
      id: 42120565,
      is_bot: false,
      first_name: "Tester",
      username: "tester",
    },
    chat: {
      id: 42120565,
      type: "private",
      first_name: "Tester",
      username: "tester",
    },
  },
}

const telegramReplyPayload = {
  update_id: 1002,
  message: {
    message_id: 314,
    message_thread_id: 7,
    date: 1_710_000_030,
    text: "continue from the previous answer",
    from: {
      id: 77,
      is_bot: false,
      first_name: "Operator",
      username: "operator",
    },
    chat: {
      id: -100100,
      type: "supergroup",
      title: "Ops Room",
    },
    reply_to_message: {
      message_id: 300,
      message_thread_id: 7,
      text: "original request",
    },
  },
}

const telegramFilePayload = {
  update_id: 1003,
  message: {
    message_id: 315,
    date: 1_710_000_060,
    caption: "Please review attached contract.",
    from: {
      id: 42120565,
      is_bot: false,
      first_name: "Tester",
      username: "tester",
    },
    chat: {
      id: 42120565,
      type: "private",
      first_name: "Tester",
      username: "tester",
    },
    document: {
      file_id: "telegram-file-1",
      file_unique_id: "telegram-file-unique-1",
      file_name: "contract.pdf",
      mime_type: "application/pdf",
      file_size: 2048,
    },
  },
}

const telegramCallbackPayload = {
  update_id: 1004,
  callback_query: {
    id: "telegram-callback-1",
    data: "approval:allow_once:run-telegram-approval",
    from: {
      id: 42120565,
      is_bot: false,
      first_name: "Tester",
      username: "tester",
    },
    message: {
      message_id: 600,
      date: 1_710_000_090,
      chat: {
        id: 42120565,
        type: "private",
        first_name: "Tester",
      },
    },
  },
}

export const telegramInboundFixtures: ChannelInboundFixture[] = [
  {
    name: "message",
    rawPayload: telegramMessagePayload,
    rawSecrets: [TELEGRAM_SECRET],
    expected: [{
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      messageId: "313",
      sender: {
        id: "42120565",
        displayName: "Tester",
        username: "tester",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "42120565",
        displayName: "Tester",
        type: "direct",
      },
      text: "/ask deploy status",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_000_000,
      rawPayloadRef: telegramRawRef(telegramMessagePayload, 1_710_000_000_000),
      dedupeKey: "telegram:42120565:main:313",
    }],
  },
  {
    name: "reply_to_message",
    rawPayload: telegramReplyPayload,
    expected: [{
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      messageId: "314",
      threadId: "7",
      replyToMessageId: "300",
      sender: {
        id: "77",
        displayName: "Operator",
        username: "operator",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "-100100",
        displayName: "Ops Room",
        type: "group",
      },
      text: "continue from the previous answer",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_030_000,
      rawPayloadRef: telegramRawRef(telegramReplyPayload, 1_710_000_030_000),
      continuationContext: {
        parentMessageId: "300",
        source: "reply",
      },
      dedupeKey: "telegram:-100100:7:314",
    }],
  },
  {
    name: "file message",
    rawPayload: telegramFilePayload,
    expected: [{
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      messageId: "315",
      sender: {
        id: "42120565",
        displayName: "Tester",
        username: "tester",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "42120565",
        displayName: "Tester",
        type: "direct",
      },
      text: "Please review attached contract.",
      attachments: [{
        id: "telegram-file-1",
        name: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        kind: "file",
        contentRef: "telegram:file:telegram-file-1",
      }],
      mentions: [],
      timestamp: 1_710_000_060_000,
      rawPayloadRef: telegramRawRef(telegramFilePayload, 1_710_000_060_000),
      dedupeKey: "telegram:42120565:main:315",
    }],
  },
]

export const telegramInteractionFixtures: ChannelInteractionFixture[] = [
  {
    name: "callback query",
    rawPayload: telegramCallbackPayload,
    expected: [{
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      interactionId: "telegram-callback-1",
      kind: "approval",
      sender: {
        id: "42120565",
        displayName: "Tester",
        username: "tester",
        isBot: false,
        providerType: "user",
      },
      timestamp: 1_710_000_090_000,
      rawPayloadRef: telegramRawRef(telegramCallbackPayload, 1_710_000_090_000),
      messageId: "600",
      room: {
        id: "42120565",
        displayName: "Tester",
        type: "direct",
      },
      actionId: "allow_once",
      value: "approval:allow_once:run-telegram-approval",
      approvalDecision: "allow_once",
      correlationId: "run-telegram-approval",
    }],
  },
]

const slackAppMentionPayload = {
  token: SLACK_SECRET,
  team_id: "T123",
  event_id: "EvAPP",
  type: "event_callback",
  event: {
    type: "app_mention",
    user: "U_OPERATOR",
    text: "<@U_NOBIE> run deploy",
    channel: "C_APPROVAL",
    ts: "1710000100.000100",
    event_ts: "1710000100.000100",
  },
}

const slackDmPayload = {
  team_id: "T123",
  event_id: "EvDM",
  type: "event_callback",
  event: {
    type: "message",
    channel_type: "im",
    user: "U_OPERATOR",
    text: "what is the status?",
    channel: "D_DIRECT",
    ts: "1710000110.000200",
    event_ts: "1710000110.000200",
  },
}

const slackThreadReplyPayload = {
  team_id: "T123",
  event_id: "EvTHREAD",
  type: "event_callback",
  event: {
    type: "message",
    user: "U_OPERATOR",
    text: "please continue",
    channel: "C_APPROVAL",
    ts: "1710000120.000300",
    thread_ts: "1710000100.000100",
    event_ts: "1710000120.000300",
  },
}

const slackBlockActionPayload = {
  type: "block_actions",
  team: { id: "T123" },
  user: { id: "U_APPROVER", username: "approver", name: "approver" },
  channel: { id: "C_APPROVAL", name: "approval" },
  message: { ts: "1710000100.000100", thread_ts: "1710000100.000100" },
  actions: [{
    action_id: "allow_once",
    block_id: "approval-actions",
    value: "run-slack-approval",
    type: "button",
  }],
  authorization: `Bearer ${SLACK_SECRET}`,
}

export const slackInboundFixtures: ChannelInboundFixture[] = [
  {
    name: "app mention",
    rawPayload: slackAppMentionPayload,
    rawSecrets: [SLACK_SECRET],
    expected: [{
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack:primary",
      messageId: "1710000100.000100",
      threadId: "1710000100.000100",
      sender: {
        id: "U_OPERATOR",
        providerType: "user",
      },
      room: {
        id: "C_APPROVAL",
        type: "channel",
      },
      workspace: { id: "T123" },
      text: "run deploy",
      attachments: [],
      mentions: [{ id: "U_NOBIE", displayName: "Nobie", kind: "agent" }],
      timestamp: 1_710_000_100_000,
      rawPayloadRef: slackRawRef(slackAppMentionPayload, 1_710_000_100_000),
      dedupeKey: "slack:C_APPROVAL:1710000100.000100",
    }],
  },
  {
    name: "dm",
    rawPayload: slackDmPayload,
    expected: [{
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack:primary",
      messageId: "1710000110.000200",
      sender: {
        id: "U_OPERATOR",
        providerType: "user",
      },
      room: {
        id: "D_DIRECT",
        type: "direct",
      },
      workspace: { id: "T123" },
      text: "what is the status?",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_110_000,
      rawPayloadRef: slackRawRef(slackDmPayload, 1_710_000_110_000),
      dedupeKey: "slack:D_DIRECT:1710000110.000200",
    }],
  },
  {
    name: "thread reply",
    rawPayload: slackThreadReplyPayload,
    expected: [{
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack:primary",
      messageId: "1710000120.000300",
      threadId: "1710000100.000100",
      replyToMessageId: "1710000100.000100",
      sender: {
        id: "U_OPERATOR",
        providerType: "user",
      },
      room: {
        id: "C_APPROVAL",
        type: "channel",
      },
      workspace: { id: "T123" },
      text: "please continue",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_120_000,
      rawPayloadRef: slackRawRef(slackThreadReplyPayload, 1_710_000_120_000),
      continuationContext: {
        parentMessageId: "1710000100.000100",
        source: "thread",
      },
      dedupeKey: "slack:C_APPROVAL:1710000120.000300",
    }],
  },
]

export const slackInteractionFixtures: ChannelInteractionFixture[] = [
  {
    name: "block kit action",
    rawPayload: slackBlockActionPayload,
    rawSecrets: [SLACK_SECRET],
    expected: [{
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack:primary",
      interactionId: "slack:allow_once:run-slack-approval",
      kind: "approval",
      sender: {
        id: "U_APPROVER",
        username: "approver",
        providerType: "user",
      },
      timestamp: 1_710_000_100_000,
      rawPayloadRef: slackRawRef(slackBlockActionPayload, 1_710_000_100_000),
      messageId: "1710000100.000100",
      threadId: "1710000100.000100",
      room: {
        id: "C_APPROVAL",
        displayName: "approval",
        type: "channel",
      },
      workspace: { id: "T123" },
      actionId: "allow_once",
      value: "run-slack-approval",
      approvalDecision: "allow_once",
      correlationId: "run-slack-approval",
    }],
  },
]

const discordMessagePayload = {
  t: "MESSAGE_CREATE",
  botToken: DISCORD_SECRET,
  d: {
    id: "9001",
    guild_id: "GUILD1",
    channel_id: "CHANNEL1",
    author: {
      id: "USER1",
      username: "operator",
      global_name: "Operator",
      bot: false,
    },
    content: "<@123456789012345678> run deploy",
    timestamp: "2024-03-09T16:02:10.000Z",
    mentions: [{
      id: "BOT1",
      username: "Nobie",
      bot: true,
    }],
    attachments: [{
      id: "ATTACH1",
      filename: "chart.png",
      content_type: "image/png",
      size: 2048,
      url: "https://cdn.discordapp.com/attachments/chart.png",
    }],
  },
}

const discordReplyPayload = {
  t: "MESSAGE_CREATE",
  d: {
    id: "9002",
    guild_id: "GUILD1",
    channel_id: "THREAD1",
    thread_id: "THREAD1",
    author: {
      id: "USER1",
      username: "operator",
      bot: false,
    },
    content: "continue from here",
    timestamp: "2024-03-09T16:02:20.000Z",
    message_reference: {
      message_id: "9001",
      channel_id: "CHANNEL1",
      guild_id: "GUILD1",
    },
  },
}

const discordSlashCommandBody = {
  id: "discord-slash-1",
  application_id: "APP1",
  type: 2,
  guild_id: "GUILD1",
  channel_id: "CHANNEL1",
  member: {
    user: {
      id: "USER1",
      username: "operator",
      global_name: "Operator",
    },
  },
  data: {
    name: "deploy",
    options: [{ name: "env", value: "prod" }],
  },
}

const discordComponentBody = {
  id: "discord-component-1",
  application_id: "APP1",
  type: 3,
  guild_id: "GUILD1",
  channel_id: "CHANNEL1",
  member: {
    user: {
      id: "USER_APPROVER",
      username: "approver",
    },
  },
  message: { id: "9001" },
  data: {
    custom_id: "approval:allow_once:run-discord-approval",
    component_type: 2,
  },
}

export const discordSlashCommandPayload = signDiscordInteraction(discordSlashCommandBody)
export const discordComponentPayload = signDiscordInteraction(discordComponentBody)

export const discordInboundFixtures: ChannelInboundFixture[] = [
  {
    name: "gateway mention with attachment",
    rawPayload: discordMessagePayload,
    rawSecrets: [DISCORD_SECRET],
    expected: [{
      channelId: "discord:primary",
      provider: "discord",
      connectionId: "discord:primary",
      messageId: "9001",
      sender: {
        id: "USER1",
        displayName: "Operator",
        username: "operator",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "CHANNEL1",
        type: "channel",
      },
      workspace: { id: "GUILD1" },
      text: "run deploy",
      attachments: [{
        id: "ATTACH1",
        name: "chart.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        kind: "image",
        url: "https://cdn.discordapp.com/attachments/chart.png",
        contentRef: "discord:attachment:ATTACH1",
      }],
      mentions: [{ id: "BOT1", displayName: "Nobie", kind: "agent" }],
      timestamp: 1_710_000_130_000,
      rawPayloadRef: discordRawRef(discordMessagePayload, 1_710_000_130_000),
      dedupeKey: "discord:GUILD1:CHANNEL1:9001",
    }],
  },
  {
    name: "thread reply",
    rawPayload: discordReplyPayload,
    expected: [{
      channelId: "discord:primary",
      provider: "discord",
      connectionId: "discord:primary",
      messageId: "9002",
      threadId: "THREAD1",
      replyToMessageId: "9001",
      sender: {
        id: "USER1",
        displayName: "operator",
        username: "operator",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "THREAD1",
        type: "channel",
      },
      workspace: { id: "GUILD1" },
      text: "continue from here",
      attachments: [],
      mentions: [],
      timestamp: 1_710_000_140_000,
      rawPayloadRef: discordRawRef(discordReplyPayload, 1_710_000_140_000),
      continuationContext: {
        parentMessageId: "9001",
        source: "reply",
      },
      dedupeKey: "discord:GUILD1:THREAD1:9002",
    }],
  },
  {
    name: "signed slash command",
    rawPayload: discordSlashCommandPayload,
    expected: [{
      channelId: "discord:primary",
      provider: "discord",
      connectionId: "discord:primary",
      messageId: "discord-slash-1",
      sender: {
        id: "USER1",
        displayName: "Operator",
        username: "operator",
        providerType: "user",
      },
      room: {
        id: "CHANNEL1",
        type: "channel",
      },
      workspace: { id: "GUILD1" },
      text: "/deploy env:prod",
      attachments: [],
      mentions: [],
      timestamp: DISCORD_INTERACTION_NOW,
      rawPayloadRef: discordRawRef(discordSlashCommandPayload, DISCORD_INTERACTION_NOW),
      dedupeKey: "discord:interaction:discord-slash-1",
    }],
  },
]

export const discordInteractionFixtures: ChannelInteractionFixture[] = [
  {
    name: "component approval button",
    rawPayload: discordComponentPayload,
    expected: [{
      channelId: "discord:primary",
      provider: "discord",
      connectionId: "discord:primary",
      interactionId: "discord-component-1",
      kind: "approval",
      sender: {
        id: "USER_APPROVER",
        displayName: "approver",
        username: "approver",
        providerType: "user",
      },
      timestamp: DISCORD_INTERACTION_NOW,
      rawPayloadRef: discordRawRef(discordComponentPayload, DISCORD_INTERACTION_NOW),
      messageId: "9001",
      room: {
        id: "CHANNEL1",
        type: "channel",
      },
      workspace: { id: "GUILD1" },
      actionId: "allow_once",
      value: "approval:allow_once:run-discord-approval",
      approvalDecision: "allow_once",
      correlationId: "run-discord-approval",
    }],
  },
]

const googleChatMessagePayload = {
  headers: {
    "x-goog-chat-token": GOOGLE_CHAT_SECRET,
  },
  body: {
    type: "MESSAGE",
    eventTime: "2024-03-09T16:05:00.000Z",
    message: {
      name: "spaces/SPACE1/messages/MESSAGE1",
      createTime: "2024-03-09T16:05:00.000Z",
      text: "@Nobie run deploy",
      argumentText: "run deploy",
      sender: {
        name: "users/USER1",
        displayName: "Operator",
        email: "operator@example.com",
        type: "HUMAN",
      },
      space: {
        name: "spaces/SPACE1",
        type: "ROOM",
        displayName: "Ops Space",
      },
      thread: {
        name: "spaces/SPACE1/threads/THREAD1",
      },
      attachment: [{
        name: "spaces/SPACE1/messages/MESSAGE1/attachments/ATTACH1",
        contentName: "chart.png",
        contentType: "image/png",
        attachmentDataRef: { resourceName: "attachment-data-1" },
      }],
    },
    space: {
      name: "spaces/SPACE1",
      type: "ROOM",
      displayName: "Ops Space",
    },
    user: {
      name: "users/USER1",
      displayName: "Operator",
      email: "operator@example.com",
      type: "HUMAN",
    },
  },
}

const googleChatCardActionPayload = {
  token: GOOGLE_CHAT_SECRET,
  body: {
    type: "CARD_CLICKED",
    eventTime: "2024-03-09T16:05:05.000Z",
    message: {
      name: "spaces/SPACE1/messages/MESSAGE1",
      sender: {
        name: "users/NOBIE_BOT",
        displayName: "Nobie",
        type: "BOT",
      },
      space: {
        name: "spaces/SPACE1",
        type: "ROOM",
        displayName: "Ops Space",
      },
      thread: {
        name: "spaces/SPACE1/threads/THREAD1",
      },
    },
    space: {
      name: "spaces/SPACE1",
      type: "ROOM",
      displayName: "Ops Space",
    },
    user: {
      name: "users/USER_APPROVER",
      displayName: "Approver",
      email: "approver@example.com",
      type: "HUMAN",
    },
    action: {
      actionMethodName: "approval:allow_once:run-google-chat-approval",
      parameters: [{ key: "value", value: "approval:allow_once:run-google-chat-approval" }],
    },
  },
}

export const googleChatInboundFixtures: ChannelInboundFixture[] = [
  {
    name: "message with attachment",
    rawPayload: googleChatMessagePayload,
    rawSecrets: [GOOGLE_CHAT_SECRET],
    expected: [{
      channelId: "google_chat:primary",
      provider: "google_chat",
      connectionId: "google_chat:primary",
      messageId: "MESSAGE1",
      threadId: "THREAD1",
      sender: {
        id: "USER1",
        displayName: "Operator",
        email: "operator@example.com",
        isBot: false,
        providerType: "user",
      },
      room: {
        id: "SPACE1",
        displayName: "Ops Space",
        type: "channel",
      },
      text: "run deploy",
      attachments: [{
        id: "spaces/SPACE1/messages/MESSAGE1/attachments/ATTACH1",
        name: "chart.png",
        mimeType: "image/png",
        kind: "image",
        contentRef: "attachment-data-1",
      }],
      mentions: [],
      timestamp: GOOGLE_CHAT_NOW,
      rawPayloadRef: googleChatRawRef(googleChatMessagePayload, GOOGLE_CHAT_NOW),
      continuationContext: {
        parentMessageId: "THREAD1",
        source: "thread",
      },
      dedupeKey: "google_chat:SPACE1:THREAD1:MESSAGE1",
    }],
  },
]

export const googleChatInteractionFixtures: ChannelInteractionFixture[] = [
  {
    name: "card approval action",
    rawPayload: googleChatCardActionPayload,
    rawSecrets: [GOOGLE_CHAT_SECRET],
    expected: [{
      channelId: "google_chat:primary",
      provider: "google_chat",
      connectionId: "google_chat:primary",
      interactionId: "spaces/SPACE1/messages/MESSAGE1:allow_once:1710000305000",
      kind: "approval",
      sender: {
        id: "USER_APPROVER",
        displayName: "Approver",
        email: "approver@example.com",
        isBot: false,
        providerType: "user",
      },
      timestamp: 1_710_000_305_000,
      rawPayloadRef: googleChatRawRef(googleChatCardActionPayload, 1_710_000_305_000),
      messageId: "MESSAGE1",
      threadId: "THREAD1",
      room: {
        id: "SPACE1",
        displayName: "Ops Space",
        type: "channel",
      },
      actionId: "allow_once",
      value: "approval:allow_once:run-google-chat-approval",
      approvalDecision: "allow_once",
      correlationId: "run-google-chat-approval",
    }],
  },
]

export function buildTelegramOutboundMessage(): OutboundMessage {
  return {
    channelId: "telegram:primary",
    provider: "telegram",
    connectionId: "telegram:primary",
    target: { roomId: "42120565", threadId: "7" },
    deliveryMode: "final",
    text: "Done.",
    threadPolicy: { mode: "reuse_thread", threadId: "7" },
    chunkPolicy: { mode: "provider_default", maxLength: 4096 },
    priority: "normal",
    idempotencyKey: "telegram:outbound:1",
    redactionPolicy: "default",
  }
}

export function buildSlackOutboundMessage(): OutboundMessage {
  return {
    channelId: "slack:workspace",
    provider: "slack",
    connectionId: "slack:primary",
    target: { roomId: "C_APPROVAL", threadId: "1710000100.000100" },
    deliveryMode: "final",
    text: "Done.",
    threadPolicy: { mode: "reuse_thread", threadId: "1710000100.000100" },
    chunkPolicy: { mode: "provider_default", maxLength: 3000 },
    priority: "normal",
    idempotencyKey: "slack:outbound:1",
    redactionPolicy: "default",
  }
}

export function buildDiscordOutboundMessage(): OutboundMessage {
  return {
    channelId: "discord:primary",
    provider: "discord",
    connectionId: "discord:primary",
    target: { roomId: "CHANNEL1", threadId: "THREAD1" },
    deliveryMode: "final",
    text: "Done.",
    threadPolicy: { mode: "reuse_thread", threadId: "THREAD1" },
    chunkPolicy: { mode: "provider_default", maxLength: 2000 },
    priority: "normal",
    idempotencyKey: "discord:outbound:1",
    redactionPolicy: "default",
  }
}

export function buildGoogleChatOutboundMessage(): OutboundMessage {
  return {
    channelId: "google_chat:primary",
    provider: "google_chat",
    connectionId: "google_chat:primary",
    target: { roomId: "SPACE1", threadId: "THREAD1" },
    deliveryMode: "final",
    text: "Done.",
    threadPolicy: { mode: "reuse_thread", threadId: "THREAD1" },
    chunkPolicy: { mode: "provider_default", maxLength: 4096 },
    priority: "normal",
    idempotencyKey: "google_chat:outbound:1",
    redactionPolicy: "default",
  }
}

export function buildUnsupportedButtonsMessage(): OutboundMessage {
  return {
    channelId: "imessage:local",
    provider: "imessage",
    connectionId: "imessage:local",
    target: { userId: "user-1" },
    deliveryMode: "approval_request",
    text: "Approve?",
    actions: [{
      id: "allow_once",
      kind: "approval",
      label: "Allow once",
      value: "run-unsupported",
    }],
    threadPolicy: { mode: "none" },
    chunkPolicy: { mode: "none" },
    priority: "normal",
    idempotencyKey: "imessage:unsupported:buttons",
    redactionPolicy: "default",
  }
}

export function createTelegramFixtureAdapter(): ChannelAdapter {
  return createFixtureChannelAdapter({
    channelId: "telegram:primary",
    provider: "telegram",
    connectionId: "telegram:primary",
    capabilities: telegramFixtureCapabilities(),
    inboundFixtures: telegramInboundFixtures,
    interactionFixtures: telegramInteractionFixtures,
  })
}

export function createSlackFixtureAdapter(): ChannelAdapter {
  return createFixtureChannelAdapter({
    channelId: "slack:workspace",
    provider: "slack",
    connectionId: "slack:primary",
    capabilities: slackFixtureCapabilities(),
    inboundFixtures: slackInboundFixtures,
    interactionFixtures: slackInteractionFixtures,
  })
}

export function createDiscordFixtureAdapter(): ChannelAdapter {
  return createFixtureChannelAdapter({
    channelId: "discord:primary",
    provider: "discord",
    connectionId: "discord:primary",
    capabilities: discordFixtureCapabilities(),
    inboundFixtures: discordInboundFixtures,
    interactionFixtures: discordInteractionFixtures,
  })
}

export function createGoogleChatFixtureAdapter(): ChannelAdapter {
  return createFixtureChannelAdapter({
    channelId: "google_chat:primary",
    provider: "google_chat",
    connectionId: "google_chat:primary",
    capabilities: googleChatFixtureCapabilities(),
    inboundFixtures: googleChatInboundFixtures,
    interactionFixtures: googleChatInteractionFixtures,
  })
}

export function createNoButtonFixtureAdapter(): ChannelAdapter {
  return createFixtureChannelAdapter({
    channelId: "imessage:local",
    provider: "imessage",
    connectionId: "imessage:local",
    capabilities: noButtonFixtureCapabilities(),
    inboundFixtures: [],
    interactionFixtures: [],
  })
}

function createFixtureChannelAdapter(input: {
  channelId: string
  provider: ChannelProviderId
  connectionId: string
  capabilities: ChannelCapabilities
  inboundFixtures: ChannelInboundFixture[]
  interactionFixtures: ChannelInteractionFixture[]
}): ChannelAdapter {
  const inbound = new Map(input.inboundFixtures.map((fixture) => [fixtureKey(fixture.rawPayload), fixture.expected]))
  const interactions = new Map(input.interactionFixtures.map((fixture) => [
    fixtureKey(fixture.rawPayload),
    fixture.expected,
  ]))

  return defineChannelAdapter({
    channelId: input.channelId,
    provider: input.provider,
    connectionId: input.connectionId,
    async start() {},
    async stop() {},
    async healthCheck() {
      return { status: "healthy", checkedAt: 1 }
    },
    getCapabilities() {
      return input.capabilities
    },
    async normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]> {
      return clone(inbound.get(fixtureKey(rawPayload)) ?? [])
    },
    async normalizeInteraction(rawPayload: unknown): Promise<InteractionEnvelope[]> {
      return clone(interactions.get(fixtureKey(rawPayload)) ?? [])
    },
    async sendMessage(message: OutboundMessage): Promise<DeliveryReceipt> {
      const unsupportedCapability = resolveUnsupportedMessageCapability(input.capabilities, message)
      if (unsupportedCapability) {
        return buildUnsupportedCapabilityReceipt({
          channelId: message.channelId,
          provider: message.provider,
          connectionId: message.connectionId,
          target: message.target,
          capability: unsupportedCapability,
          idempotencyKey: message.idempotencyKey,
          timestamp: 2,
        })
      }

      return {
        channelId: message.channelId,
        provider: message.provider,
        connectionId: message.connectionId,
        target: message.target,
        status: resolveDeliveryReceiptStatus({
          sent: true,
          delivered: true,
          providerSupportsDelivered: input.capabilities.deliveryStates.supportsDelivered,
        }),
        timestamp: 2,
        idempotencyKey: message.idempotencyKey,
        messageId: `${message.provider}:sent:1`,
        ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        providerResponseRef: createRawPayloadRef({
          provider: message.provider,
          payload: {
            ok: true,
            Authorization: message.provider === "slack" ? `Bearer ${SLACK_SECRET}` : undefined,
            botToken: message.provider === "telegram" ? TELEGRAM_SECRET : undefined,
            authorization: message.provider === "discord" ? `Bot ${DISCORD_SECRET}` : undefined,
            token: message.provider === "google_chat" ? GOOGLE_CHAT_SECRET : undefined,
          },
          createdAt: 2,
        }),
      }
    },
    async handleInteraction(interaction): Promise<DeliveryReceipt> {
      return {
        channelId: interaction.channelId,
        provider: interaction.provider,
        connectionId: interaction.connectionId,
        target: {
          ...(interaction.room?.id ? { roomId: interaction.room.id } : {}),
          ...(interaction.threadId ? { threadId: interaction.threadId } : {}),
          ...(interaction.messageId ? { messageId: interaction.messageId } : {}),
        },
        status: "accepted",
        timestamp: 2,
        idempotencyKey: `interaction:${interaction.interactionId}`,
      }
    },
  })
}

function resolveUnsupportedMessageCapability(
  capabilities: ChannelCapabilities,
  message: OutboundMessage,
): keyof ChannelCapabilities | null {
  if ((message.actions?.length ?? 0) > 0 && !capabilities.supportsButtons) return "supportsButtons"
  if ((message.attachments?.length ?? 0) > 0 && !capabilities.supportsFiles) return "supportsFiles"
  return null
}
