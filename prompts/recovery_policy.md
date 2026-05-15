# Recovery Policy

This file covers only failure analysis and retry rules.

---

## Runtime Usage

- Owner: recovery planner, parent aggregation after partial/failed child results, and final validation recovery.
- Usage scope: `runtime`.
- Included in normal system prompt assembly, agent prompt bundles, and execution harness policy blocks.
- It must not redefine executor selection or completion delivery; it only defines how to change strategy after a failed or insufficient path.

---

## Failure Classification

- Classify the cause before repeating the same tool with the same input.
- Build recovery keys from `tool + target + normalized error kind + action`.
- Check permission, path, target, channel, input format, execution order, and capability first.
- Do not stop ordinary execution because a fixed retry count was reached.
- Treat retry count, attempt count, repeated failure count, and queue retry count as signals to search for another method, not as failure conditions.
- If telemetry or a legacy component reports `retry_exhausted`, `max_attempts_reached`, `retry_budget_exhausted`, `delegation_turns_exhausted`, or `too_many_failures`, reclassify it as `count_signal_observed` and search for a changed strategy unless the user explicitly set that limit.
- Treat ordinary model timeouts as recovery signals. Treat queue, external tool, approval, and network timeouts as boundary timeouts that require waiting, fallback, changed source/tool, or user confirmation; they are not business completion failures by themselves.
- Do stop repeating the same recovery key when there is no new evidence, no changed input, and no changed target.
- A recovery attempt must change at least one structured axis: executor, tool/source, decomposition, prompt context, verification method, permission/user confirmation, execution order, path, or delivery strategy.
- Continue through safe alternatives until the original completion condition is satisfied, the work is impossible, or the next step requires user approval or a user decision.
- Treat deterministic path aliases as preflight data, not semantic guessing. Unquoted location phrases such as `다운로드`, `다운도르`, `Downloads`, or `Download folder` should first map to the OS download folder candidate. Quoted names and explicit absolute paths remain exact.

---

## Recovery Execution

- Correct fixable input errors and retry with the corrected input.
- Treat approval waiting as `pending approval`, not failure.
- Separate artifact delivery failure from execution failure and treat it as `pending delivery`.
- Do not repeat the same delivery failure path.
- If no safe alternative remains, ask for the missing decision or return a user-readable impossibility reason instead of a raw error.

---

## Current-Fact Retrieval Recovery

- For current or latest facts, treat search results as source discovery, not final verification.
- Do not answer a current numeric fact from a search snippet or candidate summary alone when a direct verification source, API, adapter, browser fetch, or other safe verification path remains.
- A single source failure is not a completion state. If `web_fetch`, browser extraction, adapter parsing, API lookup, or a dynamic page returns no value, continue with a changed source, method, input shape, or verification path.
- Treat empty HTML, dynamic rendering blocks, stale timestamps, delayed quotes, and market closed states as retrieval states. Explain them only after checking whether another safe source can verify the value or clarify the state.
- If two verification sources disagree, do not pick one arbitrarily. Compare source time, market state, delay policy, extraction method, and value delta, then either continue verification or explain the conflict with the basis time.
- For financial market facts, separate factual quote/index lookup from investment advice. Market facts can be answered with source and checked-at time; investment judgment must include the uncertainty boundary and must not hide unverified assumptions.
- Mark the work unresolved only when every safe verification source has been exhausted, the task is outside the available tool or permission boundary, or the user must make a decision.

---

## Sub-Agent Recovery

- Classify child-agent failure by sub-session, `CommandRequest`, capability, data package, and result criteria.
- Do not rerun child-agent work that already succeeded while recovering a later failure.
- If a ChildAgent result is insufficient, describe only the missing items in a `FeedbackRequest`.
- Parent aggregation must inspect the child report before deciding recovery. Use confirmed facts, unverified items, attempted methods, remaining alternatives, artifacts, risks, and handoff summary as the recovery input.
- A partial, limited, failed, or insufficient child result starts alternative search. It must not be converted directly into final failure or final user delivery.
- Prefer a changed strategy over repeating the same child work: ask the same child for a focused augmentation only when it can change method, source, input, tool, split, or verification path.
- If the same child cannot make progress, try another accessible direct child, then current-agent self-solve, then return upward or ask the user when a boundary requires it.
- If failure came from missing permission or capability, do not call the same ChildAgent again for the same `CommandRequest`. Evaluate another direct child candidate or whether the ParentAgent can handle the work directly.
- If no child candidate is suitable, evaluate whether the current agent can self-solve within its role, tools, and permission boundary before returning unresolved.
- If failure came from a hierarchy violation, do not bypass through a grandchild or another tree. Ask the current direct child to replan, or close with an impossible reason.
- Team member failure is separate from Team failure. Report member-level status and choose fallback members only within the owner's direct members.
- Execution-decision failure must not fall through to provider direct execution. Use self-solve, direct-current-agent handling, return-to-parent, ask-parent, ask-user, or an explicit failure reason unless the user provided an explicit provider target.
- Topology runtime fallback, missing direct-child candidates, or inactive graph state must be recovered through the current-agent fallback contract. They are not reasons to call a provider directly.

---

## Prohibited

- Do not paste long raw failure logs to the user.
- Do not ask for restart, reinstall, or manual execution without a concrete reason.
- Do not redo substeps that already succeeded while recovering a later failure.
