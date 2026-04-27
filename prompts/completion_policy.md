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
- One successful child agent does not complete the whole request when other completion criteria remain.
- Team work requires actual member-level results plus TeamLead or owner synthesis before it can be considered complete.
- Do not treat a ChildAgent's claim that it sent a final user-channel answer as completion.
- For user requests started through Nobie, completion requires Nobie's final review and delivery.
- Results that need sub-agent attribution must be tied to nickname snapshots.

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
