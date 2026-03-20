import { getBackendDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"

function toTargetLabel(targetId: string | undefined, targetLabel: string | undefined, language: "ko" | "en", text: (ko: string, en: string) => string): string {
  if (!targetId && !targetLabel?.trim()) return text("실행 대상 미선정", "No target selected")
  return getBackendDisplayLabel(targetId, targetLabel, language) || text("실행 대상 미선정", "No target selected")
}

export function RunTargetBadge({ targetId, targetLabel }: { targetId?: string; targetLabel?: string }) {
  const { text, language } = useUiI18n()

  return (
    <span className="inline-flex items-center rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-white">
      {toTargetLabel(targetId, targetLabel, language, text)}
    </span>
  )
}
