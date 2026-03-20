import { create } from "zustand"

export type UiLanguage = "ko" | "en"

const STORAGE_KEY = "nobie_ui_language"

function normalizeUiLanguage(value?: string | null): UiLanguage {
  return value === "en" ? "en" : "ko"
}

function detectInitialUiLanguage(): UiLanguage {
  if (typeof window === "undefined") return "ko"

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved) return normalizeUiLanguage(saved)

  return window.navigator.language.toLowerCase().startsWith("en") ? "en" : "ko"
}

interface UiLanguageStore {
  language: UiLanguage
  setLanguage: (language: UiLanguage) => void
}

export const useUiLanguageStore = create<UiLanguageStore>((set) => ({
  language: detectInitialUiLanguage(),
  setLanguage: (language) => {
    const next = normalizeUiLanguage(language)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
    set({ language: next })
  },
}))

export function pickUiText(language: UiLanguage, korean: string, english: string): string {
  return language === "en" ? english : korean
}

export function getCurrentUiLanguage(): UiLanguage {
  return useUiLanguageStore.getState().language
}

export function getUiLocale(language: UiLanguage): string {
  return language === "en" ? "en-US" : "ko-KR"
}
