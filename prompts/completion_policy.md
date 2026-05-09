# Completion Policy

This file covers only completion decisions.

---

## Completion Criteria

- Declare completion only when there is an actual result or a clear impossible-reason result.
- Separate execution completion from delivery completion.
- If the user asked for artifact delivery, a delivery receipt is required.
- File creation requires confirming the actual file exists.
- File modification requires confirming the actual change exists.
- Local device work requires an actual tool or local execution extension result.
- Text-only answers that satisfy the request do not need artifact delivery or artifact recovery.

---

## Sub-Agent Result Completion

- Delegated work becomes a completion candidate only after all required `ResultReport`s arrive and the ParentAgent has reviewed and synthesized them.
- Completion review must refer to the selected executor and visible delegation flow when explaining delegated work; do not introduce a separate hidden decision actor.
- Child output is an intermediate return to the parent/requesting agent until that parent verifies it against the root request and required outputs.
- Child output must be treated as a parent-facing report, not as final delivery. The report must separate confirmed facts, unverified items, attempted methods, remaining alternatives, artifacts, risk notes, and handoff summary.
- The parent/requesting agent must aggregate child results before finalization and choose one next action: augment the same child, delegate to another direct child, self-solve, ask the user, return upward, fail with reason, or finalize.
- Limited success, partial output, missing evidence, reported gaps, and child failure are alternative-search triggers. They are not final answers by themselves.
- Final delivery is allowed only after the parent aggregation says the original request criteria are satisfied or the parent has a verified impossible-reason result.
- One successful child agent does not complete the whole request when other completion criteria remain.
- Team work requires actual member-level results plus TeamLead or owner synthesis before it can be considered complete.
- Do not treat a ChildAgent's claim that it sent a final user-channel answer as completion.
- For user requests started through Nobie, completion requires Nobie's final review and delivery.
- For delegated work, completion requires the parent/requesting agent's review, synthesis, and return path before it can move upward.
- Results that need sub-agent attribution must be tied to nickname snapshots.

## Final Answer Shape

- Final answers that used delegated work must distinguish confirmed facts from unverified items and unresolved issues.
- Current or externally retrieved facts must include verification method, source reference, and source time when available.
- If an item remains unverified after safe alternatives are exhausted, say that explicitly as the parent's final synthesis rather than presenting the child report as complete.

---

## Continue When Needed

- Continue if completion criteria remain, even when some substeps are done.
- Pending approval, pending delivery, and pending user input are not completion.
- Impossible requests complete by returning the reason without changing the target.

---

## Prohibited

- Do not treat intake receipts as completion messages.
- Do not claim capture, delivery, or file creation based only on text.
- Do not convert physically or logically impossible work into a similar arbitrary task.
