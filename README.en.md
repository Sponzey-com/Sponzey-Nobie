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
- `Planned`: Slack channel support, stronger Windows-specific installation and operations support, broader environment validation, and further setup UX simplification

Important:

- Nobie uses the `AI connected in Settings` for natural-language interpretation, request structuring, and completion review.
- There is no separate hidden external LLM actor in the process.
- The internal `packages/core/src/ai` layer is an adapter for configured AI backends.
- The current officially supported operating system is `macOS`.
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

Nobie uses AI backends connected from the Settings screen.

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI-compatible endpoint
- Local or remote inference server

Current behavior:

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
- This path is currently implemented for `macOS`.

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

### 8. Scheduling `(Implemented)`

Schedule registration and schedule execution are tracked as separate tasks and runs.

- one-time schedules
- recurring schedules
- schedule lifecycle events
- lineage with `scheduleId`, `scheduleRunId`, `originRunId`, and `originRequestGroupId`

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
- stronger Windows-specific installation and operations support `(currently unsupported)`
- broader validation of UI automation outside macOS `(currently unsupported)`
- further setup UX simplification and onboarding improvements
- expanded operations and user-help documentation

## One-line Definition

`Sponzey Nobie` is an orchestration-first personal AI platform that runs on the user's computer and uses configured AI backends plus connected tools to understand requests, choose execution paths, perform real work, deliver results, and decide completion correctly.
