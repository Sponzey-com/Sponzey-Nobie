# Recovery Policy

This file covers only failure analysis and retry rules.

---

## Failure Classification

- Classify the cause before repeating the same tool with the same input.
- Build recovery keys from `tool + target + normalized error kind + action`.
- If the same recovery key fails after the one allowed retry, stop automatic repetition and try only a different path.
- Check permission, path, target, channel, input format, execution order, and capability first.
- The same recovery key may be retried at most once after a concrete input, permission, path, order, or target fix.
- If that retry fails, mark the recovery key exhausted and do not invoke it again during the same request lineage.

---

## Recovery Execution

- Correct fixable input errors and retry once under the same recovery key.
- Treat approval waiting as `pending approval`, not failure.
- Separate artifact delivery failure from execution failure and treat it as `pending delivery`.
- Do not repeat the same delivery failure path.
- If no alternative remains, return a user-readable failure reason instead of a raw error.

---

## Sub-Agent Recovery

- Classify child-agent failure by sub-session, `CommandRequest`, capability, data package, and result criteria.
- Do not rerun child-agent work that already succeeded while recovering a later failure.
- If a ChildAgent result is insufficient, describe only the missing items in a `FeedbackRequest`.
- If failure came from missing permission or capability, do not call the same ChildAgent again for the same `CommandRequest`. Evaluate another direct child candidate or whether the ParentAgent can handle the work directly.
- If failure came from a hierarchy violation, do not bypass through a grandchild or another tree. Ask the current direct child to replan, or close with an impossible reason.
- Team member failure is separate from Team failure. Report member-level status and choose fallback members only within the owner's direct members.

---

## Prohibited

- Do not paste long raw failure logs to the user.
- Do not ask for restart, reinstall, or manual execution without a concrete reason.
- Do not redo substeps that already succeeded while recovering a later failure.
