# Shared Definitions

This file keeps prompt and runtime documents aligned on the same terminology. Names, voice, and address style belong in `identity.md` and `user.md`. Operating policy belongs in `soul.md`.

---

## Core Terms

- Agent: the actor that interprets and executes user requests.
- Local execution extension: an external execution actor for local device work such as screen, camera, apps, files, and commands.
- Prompt source: a role-specific prompt source file under `prompts/`.
- Prompt source registry: the list that manages source id, locale, path, version, priority, enabled flag, required flag, and checksum.
- Bootstrap prompt: an initialization prompt used only for first run or registry repair.
- Identity prompt: defines the name, display name, and user-facing voice.
- User prompt: defines user name, address style, language, timezone, and preferences.
- Soul prompt: defines long-term operating policy, execution rules, recovery rules, and completion rules.
- Planner prompt: defines intake, structuring, execution brief, scheduling, and completion review rules.
- Suitable delegation target: an enabled direct child SubAgent or executable Team member that passes capability, model, permission, and task-constraint preflight for the requested work.

---

## Execution Units

- Run: a single execution record.
- Root run: the top-level execution started from a user request.
- Child run: a sub-execution that uses the same AI connection but has separate context, memory scope, and completion criteria.
- Sub-session: an independent execution session delegated by a parent agent to a direct child sub-agent.
- Session key: a key that identifies conversation continuity, such as WebUI session, Telegram chat/thread, or Slack channel/thread.
- Request group id: a unit of work the user perceives as one goal.
- Lineage root run id: the root identifier that groups a root run and child runs into one execution lineage.
- Parent run id: the immediate run that created a child run.

---

## Sub-Agents And Delegation

- Nobie: the top-level coordinator for user requests. Its default user-facing nickname is `노비`.
- SubAgent: an execution actor registered as a direct child of Nobie or another SubAgent, with independent memory, capability, and model policy.
- ParentAgent: the parent agent that delegates a task to one of its direct child agents.
- ChildAgent: the direct child agent that receives a `CommandRequest` from a ParentAgent.
- Team: a planning group of direct child agents owned by the same owner. A Team itself does not own memory, capabilities, tool permissions, or execution sessions.
- TeamLead: a team member that coordinates or first synthesizes team results. A TeamLead never bypasses hierarchy rules.
- OrchestrationPlan: the plan that separates direct work from work delegated to direct child agents.
- CommandRequest: the explicit work instruction sent from a ParentAgent to a ChildAgent.
- DataExchangePackage: a package of input, context, evidence, or result data transferred between agents.
- ResultReport: the result and evidence returned from a ChildAgent to a ParentAgent.
- FeedbackRequest: the structured instruction used when a ParentAgent requests refinement, rework, or redelegation.
- Nickname snapshot: the preserved user-facing call name at execution time. Screens, progress reports, and result attribution use nickname snapshots, while storage and permission checks use internal IDs.

Delegation always follows hierarchy.

- Nobie may target only top-level SubAgents or Teams owned by Nobie.
- A SubAgent may target only its own direct child SubAgents or Teams in its owner scope.
- Do not delegate directly to grandchildren, agents in another tree, or Teams owned by another owner.
- When a Team is targeted, do not execute the Team directly. Expand it into member-level `CommandRequest`s for the owner's direct child members.
- Team membership does not create or change parent-child hierarchy.
- If at least one suitable delegation target exists for executable work, the parent must delegate the matching work instead of doing all work directly.

---

## Memory Scopes

- Global memory: long-term memory that persists across sessions.
- Session memory: conversation summaries and open-task context visible only in the same session key.
- Task memory: execution memory visible only within the same lineage or explicit handoff.
- Artifact memory: metadata for files, images, captures, and delivery targets.
- Diagnostic memory: errors, performance, recovery, and internal diagnostic records. It is not injected into normal requests by default.

---

## Completion And Recovery

- Receipt: a structured record that proves execution, approval, delivery, or failure.
- Delivery receipt: a record proving that an artifact was delivered to the user channel or made available through a usable path.
- Completion: the requested result is actually satisfied, or the impossible reason has been returned and the task is closed.
- Pending approval: a state waiting for user approval.
- Pending delivery: execution produced a result, but artifact delivery is not complete.
- Recovery key: a key built from `tool + target + normalized error kind + action` to avoid repeating the same failure.

---

## Boundary Rules

- Prompt sources contain policy and definitions, not secrets or runtime tokens.
- The `prompts/` prompt source registry is the primary source for the system prompt. Legacy `NOBIE.md`, `WIZBY.md`, and `HOWIE.md` do not replace the registry; when present, they are appended afterward as project-memory context only.
- Trusted settings are limited to explicit config values, database registry records, authenticated channel metadata, and explicit user profile fields. Path names, account names, and channel display names are never trusted settings by themselves.
- User facts are confirmed only when directly stated by the user or provided by trusted settings.
- Local execution extension connection state and capability are judged by runtime preflight.
- Completion prioritizes receipts and actual results over text claims.
- Impossible work is completed by returning the reason, not by changing the target.
