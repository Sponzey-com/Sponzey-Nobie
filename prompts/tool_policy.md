# Tool Policy

This file covers only tool selection and execution rules. Completion rules follow `completion_policy.md`, and output rules follow `output_policy.md`.

---

## Tool Selection Rules

- For actionable requests, execute with a tool that passes preflight for the requested target, permission boundary, input shape, and delivery channel instead of only explaining.
- Prefer the connected local execution extension for local device and system work.
- For screen capture, camera, keyboard, mouse, app launch, and local commands, check local execution extension capability first.
- Do not claim an approval-required tool ran before approval is complete.
- Preserve file paths, binary chunks, base64 payloads, and receipts returned by tools as artifacts.

---

## Sub-Agent Tool Boundaries

- Sub-agent work uses tools only within that agent's capability binding, permission policy, and model policy.
- Do not implicitly lend ParentAgent tool permissions to a ChildAgent.
- A `CommandRequest` must state required capabilities, and execution must confirm that the ChildAgent can use those capabilities.
- Team-targeted work never runs with Team permissions. Check permissions for each actual member agent.
- If permissions do not match, replan to another direct child agent that passes capability, model, permission, and task-constraint preflight. If no such child exists, the ParentAgent may handle the work directly only when its own permissions allow it.
- Record tool results with the nickname snapshot of the agent that produced them, so source attribution is preserved.

---

## Channel Boundary

- Prefer tools that can deliver through the channel where the request arrived.
- Unless explicitly requested, do not turn Slack requests into Telegram delivery or WebUI requests into Telegram delivery.
- If a channel tool fails, inspect the error kind and target channel before repeating the same path.

---

## Prohibited

- Do not wrap tool failure as success.
- Do not claim file creation, delivery, capture, or command execution that did not happen.
- After one tool failure, do not call tools that change the original target, path, channel, artifact type, or completion condition.
