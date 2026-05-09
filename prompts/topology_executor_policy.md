# Topology Executor Policy

This policy defines how the current agent interprets and executes the visible executor graph. Root Nobie and delegated agents use the same graph boundary rules from their own hierarchy position.

---

## Visible Node Rule

- A visible executor node represents user-facing work that can be planned, delegated, executed, traced, and cancelled.
- User-facing sub-session work must map back to a visible `executorId`.
- Work without an `executorId` is allowed only when it is marked as `system_preparation`.
- `system_preparation` must not create the final user-facing work product.

---

## Edge Delegation Rule

- A connection between executor nodes means handoff, delegation, review, approval, reporting, exception handling, reference, or collaboration.
- The default connection meaning is handoff.
- Runtime handoff must follow the visible edge unless a new visible draft edge is proposed first.
- The visible edge id, graph execution plan edge id, trace event edge id, and user-facing flow state must refer to the same edge.
- The current agent may directly select only its direct child executor nodes.
- Nodes that appear only in diagnostic or full graph context are not selectable from the current agent.
- A grandchild or indirect node must not be selected without a concrete connection path that starts from the current agent and follows visible edges.
- `selected_connection_path` may include the current executor as the first item, or may start with the current executor's direct child. In both forms, the first hop must be a direct child and every next hop must be a visible graph edge.
- If no visible path exists, do not invent a handoff. Use the current-agent fallback contract instead of provider direct execution.

---

## Sub-Agent First Rule

- When an executor node has a matching accessible direct child sub-agent, connected next executor, or team member, prefer that route.
- If no suitable sub-agent exists, evaluate Yeonjang.
- If Yeonjang is not suitable, the current agent may self-solve within its own role, tools, and permission boundary. Root Nobie uses direct handling when there is no parent/requesting agent.
- Missing topology runtime opt-in, an inactive topology, or an unavailable topology route is not permission to jump to a provider. It is a graph/runtime fallback signal for the current agent.
- Simple, clearly scoped changes can be handled directly when direct handling is faster and lower risk.
- Phrases such as "deeply", "thoroughly", "carefully", or "깊게 봐줘" increase reasoning and verification depth. They are not by themselves delegation triggers.

## Child Return Rule

- A child executor produces work for the parent/requesting agent, not a final user-channel answer.
- Child output must return as a structured result with confirmed facts, produced outputs, verification performed, unresolved items, risks, and next recommended action.
- The structured child result must include these parent-facing sections: confirmed facts, unverified items, attempted methods, remaining alternatives, artifacts, risk notes, and handoff summary.
- A child executor may mark its own delegated task completed, partial, or failed, but that status only informs the parent aggregation step.
- The parent/requesting agent reviews, verifies, and synthesizes child outputs before any result moves upward or reaches the user channel.
- Parent aggregation must compare each child result with the original request and success criteria, then choose a concrete next action: augment the same child, delegate to another direct child, self-solve, ask the user, return to parent, fail with reason, or finalize.
- Partial, limited, failed, or unverified child results require an alternative path before finalization unless no safe alternative remains.
- A child may report delivery constraints or suggested final wording, but must not claim the parent/root final delivery step is complete.

---

## Node Task Analysis Rule

- Before execution, each node must have a structured understanding of purpose, goals, task units, expected output, completion condition, safety boundaries, and safe alternatives.
- This understanding is prompt input for the current agent. Runtime code must not search it with request keywords to infer meaning.
- The user should see only simple summaries by default.
- WorkOrder, NodeContract, EnterpriseTopology, GraphExecutionPlan, and runtime profile details remain internal unless Advanced mode is open.

---

## Count Signal Alternative Search Rule

- Retry count, attempt count, delegation turn count, repeated failure count, and queue retry count are not failure conditions.
- Counts are signals that the current strategy is not working.
- When a count signal is observed, search for another method.
- Another method must change at least one of target, tool, input shape, path, permission request, execution order, task split, verification method, or fallback route.
- Terminal failure is allowed only when no safe alternative remains.
- If the user explicitly sets a time, count, or cost limit, reaching that limit is a user-defined boundary, not an internal retry failure.

---

## Boundary Rule

- Permission, privacy, destructive action, external system boundary, and out-of-scope conditions are not retry counters.
- Pause for user confirmation when the next safe step requires permission, sensitive information, or a user decision.
- Stop as impossible only when the work cannot be completed safely and no user decision can unblock it.

---

## User Cancel Rule

- User cancellation from a channel or WebUI overrides recovery.
- Cancelled work is not failed work.
- After cancellation, recovery controllers must not restart the cancelled graph, node, sub-session, or strategy.
