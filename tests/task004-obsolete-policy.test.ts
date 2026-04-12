import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

describe("task004 obsolete policy guard", () => {
  it("keeps process documents synced with task/delivery/completion policy", () => {
    expect(readRepoFile(".tasks/task004.md")).toContain("문서 동기화 완료")
    expect(readRepoFile("packages/core/src/runs/source.md")).toContain("lineageRootRunId")
    expect(readRepoFile("packages/webui/src/pages/source.md")).toContain("`/api/tasks` projection")
  })

  it("keeps task projection and monitor route as the primary user-facing path", () => {
    expect(readRepoFile("packages/core/src/api/routes/runs.ts")).toContain('"/api/tasks"')
    expect(readRepoFile("packages/webui/src/pages/RunsPage.tsx")).toContain("buildTaskMonitorCards(tasks, runs, text)")
    expect(readRepoFile("packages/webui/src/pages/ChatPage.tsx")).toContain("resolvePendingInteractionForSession")
  })

  it("does not reintroduce webui fallback or request-group regroup dead paths", () => {
    const apiClient = readRepoFile("packages/webui/src/api/client.ts")
    const chatPage = readRepoFile("packages/webui/src/pages/ChatPage.tsx")
    const taskMonitor = readRepoFile("packages/webui/src/lib/task-monitor.ts")

    expect(apiClient).not.toContain("sendMessage:")
    expect(chatPage).not.toContain("api.sendMessage(")
    expect(chatPage).not.toContain("legacyError")
    expect(taskMonitor).not.toContain("runsByRequestGroupId")
    expect(taskMonitor).not.toContain("run.requestGroupId || run.id")
  })
})
