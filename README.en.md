# Sponzey Nobie

[한국어](./README.md) | [English](./README.en.md)

<p align="center">
  <img src="./resource/nobie-1-512.png" alt="Nobie" width="220" />
</p>

## Name Notes

- `Nobie`

  The name is meant to feel like a small work companion that stays beside the user. Not too heavy, not too cold. The tone is closer to “the helper that catches what you need and moves first” than to a generic bot label.
- `Yeonjang`

  The name comes from the Korean word `연장`, which can mean a tool or an extension. If Nobie is the part that thinks and orchestrates, Yeonjang is the part that reaches out to the actual device, screen, keyboard, and mouse. In short: `Nobie thinks`, `Yeonjang extends the hands`.

`Sponzey Nobie` is an orchestration-first personal AI that runs on the user's computer. The actual assistant name used inside the product is `Nobie`.

The goal of Nobie is not just to answer like a chat bot, but to understand requests, choose an execution path, continue through local work and external integrations, deliver results, and decide completion correctly.

## Current Status Summary

- `Implemented`: WebUI setup, AI connection, MCP and Skill registration, Telegram integration, task monitor, local execution tools, scheduling, and Yeonjang extension connectivity
- `Planned`: Slack channel hardening, stronger Windows/Linux installation and operations support, broader environment validation, and further setup UX simplification

Important:

- Nobie uses the `AI connected in Settings` for natural-language interpretation, request structuring, and completion review.
- There is no separate hidden external LLM actor in the process.
- The internal `packages/core/src/ai` layer is an adapter for configured AI backends.
- The current officially supported operating system is `macOS`. Windows/Linux paths in `Yeonjang` are partially implemented, but still need environment-specific validation and operations hardening.
- Nobie's current command-style local execution, app launch, screen capture, and keyboard or mouse control require the `Yeonjang` extension to be running.

The detailed process source of truth is [process.md](./process.md).

## Product Interpretation

Nobie is best understood as:

- `Personal assistant AI`

  It works against the user's computer, files, screen, apps, channels, and connected extensions.
- `Orchestration-first AI`

  It does not just respond. It coordinates which tool and execution route should do the work.
- `Ready after install`

  It is designed so users can configure it step by step in the WebUI and start using it quickly.
- `Extensible work platform`

  AI backends, MCP servers, Skills, channels, and extensions can be combined to expand what Nobie can do.

## Who It Is For

The main audience for Sponzey Nobie is:

- Users who are not comfortable with computers
- Users unfamiliar with terms such as AI, MCP, Skill, or channel integration
- Users who want a personal assistant without complex developer setup

That is why the UI and documentation follow these principles:

- Prefer simple wording first
- Keep original terms in `()` as supporting labels
- Make required settings explicit
- Keep actions such as Save, Cancel, Skip, and Next simple and obvious

## Implemented

### 1. AI Connection `(Implemented)`

Nobie uses the single AI connection configured in Settings.

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI-compatible endpoint
- Local or remote inference server

Current behavior:

- Nobie uses only one active AI connection at a time.
- Nobie uses only configured backend and model selections.
- Natural-language intake, execution dialogue, and completion review all use the configured AI connection.

### 2. External Tools `(MCP, Implemented)`

MCP servers can be connected so Nobie can extend its capabilities with external tools and services.

- Register stdio-based MCP servers
- Inspect available tools
- Distinguish required and optional servers
- Check connection state in Settings

### 3. Skills `(Implemented)`

Instruction bundles and capability packs can be attached for specific kinds of work.

- Register local skills
- Enable and disable skills
- Show descriptions and source

### 4. Communication Channels `(Partially Implemented)`

Currently implemented:

- WebUI chat
- Telegram

Planned:

- Slack

### 5. Extensions `(Yeonjang, Implemented)`

MQTT-connected extensions can be used for device-side execution.

- Inspect connected extension state
- Select execution targets by extension id
- Camera capture
- Execute command, app launch, screen capture, and keyboard or mouse control through the extension path

Important:

- Local device control and command execution are currently restricted to the `Yeonjang` path.
- In practice, this means `Yeonjang` must be running if you want these features to work.
- This path is most thoroughly validated on `macOS`. Windows/Linux functionality is implemented by feature area, and reported capabilities depend on installed OS tools and permissions.

### 6. Local Work Execution `(Implemented)`

Nobie can perform the following kinds of local work:

- Read, write, search, and modify files
- Execute shell commands
- Launch apps
- Capture the screen
- Control mouse and keyboard
- Inspect and terminate processes
- Deliver file artifacts directly

### 7. Task State Monitor `(Implemented)`

Nobie tracks requests as tasks rather than plain message rows.

Currently implemented in the monitor:

- `Task / Attempt / Recovery Attempt / Delivery` projection
- Checklist state for `request / execution / delivery / completion`
- Separate handling for approval, cancellation, failure, and delivery failure
- Split between user-facing task cards and internal debug attempts
- `/api/tasks` snapshot model and WebUI task monitoring
- Run detail diagnostics show prompt sources, memory/vector traces, recovery keys, tool receipts, and delivery receipts

### 8. Scheduling `(Implemented)`

Schedule registration and schedule execution are tracked as separate tasks and runs.

- one-time schedules
- recurring schedules
- schedule lifecycle events
- lineage with `scheduleId`, `scheduleRunId`, `originRunId`, and `originRequestGroupId`
- The WebUI schedule screen separates schedule lists, scheduler status, and recent schedule run history from the normal activity monitor

### 9. Prompts and Memory Diagnostics `(Implemented)`

Nobie does not keep every rule inside one growing system prompt. It assembles role-specific prompt sources from `prompts/`.

- `identity`, `user`, `definitions`, `soul`, `planner`
- `channel`, `tool_policy`, `memory_policy`, `recovery_policy`, `completion_policy`, `output_policy`
- Each run keeps a prompt source id, version, and checksum snapshot

Memory is split by purpose-specific scopes.

- `short-term`, `long-term`, `task`, `schedule`, `flash-feedback`, `artifact`, `diagnostic`
- Vector search is optional. If an embedding provider is missing or fails, Nobie falls back to FTS search.
- The Advanced Settings screen shows memory search mode, vector backend, and scheduler state.

## Internal Process Structure

The current confirmed Nobie process is split into:

1. `Ingress`
2. `Intake`
3. `Execution`
4. `Recovery`
5. `Delivery`
6. `Completion / Review`

Core principles:

- Execution success and completion success are not the same.
- Completion requires at least the four axes of `interpretation / execution / delivery / recovery settled`.
- Current completion judgment and monitoring are aligned to checklist-based state.
- Automatic retry limits follow `orchestration.maxDelegationTurns`.

## Setup Experience

The current WebUI setup flow is organized in this order:

1. Personal information
2. AI connection
3. External tools `(MCP)`
4. Skills
5. Communication
6. Review and finish

Current UX direction:

- The settings flow is being simplified so users only need to understand `connect one AI`.
- Older ideas such as provider priority, multi-AI comparison, or AI order editing are hidden from the default flow.
- The task monitor is presented as `one AI connection + multiple root/sub-task units`, not as multiple AI lanes.

Current status:

- `Implemented`: Settings screen, health/status checks, connection tests, MQTT and extension runtime panel
- `Planned`: further simplification for non-technical users, stronger environment-specific guidance, and more diagnostics

## Project Layout

This repository is mainly divided into:

- `packages/core`

  Agent execution, routing, work queue, recovery, delivery, setup logic, channel integration, MCP, and tool system
- `packages/cli`

  Daemon execution and local command entry points
- `packages/webui`

  Setup UI, chat UI, task monitor, and approval/cancel/review screens

## Quick Start

### Requirements

- `macOS` `(currently the only officially supported OS)`
- Node.js `22+`
- `pnpm`
- Rust / Cargo `(required when running Yeonjang from source)`

### Install

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Run Locally

```bash
bash scripts/start-local.sh
```

Default addresses after startup:

- Gateway: `http://127.0.0.1:18888`
- WebUI: `http://127.0.0.1:5173`

Stop:

```bash
bash scripts/stop-local.sh
```

### Run Yeonjang Extension `(Required)`

Starting Nobie alone is not enough for local control features. At the moment, the following capabilities require `Yeonjang` to be running:

- command execution
- app launch
- screen capture
- camera capture
- keyboard input, shortcut, and key actions
- mouse move, click, scroll, and button actions

Recommended startup order:

1. Start the Nobie Gateway and WebUI.

```bash
bash scripts/start-local.sh
```

2. In another terminal, start the Yeonjang GUI.

```bash
cargo run --manifest-path Yeonjang/Cargo.toml
```

If you need camera capture on macOS, prefer the bundled app path below instead of plain `cargo run`, because the camera helper is packaged next to the app executable.

```bash
bash scripts/start-yeonjang-macos.sh
```

3. In Yeonjang, verify the default broker values.

- Host: `127.0.0.1`
- Port: `1883`
- Default Node ID: `yeonjang-main`

4. Enable the MQTT connection in the Yeonjang GUI.

With the default settings, auto-connect is enabled, and Nobie should detect the extension once the connection succeeds.

5. Check the extension connection state from Nobie's Settings screen or runtime status panel.

Until this connection is established, Nobie's local control features will not complete successfully. In the current architecture, those operations fail if `Yeonjang` is not running.

Notes:

- `cargo run --manifest-path Yeonjang/Cargo.toml -- --stdio` is for standalone node testing.
- For normal Nobie usage, the expected path is the MQTT-connected Yeonjang GUI/runtime.
- On macOS, `camera.capture` uses a fixed helper executable inside `Yeonjang.app`, so `scripts/start-yeonjang-macos.sh` is the safest path when camera capture is required.

## Detailed Telegram / Slack Connection Guide

This section explains, step by step, how to obtain the real values needed for channel connection, such as `Bot Token`, `App Token`, `user ID`, `chat ID`, and `channel ID`.

Important:

- Treat Telegram and Slack tokens like passwords.
- You can type IDs and tokens directly into Nobie, but real production values should never be committed to Git.
- If Nobie is already running with the same Telegram bot token, calling `getUpdates` manually can return `409 Conflict`. In that case, stop Nobie briefly before checking.

### Telegram Setup

#### 1. Create a Telegram bot

1. Open `@BotFather` in Telegram.
2. Send `/newbot`.
3. Enter a bot name and a bot username.
4. Copy the `Bot Token` returned by BotFather.

Example:

- `1234567890:AA...`

This value goes into Nobie's `Telegram Bot Token` setting.

#### 2. Start a 1:1 chat with the bot

1. Search for the bot you just created in Telegram.
2. Open the bot's direct chat.
3. Send `/start` once.

Why this matters:

- Telegram bots usually cannot message a user who has never interacted with them.
- `getUpdates` is also much easier to inspect after an actual chat has started.

#### 3. Get your Telegram user ID

The most direct method is `getUpdates`.

1. If Nobie is currently running with the same bot token, stop it briefly.
2. Call this URL in a browser or terminal:

```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

3. In the returned JSON, find:

- `result[].message.from.id`

That value is the Telegram user ID to place in `allowedUserIds`.

Example:

```json
{
  "message": {
    "from": {
      "id": 42120565
    }
  }
}
```

In this example, the user ID is `42120565`.

#### 4. Get a Telegram group / chat ID

1. Invite the bot to the target group.
2. Send at least one message in that group.
3. Call:

```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

4. In the returned JSON, find:

- `result[].message.chat.id`

That value is the group or chat ID.

Example:

```json
{
  "message": {
    "chat": {
      "id": -1001234567890,
      "title": "Team Operations"
    }
  }
}
```

In this example, the chat ID is `-1001234567890`.

Notes:

- Direct chats usually have positive IDs.
- Groups and supergroups usually have negative IDs.
- Supergroups often use the `-100...` format.

#### 5. If the bot does not respond in a Telegram group

1. Use `@BotFather` and check `/setprivacy` for the bot.
2. If the bot must read ordinary group messages, privacy mode may need to be disabled.
3. Confirm that Nobie's `allowedUserIds` and `allowedGroupIds` match the real values.
4. Confirm that no other process is using the same bot token.

If you see this error, it is usually a duplicate long polling process:

- `409: Conflict: terminated by other getUpdates request`

### Slack Setup

#### 1. Create a Slack app

1. Open the Slack API dashboard.
2. Create a new app for your workspace.
3. Give it a clear app name.

You will use this single app for Nobie's Slack channel connection.

#### 2. Get the Slack Bot Token

1. Open the app settings.
2. Go to `OAuth & Permissions`.
3. Install the app to your workspace if it is not installed yet.
4. Copy the `Bot User OAuth Token`.

Example format:

- `xoxb-...`

This value goes into Nobie's `Slack Bot Token`.

#### 3. Get the Slack App Token

1. In the app settings, open `Basic Information`.
2. Scroll to `App-Level Tokens`.
3. Create a token with `connections:write`.
4. Copy the token.

Example format:

- `xapp-...`

This value goes into Nobie's `Slack App Token`.

#### 4. Enable Socket Mode

1. In the Slack app settings, open `Socket Mode`.
2. Turn it on.
3. Make sure the app token created above is active.

Nobie currently expects Slack to be connected through Socket Mode.

#### 5. Enable Event Subscriptions

1. Open `Event Subscriptions`.
2. Turn events on.
3. Add the event types Nobie needs.

Recommended minimum:

- `app_mention`
- `message.im`

Optional, depending on your usage:

- `message.channels`
- `message.groups`

Meaning:

- `app_mention`: needed when users say `@Nobie ...` in a channel
- `message.im`: needed for direct messages
- `message.channels` / `message.groups`: needed if you want broader message handling in channels or private groups

#### 6. Enable Interactivity for approval buttons

1. Open `Interactivity & Shortcuts`.
2. Turn `Interactivity` on.

Nobie uses Slack button interactions for approval flows such as:

- approve
- approve once
- deny

If Interactivity is disabled, the approval buttons may not work even if they are shown.

#### 7. Invite the bot to the target Slack channel

1. Open the Slack channel you want Nobie to use.
2. Invite the bot application into that channel.
3. Send a test mention such as:

```text
@Nobie hello
```

If the bot is not in the channel, Nobie will not receive the relevant channel events.

#### 8. Get the Slack user ID

One easy method:

1. Open the user's profile in Slack.
2. Open the menu for that profile.
3. Use `Copy member ID` or the equivalent menu item.

The copied value looks like:

- `U0123456789`

That is the value for Nobie's `slackAllowedUserIds`.

#### 9. Get the Slack channel ID

One easy method:

1. Open the target Slack channel in a browser.
2. Look at the URL.

Example:

```text
https://app.slack.com/client/T12345678/C23456789
```

In this example:

- workspace/team ID: `T12345678`
- channel ID: `C23456789`

That channel ID is the value for Nobie's `slackAllowedChannelIds`.

You can also use Slack's UI menus to copy the channel ID, depending on your workspace UI version.

#### 10. If Slack does not respond

Check these items in order:

1. `Slack Enabled` is turned on in Nobie settings.
2. Both `Slack Bot Token` and `Slack App Token` are correct.
3. `Socket Mode` is enabled in the Slack app.
4. `Event Subscriptions` includes `app_mention` and/or `message.im`.
5. `Interactivity` is enabled if approval buttons are expected.
6. The bot has been invited to the actual target channel.
7. `slackAllowedUserIds` and `slackAllowedChannelIds` match the real values.
8. Nobie has been restarted after the settings change.

### Which values go into Nobie settings

Telegram:

- `Telegram Bot Token` -> BotFather token
- `allowedUserIds` -> Telegram `message.from.id`
- `allowedGroupIds` -> Telegram `message.chat.id`

Slack:

- `Slack Bot Token` -> `xoxb-...`
- `Slack App Token` -> `xapp-...`
- `slackAllowedUserIds` -> Slack member ID such as `U0123456789`
- `slackAllowedChannelIds` -> Slack channel ID such as `C23456789`

If you leave allowlists empty, the channel may behave more openly depending on the current runtime rules, but in production it is safer to enter explicit user IDs and channel IDs.

## State Directory and Config Files

The default state directory follows this priority:

- `NOBIE_STATE_DIR`
- default `~/.nobie`

It stores:

- config files
- setup state
- local database
- auth tokens and runtime state
- some local artifacts such as screenshots and extension-produced files

## Planned

The following items should still be treated as `not yet implemented` or `partially implemented`:

- Slack channel integration
- stronger Windows/Linux installation and operations support `(partially implemented, needs more validation)`
- broader validation of UI automation outside macOS `(partially implemented, needs more validation)`
- further setup UX simplification and onboarding improvements
- expanded operations and user-help documentation

## One-line Definition

`Sponzey Nobie` is an orchestration-first personal AI platform that runs on the user's computer and uses configured AI backends plus connected tools to understand requests, choose execution paths, perform real work, deliver results, and decide completion correctly.
