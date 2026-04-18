import { create } from "zustand"
import { api } from "../api/client"
import type { OperationsSummary, StaleRunCleanupResult } from "../contracts/operations"
import type { RootRun } from "../contracts/runs"
import type { TaskModel } from "../contracts/tasks"
import { useConnectionStore } from "./connection"

interface RunsState {
  initialized: boolean
  loading: boolean
  lastError: string
  runs: RootRun[]
  tasks: TaskModel[]
  operationsSummary: OperationsSummary | null
  selectedRunId: string | null
  ensureInitialized: (force?: boolean) => Promise<void>
  refresh: () => Promise<void>
  refreshOperations: () => Promise<void>
  selectRun: (runId: string) => void
  createRun: (message: string, sessionId?: string) => Promise<{ requestId: string; runId: string; sessionId: string; source: string; status: string; receipt?: string }>
  cancelRun: (runId: string) => Promise<void>
  deleteRunHistory: (runId: string) => Promise<{ deletedRunCount: number }>
  clearHistoricalRunHistory: () => Promise<{ deletedRunCount: number }>
  cleanupStaleRuns: () => Promise<StaleRunCleanupResult>
  upsertRun: (run: RootRun) => void
  replaceRun: (run: RootRun) => void
}

function sortRuns(runs: RootRun[]): RootRun[] {
  return [...runs].sort((a, b) => b.updatedAt - a.updatedAt)
}

function sortTasks(tasks: TaskModel[]): TaskModel[] {
  return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)
}

function resolveSelectedRunId(params: {
  currentSelectedRunId: string | null
  tasks: TaskModel[]
  runs: RootRun[]
}): string | null {
  const { currentSelectedRunId, tasks, runs } = params
  if (!currentSelectedRunId) return tasks[0]?.id ?? runs[0]?.id ?? null

  const hasMatchingTask = tasks.some((task) => task.id === currentSelectedRunId || task.latestAttemptId === currentSelectedRunId)
  if (hasMatchingTask) return currentSelectedRunId

  const hasMatchingRun = runs.some((run) => run.id === currentSelectedRunId)
  if (hasMatchingRun) return currentSelectedRunId

  return tasks[0]?.id ?? runs[0]?.id ?? null
}

export const useRunsStore = create<RunsState>((set, get) => {
  let refreshTasksTimer: ReturnType<typeof setTimeout> | null = null
  let latestRunsSnapshotToken = 0
  let latestTasksSnapshotToken = 0
  let latestOperationsSnapshotToken = 0

  async function refreshOperationsSnapshot(): Promise<void> {
    const operationsSnapshotToken = ++latestOperationsSnapshotToken
    const response = await api.runOperationsSummary()
    if (operationsSnapshotToken !== latestOperationsSnapshotToken) return
    set({ operationsSummary: response.summary })
  }

  async function refreshTasksSnapshot(): Promise<void> {
    const taskSnapshotToken = ++latestTasksSnapshotToken
    const [response, operationsResponse] = await Promise.all([api.tasks(), api.runOperationsSummary()])
    if (taskSnapshotToken !== latestTasksSnapshotToken) return
    set((state) => ({
      tasks: sortTasks(response.tasks),
      operationsSummary: operationsResponse.summary,
      selectedRunId: resolveSelectedRunId({
        currentSelectedRunId: state.selectedRunId,
        tasks: response.tasks,
        runs: state.runs,
      }),
    }))
  }

  function queueTasksRefresh(): void {
    if (refreshTasksTimer) clearTimeout(refreshTasksTimer)
    refreshTasksTimer = setTimeout(() => {
      refreshTasksTimer = null
      void refreshTasksSnapshot().catch(() => {
        // keep the latest raw runs even if task projection refresh fails transiently
      })
    }, 50)
  }

  return {
    initialized: false,
    loading: false,
    lastError: "",
    runs: [],
    tasks: [],
    operationsSummary: null,
    selectedRunId: null,
    ensureInitialized: async (force = false) => {
      if (!force && (get().initialized || get().loading)) return
      const runsSnapshotToken = ++latestRunsSnapshotToken
      const tasksSnapshotToken = ++latestTasksSnapshotToken
      const operationsSnapshotToken = ++latestOperationsSnapshotToken
      set({ loading: true })
      try {
        const [runsResponse, tasksResponse, operationsResponse] = await Promise.all([api.runs(), api.tasks(), api.runOperationsSummary()])
        if (
          runsSnapshotToken !== latestRunsSnapshotToken
          || tasksSnapshotToken !== latestTasksSnapshotToken
          || operationsSnapshotToken !== latestOperationsSnapshotToken
        ) {
          return
        }
        set({
          runs: sortRuns(runsResponse.runs),
          tasks: sortTasks(tasksResponse.tasks),
          operationsSummary: operationsResponse.summary,
          selectedRunId: resolveSelectedRunId({
            currentSelectedRunId: get().selectedRunId,
            tasks: tasksResponse.tasks,
            runs: runsResponse.runs,
          }),
          initialized: true,
          loading: false,
          lastError: "",
        })
      } catch (error) {
        if (
          runsSnapshotToken !== latestRunsSnapshotToken
          || tasksSnapshotToken !== latestTasksSnapshotToken
          || operationsSnapshotToken !== latestOperationsSnapshotToken
        ) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        useConnectionStore.getState().setDisconnected(message)
        set({ loading: false, initialized: true, lastError: message })
      }
    },
    refresh: async () => {
      await get().ensureInitialized(true)
    },
    refreshOperations: async () => {
      await refreshOperationsSnapshot()
    },
    selectRun: (runId) => set({ selectedRunId: runId }),
    createRun: async (message, sessionId) => {
      const response = await api.createRun(message, sessionId)
      set({ selectedRunId: response.runId })
      void get().refresh()
      return response
    },
    cancelRun: async (runId) => {
      const response = await api.cancelRun(runId)
      get().replaceRun(response.run)
    },
    deleteRunHistory: async (runId) => {
      const response = await api.deleteRunHistory(runId)
      set((state) => ({
        selectedRunId: state.selectedRunId === runId ? null : state.selectedRunId,
      }))
      await get().refresh()
      return { deletedRunCount: response.deletedRunCount }
    },
    clearHistoricalRunHistory: async () => {
      const response = await api.clearHistoricalRunHistory()
      await get().refresh()
      return { deletedRunCount: response.deletedRunCount }
    },
    cleanupStaleRuns: async () => {
      const response = await api.cleanupStaleRuns()
      set({ operationsSummary: response.summary })
      await get().refresh()
      return response.cleanup
    },
    upsertRun: (run) =>
      set((state) => {
        const exists = state.runs.some((item) => item.id === run.id)
        const runs = exists
          ? state.runs.map((item) => (item.id === run.id ? run : item))
          : [run, ...state.runs]
        const isNewRootTask = !exists && run.id === run.requestGroupId
        queueTasksRefresh()
        return {
          runs: sortRuns(runs),
          selectedRunId: isNewRootTask ? run.requestGroupId : (state.selectedRunId ?? run.id),
        }
      }),
    replaceRun: (run) =>
      set((state) => {
        queueTasksRefresh()
        return {
          runs: sortRuns(state.runs.map((item) => (item.id === run.id ? run : item))),
          selectedRunId: state.selectedRunId ?? run.id,
        }
      }),
  }
})

export function getSelectedRun(): RootRun | null {
  const state = useRunsStore.getState()
  return state.runs.find((run) => run.id === state.selectedRunId) ?? null
}
