import { create } from "zustand"
import { api, getControlPlaneAdapterName, type StatusResponse } from "../api/client"

interface ConnectionState {
  adapter: "local"
  connected: boolean
  loading: boolean
  lastError: string
  status: StatusResponse | null
  initialize: (force?: boolean) => Promise<void>
  refresh: () => Promise<void>
  setDisconnected: (message: string) => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  adapter: getControlPlaneAdapterName(),
  connected: false,
  loading: false,
  lastError: "",
  status: null,
  initialize: async (force = false) => {
    if (!force && (get().loading || get().status)) return
    set({ loading: true, adapter: getControlPlaneAdapterName() })
    try {
      const status = await api.status()
      set({
        connected: true,
        loading: false,
        lastError: "",
        status,
      })
    } catch (error) {
      set({
        connected: false,
        loading: false,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  refresh: async () => {
    await get().initialize(true)
  },
  setDisconnected: (message) => {
    set({ connected: false, lastError: message })
  },
}))
