import { runChannelAdapterContractTests } from "./fixtures/channel-adapter-contract-runner.ts"
import {
  buildDiscordOutboundMessage,
  buildGoogleChatOutboundMessage,
  buildSlackOutboundMessage,
  buildTelegramOutboundMessage,
  buildUnsupportedButtonsMessage,
  createDiscordFixtureAdapter,
  createGoogleChatFixtureAdapter,
  createNoButtonFixtureAdapter,
  createSlackFixtureAdapter,
  createTelegramFixtureAdapter,
  discordInboundFixtures,
  discordInteractionFixtures,
  googleChatInboundFixtures,
  googleChatInteractionFixtures,
  slackInboundFixtures,
  slackInteractionFixtures,
  telegramInboundFixtures,
  telegramInteractionFixtures,
} from "./fixtures/channel-provider-fixtures.ts"

runChannelAdapterContractTests({
  name: "Telegram fixture channel adapter contract",
  adapterFactory: createTelegramFixtureAdapter,
  inboundFixtures: telegramInboundFixtures,
  interactionFixtures: telegramInteractionFixtures,
  outboundMessage: buildTelegramOutboundMessage(),
})

runChannelAdapterContractTests({
  name: "Slack fixture channel adapter contract",
  adapterFactory: createSlackFixtureAdapter,
  inboundFixtures: slackInboundFixtures,
  interactionFixtures: slackInteractionFixtures,
  outboundMessage: buildSlackOutboundMessage(),
})

runChannelAdapterContractTests({
  name: "Discord fixture channel adapter contract",
  adapterFactory: createDiscordFixtureAdapter,
  inboundFixtures: discordInboundFixtures,
  interactionFixtures: discordInteractionFixtures,
  outboundMessage: buildDiscordOutboundMessage(),
})

runChannelAdapterContractTests({
  name: "Google Chat fixture channel adapter contract",
  adapterFactory: createGoogleChatFixtureAdapter,
  inboundFixtures: googleChatInboundFixtures,
  interactionFixtures: googleChatInteractionFixtures,
  outboundMessage: buildGoogleChatOutboundMessage(),
})

runChannelAdapterContractTests({
  name: "unsupported capability fixture channel adapter contract",
  adapterFactory: createNoButtonFixtureAdapter,
  outboundMessage: {
    ...buildUnsupportedButtonsMessage(),
    actions: [],
    deliveryMode: "text",
    text: "Plain text fallback.",
  },
  unsupportedCapabilityFixture: {
    name: "buttons on a channel without button support",
    message: buildUnsupportedButtonsMessage(),
    capability: "supportsButtons",
  },
})
