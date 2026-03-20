import { create } from "zustand"
import { api } from "../api/client"
import { countCapabilities, type CapabilityCounts, type FeatureCapability } from "../contracts/capabilities"
import { useConnectionStore } from "./connection"

interface CapabilitiesState {
  items: FeatureCapability[]
  counts: CapabilityCounts
  initialized: boolean
  loading: boolean
  lastError: string
  initialize: (force?: boolean) => Promise<void>
  refresh: () => Promise<void>
  setItems: (items: FeatureCapability[]) => void
  updateStatus: (key: string, status: FeatureCapability["status"], reason?: string) => void
}

const initialItems: FeatureCapability[] = []

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  items: initialItems,
  counts: countCapabilities(initialItems),
  initialized: false,
  loading: false,
  lastError: "",
  initialize: async (force = false) => {
    if (!force && (get().initialized || get().loading)) return
    set({ loading: true })
    try {
      const response = await api.capabilities()
      set({
        items: response.items,
        counts: countCapabilities(response.items),
        initialized: true,
        loading: false,
        lastError: "",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useConnectionStore.getState().setDisconnected(message)
      set({
        items: get().items,
        counts: countCapabilities(get().items),
        initialized: true,
        loading: false,
        lastError: message,
      })
    }
  },
  refresh: async () => {
    await get().initialize(true)
  },
  setItems: (items) => set({ items, counts: countCapabilities(items) }),
  updateStatus: (key, status, reason) =>
    set((state) => {
      const items = state.items.map((item) =>
        item.key === key ? { ...item, status, reason } : item,
      )
      return { items, counts: countCapabilities(items) }
    }),
}))

export function useCapability(key: string): FeatureCapability | undefined {
  return useCapabilitiesStore((state) => state.items.find((item) => item.key === key))
}

export function getCapability(key: string): FeatureCapability | undefined {
  return useCapabilitiesStore.getState().items.find((item) => item.key === key)
}
