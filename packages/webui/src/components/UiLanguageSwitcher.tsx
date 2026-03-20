import { pickUiText, useUiLanguageStore } from "../stores/uiLanguage"

export function UiLanguageSwitcher({ className = "" }: { className?: string }) {
  const language = useUiLanguageStore((state) => state.language)
  const setLanguage = useUiLanguageStore((state) => state.setLanguage)

  return (
    <div className={`inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/80 px-3 py-2 ${className}`}>
      <span className="text-xs font-semibold text-stone-500">{pickUiText(language, "메뉴 언어", "Menu")}</span>
      <div className="inline-flex rounded-xl bg-stone-100 p-1">
        <button
          type="button"
          onClick={() => setLanguage("ko")}
          className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${language === "ko" ? "bg-stone-900 text-white" : "text-stone-600"}`}
        >
          한글
        </button>
        <button
          type="button"
          onClick={() => setLanguage("en")}
          className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${language === "en" ? "bg-stone-900 text-white" : "text-stone-600"}`}
        >
          English
        </button>
      </div>
    </div>
  )
}
