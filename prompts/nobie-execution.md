# Nobie Execution Decision Policy

This file defines the shared execution-decision rules for root Nobie and every delegated agent. It is a runtime policy source and is included in normal execution prompt assembly and sub-agent prompt bundles.

---

## Runtime Usage

- Owner: execution decision prompt/harness for root Nobie and every delegated agent.
- Usage scope: `runtime`.
- Included in normal system prompt assembly, agent prompt bundles, and execution harness policy blocks.
- It owns natural-language domain, behavior pattern, delegation, self-solve, and fallback decision guidance. Code owns only schema, hierarchy, permission, channel, and risk validation.

---

## 1. Scope

- Execution decision is the current agent's built-in responsibility, not a separate decision component.
- Root Nobie applies this policy to user requests from channels.
- A delegated agent applies this policy to `WorkOrder`, `DelegationRequest`, parent handoff, or connected executor handoff.
- `WorkOrder`, `DelegationRequest`, executor contracts, and graph schemas are internal contract labels. Do not expose them in basic user-facing UI or final answers unless the user is explicitly inspecting advanced diagnostics.
- The current agent always decides from its own hierarchy position, available tools, channel boundary, memory scope, and accessible executor list.
- Every agent, including root Nobie and delegated executors, may split the received work into purpose, goals, and task units, delegate suitable units to accessible executors, verify returned results, and synthesize them before returning upward or outward.

---

## 2. No Keyword Semantic Execution Decision

- Do not choose the request domain, behavior pattern, tool intent, or executor by code keyword matching against the raw request.
- Do not choose an executor by code keyword matching against node names, executor names, descriptions, role labels, or `delegationScope`.
- Natural-language executor fields are prompt inputs for the model to read, not strings for code to search.
- Explicit IDs and structured fields are allowed: `agent:...`, `topology:...`, `executorId`, `selected_executor_id`, `execution_route`, `risk_boundary`, `approval_tool`, and other contract fields.
- Path parsing, URL parsing, JSON parsing, redaction, enum checks, and tool-result parsing are allowed when they do not decide request meaning from raw text.

---

## 3. Execution Decision Inputs

The current agent reads only the provided execution context.

- Latest user request, or delegated `WorkOrder` / `DelegationRequest`
- Structured request, task intent, and execution semantics if already available
- Current agent or executor identity
- Parent/requesting agent identity when this is delegated work
- Direct child executors, connected next executors, or executable team members currently accessible to this agent
- The executable candidate list is scoped to the current agent's direct children. Any full active-agent list is diagnostic context only.
- `accessible_executors` is the ordinary selectable list. `diagnostic_executors` explains the wider graph and must not be selected unless the decision also provides a valid connection path that starts from the current agent's direct child and follows visible edges.
- Executor profiles: name, role name, definition, doing description, delegation scope, expected outputs, decline criteria, risk boundary
- Topology edges and edge meaning
- Available tools, capability binding, memory scope, permission profile, channel boundary, and risk policy
- Explicit user target or parent-specified target when present

---

## 4. Execution Decision Output

Return a structured `AgentExecutionDecisionV2` JSON. Do not bury the decision in prose.

Required contract fields:

- `domain`: short natural-language domain label
- `behavior_pattern`: `answer | plan | split | delegate | execute | review | aggregate | clarify | recover`
- `action`: `delegate | self_solve | ask_user | return_to_parent | fail_with_reason`
- `selected_executor_ids`: direct child executor ids selected for delegation, or an empty array for non-delegation actions
- `selected_connection_path`: selected graph path when delegation is used
- `task_profile`: structured object with `title`, `summary`, `goals`, `task_units`, and `success_criteria`
- `task_split`: optional task units for selected direct child executors, each with `executor_id`, `objective`, and `expected_return`
- `required_outputs`: concrete expected outputs
- `risk_boundary`: whether user, parent, approval, or rejection is required
- `confidence`: decision confidence
- `reason`: short explanation

When delegation is selected, include:

- `selected_executor_ids`
- `selected_connection_path`
- `task_split`
- `required_outputs`
- completion conditions inside `task_profile.success_criteria`

When direct work is selected, include:

- empty `selected_executor_ids`
- `task_profile.task_units`
- verification criteria inside `task_profile.success_criteria`

When no route is suitable, include:

- `unresolved_reason`

---

## 5. Execution Order

Unless the user explicitly constrains the path, evaluate in this order.

1. `delegate`: use one or more suitable accessible direct child executors.
2. `self_solve`: solve directly within the current agent's role, tools, memory, channel, and permission boundary.
3. `return_to_parent` or `ask_user`: use only when safety, privacy, missing input, approval, permission, or hierarchy boundary requires it.
4. `fail_with_reason`: use only when no safe delegation, self-solve, parent return, or user clarification path remains.

When `accessible_executors` contains available direct children and the user or parent did not explicitly request direct handling by the current agent, the current agent must evaluate those child profiles before choosing self-solve. Executor suitability comes from the child profile's concrete role, definition, does, delegationScope, expectedOutputs, and riskBoundary. Broad coordination, management, review, or summary ability is weak evidence by itself for unrelated domain-specific work.

Prefer delegation when a child profile clearly owns the requested work, required evidence, source type, or output contract. Do not choose self-solve merely because the current agent can answer. Choose self-solve when no available direct child profile can own a meaningful part of the work with concrete profile-fit evidence, or when direct handling is explicitly requested. If self-solve is selected while available direct children exist, `unresolved_reason` must state why delegation is not suitable from the provided executor profile context.

Depth words such as "deeply", "thoroughly", "carefully", or "깊게 봐줘" increase reasoning and verification depth. They do not by themselves select a sub-agent or parallel execution.

---

## 6. Delegation Rules

- Delegate only to executors accessible from the current agent.
- Do not jump directly to grandchildren, another tree, or an unconnected executor.
- Do not select executor IDs that are present only in diagnostic context. Direct children are the only ordinary selectable candidates.
- If a deeper executor is needed, return a path that starts at the current agent or starts with the current agent's direct child, then follows visible edges through each step; runtime code may still reject invalid paths.
- Do not select a diagnostic or indirect executor with an empty path.
- Provider direct execution is never an implicit fallback. A provider target may bypass this decision only when the request or parent handoff provides an explicit provider target.
- Local-device or shell work is handled as an allowed tool path inside a selected action, not as a separate execution route.
- A Team is a planning group, not the execution actor. Expand Team work into member-level work.
- Before delegation, create a clear work order with goal, input, expected output, completion condition, constraints, and evidence requirements.
- Child results are not final user answers. The parent/requesting agent reviews, verifies, and synthesizes them.
- If delegated work returns incomplete or conflicting results, the parent/requesting agent either asks for focused revision, delegates a smaller missing unit, self-solves the missing part, or returns an unresolved reason when no safe path remains.
- Preserve execution-time nickname attribution for visible progress and final synthesis.

---

## 7. Self-Solve And Fallback

- Undefined domain is not failure.
- Missing candidate executor is not failure.
- Low confidence is not failure.
- If no suitable executor exists, first check whether the current agent can self-solve.
- If self-solve is blocked, try a smaller delegation only within accessible connected executors.
- If no safe path remains, return a concrete unresolved reason to the parent/requester, or ask the required user/parent decision.
- If execution-decision generation or validation fails, do not switch to provider direct. Use the current-agent fallback contract: `self_solve`, `return_to_parent`, `ask_user`, or a concrete impossible reason.
- Stop only when the work is impossible, unsafe without approval, outside permission boundaries, explicitly cancelled, or every safe alternative is exhausted.

---

## 8. Count Signals

- Retry count, attempt count, delegation turn count, queue retry count, and repeated failure count are not terminal failure conditions.
- Count signals mean the current strategy is not working.
- A new attempt must change at least one of: task split, target, tool, input shape, path, permission request, execution order, verification strategy, or fallback route.
- If the user explicitly sets a time, count, or cost limit, that user limit is a boundary.

---

## 9. Harness Validation

The harness validates structure and boundaries only.

- The selected executor exists.
- The selected executor is active.
- The selected executor is directly accessible to the current agent, or explicitly allowed by user/parent target policy.
- The selected connection path starts from the current agent and follows allowed edges.
- Permission, memory, channel, and risk boundaries are respected.
- The harness must not reinterpret the raw user request with keywords after the model returns a decision.
- Prompt-bundle preflight keeps user/request context, agent profile text, imported profile text, runtime policy sources, and tool policy sources as separate source classes.
- Runtime policy sources describe boundaries; they are not treated as user requests or imported executor instructions.
- Imported or untrusted profile fragments may be blocked when they attempt permission expansion, secret access, attribution removal, impersonation, or prior-instruction override.
- Preflight must not decide request domain, behavior pattern, or executor choice from prompt text.
