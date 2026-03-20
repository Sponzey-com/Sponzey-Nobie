# Sponzey Nobie

[한국어](./README.md) | [English](./README.en.md)

<p align="center">
  <img src="./resource/nobie-1-512.png" alt="Nobie" width="220" />
</p>

`Sponzey Nobie` is an orchestration-first personal AI designed to be configured quickly after installation and used right away. The actual assistant name used inside the product is `Nobie`.

The goal of this project is not just to provide a chat AI, but to build a personal work hub that understands requests, selects the right execution path, and continues through real local work and external integrations.

## Product Interpretation

Nobie is best understood in the following way.

- `Personal assistant AI`: It works in the context of the user's computer and working environment.
- `Orchestration-first AI`: It does not just answer; it decides how work should be performed and coordinates the execution flow.
- `Ready after install`: It is being shaped so even non-technical users can configure it step by step in the WebUI and start using it quickly.
- `Extensible work platform`: AI backends, external tools `(MCP)`, task capabilities `(Skill)`, and communication channels are being added in stages.

## Who It Is For

The core target audience for Sponzey Nobie is:

- Users who are not comfortable with computers
- Users unfamiliar with terms like AI, MCP, Skill, or channel integration
- Users who want a personal assistant they can use without complex developer setup

That is why the UI and documentation follow these principles.

- Show simple, approachable Korean first in the product UI.
- Keep original terms in `()` as supporting labels.
- Clearly mark required settings.
- Actions such as Save, Cancel, Skip, and Next must stay simple and obvious.

## Core Features

### 1. AI Backends

Connect the AI models that Nobie uses to respond and perform tasks.

- OpenAI
- Claude
- Gemini
- Ollama
- OpenAI-compatible endpoint
- Local or remote inference server

### 2. External Tools `(MCP)`

Connect MCP servers so Nobie can extend its capabilities with external tools and services.

- Register stdio-based MCP servers
- Inspect available tools
- Distinguish required and optional servers
- Check connection state in Settings

### 3. Skills

Attach instruction bundles and capabilities that help Nobie perform specific kinds of work better.

- Register local skills
- Enable or disable skills
- Show description and source

### 4. Communication Channels

Connect the channels used to talk with Nobie.

- WebUI chat
- Telegram
- Slack planned

### 5. Local Work Execution

Nobie can perform the following tasks on the local computer.

- Read, write, search, and modify files
- Execute shell commands
- Launch apps
- Capture the screen
- Control mouse and keyboard
- Manage work queues, approvals, cancellations, and verification flows

## Setup Experience Direction

The Sponzey Nobie setup experience is being organized around a `1920 x 1080` layout and is still being refined and applied.

The main principles are:

- Each step should be understandable within one screen.
- It should not depend on long scrolling.
- Advanced options should be separated into collapsible sections.
- The left side shows steps, the center shows current input, and the right or bottom shows help and status.
- The bottom action area should remain clearly visible.

The setup order is:

1. Personal information
2. AI connection
3. External tools `(MCP)`
4. Skills
5. Communication
6. Review and finish

## Internal Architecture

Sponzey Nobie does not treat a request as just a single message.

The current architectural direction is:

- `A = Review AI`
- `B-n = Worker AI or worker session`

The role split is:

- `A` is being shaped to review requests, identify what must be done, and decide which execution target should handle the work.
- `B-n` is being shaped to handle actual file creation, execution, verification, and tool use.
- The user-facing work queue is being organized around `one request = one card`, with child tasks attached as a tree.

The purpose of this structure is:

- Prevent multiple requests in the same chat from mixing together
- Track approval, cancellation, follow-up, and verification by request
- Clearly separate root requests from child tasks

## Project Layout

This repository is mainly split into three parts.

- `packages/core`
  - Agent execution, routing, work queue, verification, setup logic, channel integration, MCP, and tool system
- `packages/cli`
  - Daemon execution and local command entry points
- `packages/webui`
  - Setup UI, chat UI, work queue, and approval/cancel/review screens

## Quick Start

### Requirements

- Node.js `22+`
- `pnpm`

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

## State Directory and Config Files

The default state directory follows this priority.

- `NOBIE_STATE_DIR`
- default `~/.nobie`

The following information is stored there.

- Config files
- Setup state
- Local database
- Auth tokens and runtime state

## Current Scope and Notes

The following points describe the current state of the codebase.

- The WebUI-based setup flow and work queue structure are the main focus right now.
- The MCP client currently supports stdio-based servers, and the operational experience is still being improved.
- Telegram is integrated.
- Slack is still planned.
- Some local UI automation and operational flows are more validated on macOS, while support for other environments is still planned.
- Windows has partial code paths, but full installation support is still planned.

In short, Sponzey Nobie already has many working features, but the `task separation architecture`, `verification`, `restart recovery`, and overall `operational experience` are still being actively improved.

## One-line Definition

`Sponzey Nobie` is an orchestration-first personal AI platform that runs on the user's computer, understands requests, chooses the right execution target, and continues through real work and verification.
