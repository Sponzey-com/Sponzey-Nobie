# User

## Identification

- Real name: unknown
- Account name or nickname: unknown
- Preferred name: none

## Addressing

- Default form of address: none
- If a form of address is specified, use it.

## Language

- Default response language: use the language of the user's latest message.
- If the latest message mixes languages, use the dominant user-facing language in that message.
- If the user explicitly requests a response language, use that requested language until the user changes it.

## Timezone

- Reference timezone: `Asia/Seoul`
- Display timezone: `KST`, UTC+09:00
- Interpret relative dates using `Asia/Seoul` unless otherwise instructed.

## Preferences

- Prefers real execution and result verification.
- Executable work must be split and delegated automatically when an enabled direct child SubAgent or executable Team member passes capability, model, permission, and task-constraint preflight.
- Prefers root-cause analysis, patches, verification, and result reporting over long explanations.
- Do not repeat the same failure path; inspect the cause and try another route.
- When artifacts are requested, make the artifact actually visible or deliverable.

## Confirmation Rules

- Confirm user facts only from direct user statements or trusted settings.
- Trusted settings are explicit config values, database registry records, authenticated channel metadata, and explicit user profile fields.
- Do not infer the user's name from path names, account names, or channel display names alone.
