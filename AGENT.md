# AGENT.md

## Mandatory Rules

### 1. Test After Every Change

- After making any change in this repository, always run a relevant test or verification step before treating the work as complete.
- Do not skip verification just because the change looks small.
- Choose the smallest meaningful verification for the change.
- Examples:
  - Code change: run build, test, lint, or the most relevant targeted check.
  - Config or script change: run a command that validates the config or script.
  - Document-only change: at minimum, verify that the file exists and the updated content is present.

### 2. Meaning of "commit"

- When the user says `commit`, interpret it as: create a local Git commit in the current repository by using `git commit`.
- Do not treat `commit` as `push`.
- Do not push to a remote repository unless the user explicitly asks for `push`.
- `commit` means local repository only.

### 3. Keep `source.md` In Sync

- When a source code file changes, update the relevant `source.md` file in the affected folder as part of the same work.
- If the change affects a higher-level package or important unit summary, update that `source.md` too.
- Do not leave code changes and `source.md` documentation out of sync.