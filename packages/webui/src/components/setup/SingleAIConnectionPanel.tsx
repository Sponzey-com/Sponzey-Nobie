import { BackendHealthCard } from "./BackendHealthCard"
import type { AIBackendCard, RoutingProfile } from "../../contracts/ai"
import type { BackendCardErrors } from "../../lib/setupFlow"
import { getSingleAiBackendIdByProviderType } from "../../lib/single-ai"
import { useUiI18n } from "../../lib/ui-i18n"

export function SingleAIConnectionPanel({
  backends,
  routingProfiles,
  activeBackendId,
  onSelectBackend,
  onUpdateBackend,
  onToggleBackend,
  onRemoveBackend,
  onSetRoutingTargetEnabled,
  backendErrors,
}: {
  backends: AIBackendCard[]
  routingProfiles: RoutingProfile[]
  activeBackendId: string | null
  onSelectBackend: (backendId: string) => void
  onUpdateBackend: (backendId: string, patch: Partial<AIBackendCard>) => void
  onToggleBackend: (backendId: string, enabled: boolean) => void
  onRemoveBackend: (backendId: string) => void
  onSetRoutingTargetEnabled: (profileId: RoutingProfile["id"], backendId: string, enabled: boolean) => void
  backendErrors?: Record<string, BackendCardErrors>
}) {
  const { text } = useUiI18n()
  const activeBackend = backends.find((backend) => backend.id === activeBackendId) ?? backends[0] ?? null
  const enabledBackend = backends.find((backend) => backend.enabled) ?? null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-stone-900">{text("현재 AI 연결", "Current AI connection")}</div>
            <div className="mt-1 text-sm leading-6 text-stone-600">
              {enabledBackend
                ? text(
                    `현재는 ${enabledBackend.label} 하나만 활성화되어 있습니다. 다른 연결을 고르면 이전 연결은 자동으로 비활성화됩니다.`,
                    `${enabledBackend.label} is the only active connection. Choosing another connection disables the previous one automatically.`,
                  )
                : text(
                    "아직 활성화된 AI가 없습니다. 아래에서 연결 하나를 골라 활성화하면 됩니다.",
                    "There is no active AI yet. Pick one connection below and enable it.",
                  )}
            </div>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
            {enabledBackend ? text("활성 1개", "1 active") : text("활성 없음", "Not active")}
          </span>
        </div>
      </div>

      {activeBackend ? (
        <BackendHealthCard
          backend={activeBackend}
          routingProfiles={routingProfiles}
          onChange={onUpdateBackend}
          onToggle={onToggleBackend}
          onRemove={onRemoveBackend}
          onSetRoutingTargetEnabled={onSetRoutingTargetEnabled}
          onSelectBuiltinProviderType={(providerType) => {
            const nextBackendId = getSingleAiBackendIdByProviderType(backends, providerType)
            if (!nextBackendId) return
            onSelectBackend(nextBackendId)
            onToggleBackend(nextBackendId, true)
          }}
          errors={backendErrors?.[activeBackend.id]}
          showRoutingTags={false}
        />
      ) : null}
    </div>
  )
}
