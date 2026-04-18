import { create } from "zustand"
import { api, type PreferredUiMode, type UiMode, type UiModeState, type UiShellResponse } from "../api/client"

function defaultMode(): UiModeState {
  return {
    mode: "beginner",
    preferredUiMode: "beginner",
    availableModes: ["beginner", "advanced"],
    adminEnabled: false,
    canSwitchInUi: true,
    schemaVersion: 1,
  }
}

interface UiModeStore {
  initialized: boolean
  loading: boolean
  error: string
  mode: UiMode
  preferredUiMode: PreferredUiMode
  adminEnabled: boolean
  availableModes: UiMode[]
  shell: UiShellResponse | null
  initialize: (force?: boolean) => Promise<void>
  setPreferredMode: (mode: PreferredUiMode) => Promise<void>
}

export const useUiModeStore = create<UiModeStore>((set, get) => ({
  initialized: false,
  loading: false,
  error: "",
  mode: "beginner",
  preferredUiMode: "beginner",
  adminEnabled: false,
  availableModes: ["beginner", "advanced"],
  shell: null,
  initialize: async (force = false) => {
    if (!force && (get().loading || get().initialized)) return
    set({ loading: true })
    try {
      const shell = await api.uiShell()
      set({
        initialized: true,
        loading: false,
        error: "",
        shell,
        mode: shell.mode.mode,
        preferredUiMode: shell.mode.preferredUiMode,
        adminEnabled: shell.mode.adminEnabled,
        availableModes: shell.mode.availableModes,
      })
    } catch (error) {
      const fallback = defaultMode()
      set({
        initialized: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        mode: fallback.mode,
        preferredUiMode: fallback.preferredUiMode,
        adminEnabled: fallback.adminEnabled,
        availableModes: fallback.availableModes,
      })
    }
  },
  setPreferredMode: async (mode) => {
    const previous = get()
    set({ mode, preferredUiMode: mode })
    const saved = await api.saveUiMode(mode)
    set({
      mode: saved.mode,
      preferredUiMode: saved.preferredUiMode,
      adminEnabled: saved.adminEnabled,
      availableModes: saved.availableModes,
      error: saved.ok ? "" : previous.error,
    })
    void get().initialize(true)
  },
}))
