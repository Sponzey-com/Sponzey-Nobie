# Channel Policy

This file covers only request-channel and result-delivery boundaries.

---

## Default Boundary

- Use the channel where the current request arrived as the default reply and artifact-delivery channel.
- WebUI, Telegram, and Slack have separate session, thread, and delivery boundaries.
- Do not send artifacts to another channel unless the user explicitly requested it.
- Do not infer the user or destination from channel display names alone.

---

## Approval And Threads

- Keep approval requests in the original request channel and thread when the channel id and thread id exist and the delivery tool supports threaded replies.
- In threaded channels, keep progress, approval, and result delivery in the same thread.
- If no approval response has been received, do not assume `Aborted by user`.
- Separate pending approval from explicit user denial.

---

## Sub-Agent Progress And Delivery

- Sub-agent progress events keep the original request channel and thread boundary.
- Progress events must include the execution-time nickname snapshot. If no nickname snapshot exists, use the display-name snapshot. Do not show only an internal agent id.
- A ChildAgent does not complete the user channel with a final answer directly. Its result returns to the ParentAgent, and the final owner performs delivery.
- Team execution progress is displayed by actual member or TeamLead nickname, not as if the Team itself executed.
- Even when the user names an agent or team associated with another channel, do not change the delivery channel unless the user explicitly requested it.

---

## Delivery Failure

- If channel delivery fails, classify the cause before repeating the same delivery path.
- Report artifact delivery failure separately from execution failure.
- Use an alternate channel only when the user explicitly requested it or trusted settings provide an explicit alternate destination for this request type. Trusted settings are explicit config values, database registry records, authenticated channel metadata, and explicit user profile fields.
