import type { AIBackendCard, RoutingProfile } from "../../contracts/ai"
import { getBackendDisplayLabel, getRoutingProfileDisplayLabel } from "../../lib/ai-display"
import { useUiI18n } from "../../lib/ui-i18n"

export function RoutingPriorityEditor({
  profile,
  backends,
  onMove,
}: {
  profile: RoutingProfile
  backends: AIBackendCard[]
  onMove: (from: number, to: number) => void
}) {
  const { text, language } = useUiI18n()

  function getTargetLabel(target: string): string {
    const backend = backends.find((item) => item.id === target)
    return getBackendDisplayLabel(backend?.id ?? target, backend?.label ?? target, language)
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-stone-900">{getRoutingProfileDisplayLabel(profile.id, profile.label, language)}</div>
        <div className="mt-1 text-xs text-stone-500">{text("위에서 아래 순서대로 우선 적용됩니다.", "Applied in order from top to bottom.")}</div>
      </div>
      <div className="space-y-2">
        {profile.targets.map((target, index) => (
          <div key={`${profile.id}-${target}-${index}`} className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-stone-500">#{index + 1}</div>
              <div className="truncate text-sm font-semibold text-stone-800">{getTargetLabel(target)}</div>
            </div>
            <div className="ml-4 flex gap-2">
              <button
                onClick={() => onMove(index, index - 1)}
                disabled={index === 0}
                className="rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-600 disabled:opacity-40"
              >
                {text("위로", "Up")}
              </button>
              <button
                onClick={() => onMove(index, index + 1)}
                disabled={index === profile.targets.length - 1}
                className="rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-600 disabled:opacity-40"
              >
                {text("아래로", "Down")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
