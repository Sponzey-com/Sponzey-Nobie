import { create } from "zustand"
import { api } from "../api/client"
import type { RootRun } from "../contracts/runs"
import { useConnectionStore } from "./connection"

interface RunsState {
  initialized: boolean
  loading: boolean
  lastError: string
  runs: RootRun[]
  selectedRunId: string | null
  ensureInitialized: (force?: boolean) => Promise<void>
  refresh: () => Promise<void>
  selectRun: (runId: string) => void
  createRun: (message: string, sessionId?: string) => Promise<{ runId: string; sessionId: string; status: string }>
  cancelRun: (runId: string) => Promise<void>
  upsertRun: (run: RootRun) => void
  replaceRun: (run: RootRun) => void
}

function sortRuns(runs: RootRun[]): RootRun[] {
  return [...runs].sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useRunsStore = create<RunsState>((set, get) => ({
  initialized: false,
  loading: false,
  lastError: "",
  runs: [],
  selectedRunId: null,
  ensureInitialized: async (force = false) => {
    if (!force && (get().initialized || get().loading)) return
    set({ loading: true })
    try {
      const response = await api.runs()
      set({
        runs: sortRuns(response.runs),
        selectedRunId: get().selectedRunId ?? response.runs[0]?.id ?? null,
        initialized: true,
        loading: false,
        lastError: "",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useConnectionStore.getState().setDisconnected(message)
      set({ loading: false, initialized: true, lastError: message })
    }
  },
  refresh: async () => {
    await get().ensureInitialized(true)
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
  upsertRun: (run) =>
    set((state) => {
      const exists = state.runs.some((item) => item.id === run.id)
      const runs = exists
        ? state.runs.map((item) => (item.id === run.id ? run : item))
        : [run, ...state.runs]
      return {
        runs: sortRuns(runs),
        selectedRunId: state.selectedRunId ?? run.id,
      }
    }),
  replaceRun: (run) =>
    set((state) => ({
      runs: sortRuns(state.runs.map((item) => (item.id === run.id ? run : item))),
      selectedRunId: state.selectedRunId ?? run.id,
    })),
}))

export function getSelectedRun(): RootRun | null {
  const state = useRunsStore.getState()
  return state.runs.find((run) => run.id === state.selectedRunId) ?? null
}
