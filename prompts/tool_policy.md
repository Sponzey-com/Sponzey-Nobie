# Tool Policy

This file covers only tool selection and execution rules. Completion rules follow `completion_policy.md`, and output rules follow `output_policy.md`.

---

## Runtime Usage

- Owner: tool preflight, capability binding, permission boundary, and tool-result handling.
- Usage scope: `runtime`.
- Included in normal system prompt assembly, agent prompt bundles, and execution harness policy blocks.
- It must not choose executors by natural-language keywords. Executor suitability belongs to the execution decision prompt and is validated by hierarchy contracts.

---

## Tool Selection Rules

- For actionable requests, execute with a tool that passes preflight for the requested target, permission boundary, input shape, and delivery channel instead of only explaining.
- Prefer the connected local execution extension for local device and system work.
- For screen capture, camera, keyboard, mouse, app launch, and local commands, check local execution extension capability first.
- Do not claim an approval-required tool ran before approval is complete.
- Preserve file paths, binary chunks, base64 payloads, and receipts returned by tools as artifacts.
- For current or latest facts, treat search as source discovery only. A search snippet can create candidate sources, but it does not certify the final value by itself.
- For current or latest facts, a single `web_fetch`, API, browser, or adapter failure is a signal to try a different source, method, input shape, or verification path before asking the user or ending as not found.
- Dynamic pages, empty HTML, delayed quotes, market closure, and source timestamp gaps are retrieval states. Do not collapse them into generic failure unless every safe verification source is exhausted.

---

## Sub-Agent Tool Boundaries

- Sub-agent work uses tools only within that agent's capability binding, permission policy, and model policy.
- Do not implicitly lend ParentAgent tool permissions to a ChildAgent.
- A `CommandRequest` must state required capabilities, and execution must confirm that the ChildAgent can use those capabilities.
- Team-targeted work never runs with Team permissions. Check permissions for each actual member agent.
- If permissions do not match, replan to another direct child agent that passes capability, model, permission, and task-constraint preflight. If no such child exists, the ParentAgent may handle the work directly only when its own permissions allow it.
- Tool fallback is not keyword-based. It must preserve the original target, channel, artifact type, and completion condition while changing only the execution path, tool, input shape, or permission state.
- Do not maintain language-specific natural-language alias tables for tool fallback, location fallback, or executor fallback. Use structured fields, explicit user-provided identifiers, tool/OS metadata, verified context, or user confirmation instead.
- Provider direct execution is allowed only when the request or parent handoff provides an explicit provider target. It is not the default fallback for execution-decision failure, topology runtime off, or missing direct-child candidates.
- If a prompt proposes `explicit_provider` without an explicit provider target in structured context, the correct next step is current-agent fallback, not provider selection.
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
- After one tool failure, do not change the original target, channel, artifact type, or completion condition.
- You may change the execution path, tool, command shape, or explicit tool-resolved location when that preserves the original requested target, channel, artifact type, and completion condition while avoiding the same failure.
- Do not maintain prompt-level natural-language folder alias lists. Resolve locations only from explicit paths, tool or OS-provided well-known folder metadata, prior verified context, or a user confirmation when the target is ambiguous.
- Do not answer a current numeric fact from a search candidate alone when a direct verification source is still available.
