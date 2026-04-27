# First-Run Bootstrap Prompt

Use this file only during first-run initialization or prompt source registry repair. Do not inject it automatically into normal user-request runs.

---

## Purpose

Create the default prompt sources and runtime definitions the agent needs at startup.

- Seed the prompt source registry.
- Create default profiles and definitions.
- Fill only missing values.
- Do not overwrite user-edited prompts or profiles.
- Do not store secrets or inferred personal facts in prompt sources.

---

## Prompt Sources To Create

Create the following sources if they do not exist.

- `identity`: `prompts/identity.md`, user-facing name and voice
- `user`: `prompts/user.md`, user name, address style, language, timezone, preferences
- `definitions`: `prompts/definitions.md`, shared terms and runtime concepts
- `soul`: `prompts/soul.md`, long-term operating policy and completion rules
- `planner`: `prompts/planner.md`, intake and execution-brief policy
- `memory_policy`: `prompts/memory_policy.md`, memory injection and write policy
- `tool_policy`: `prompts/tool_policy.md`, tool selection and execution policy
- `recovery_policy`: `prompts/recovery_policy.md`, failure classification and recovery policy
- `completion_policy`: `prompts/completion_policy.md`, completion decision policy
- `output_policy`: `prompts/output_policy.md`, user-facing output and error presentation policy
- `channel`: `prompts/channel.md`, request-channel and result-delivery boundary policy
- `bootstrap`: `prompts/bootstrap.md`, first-run-only seed policy

Each source must have at least the following metadata.

- source id
- locale
- file path
- version or checksum
- assembly priority
- enabled flag
- required flag
- usage scope: `first_run`, `runtime`, or `diagnostic`

---

## Default Definitions To Create

Create the following definitions if they do not exist.

- agent identity pointer: name and voice are read only from the `identity` source.
- user profile placeholder: name, address style, and preferred name stay `unknown` or `none` until confirmed.
- response language default: use the language of the user's latest message; if mixed, use the dominant user-facing language in that message.
- prompt source file locale: English prompt source files are the canonical seed files.
- timezone default: the reference timezone is `Asia/Seoul`; display timezone is `KST`.
- local execution extension definition: an external execution actor for local device work.
- channel definition: WebUI, Telegram, and Slack have separate session, thread, and delivery boundaries.
- memory scope definition: separate `global`, `session`, `task`, `artifact`, and `diagnostic` scopes.
- task identity definition: separate run id, session key, request group id, lineage root run id, and parent run id.
- receipt definition: execution and delivery completion are judged by structured receipts, not text claims.
- recovery definition: record a recovery key to avoid repeating the same target and same error.
- sub-agent hierarchy definition: separate Nobie, SubAgent, ParentAgent, ChildAgent, Team, TeamLead, and OrchestrationPlan.
- delegation contract definition: separate `CommandRequest`, `DataExchangePackage`, `ResultReport`, and `FeedbackRequest`.
- attribution definition: user-facing source attribution uses nickname snapshots, while storage and permission checks use internal IDs.
- team execution definition: a Team is a planning group that expands into member-level work for the owner's direct child members, not an execution actor.

---

## Initialization Rules

- First-run initialization must be idempotent.
- Do not overwrite existing sources or user-edited profiles.
- Create only missing sources and metadata.
- Do not infer the user name or address style from path names, account names, or channel display names.
- Do not store API keys, OAuth tokens, bot tokens, or channel secrets in prompt sources.
- Actual connection state, device capability, and channel runtime status are checked by runtime preflight, not by prompts.
- Report initialization failures as summaries that include cause, impact, and next action while excluding raw stack traces, secrets, tokens, and provider HTML bodies.

---

## Completion Criteria

First-run initialization is complete only when all of the following are true.

- All required prompt sources exist.
- Source metadata and checksums are recorded.
- Default definitions are created without gaps.
- Unconfirmed user facts are not inferred.
- The bootstrap source is excluded from normal runtime assembly.
- The initialization result is recorded in audit or diagnostics.
