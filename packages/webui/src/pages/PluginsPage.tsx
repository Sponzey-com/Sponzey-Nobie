import { EmptyState } from "../components/EmptyState"
import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

export default function PluginsPage() {
  const { text } = useUiI18n()

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Plugins</div>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("플러그인 런타임", "Plugin runtime")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
          {text(
            "플러그인 기능은 숨기지 않고 현재 상태 그대로 보여줍니다. 설치, 활성화, 제거 액션은 gateway 연결 전까지 잠겨 있어야 합니다.",
            "Show plugin features as they are. Install, enable, and remove actions stay locked until the gateway is connected.",
          )}
        </p>
      </div>

      <div className="mt-6">
        <FeatureGate capabilityKey="plugins.runtime" title={text("플러그인 런타임", "Plugin Runtime")}>
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            <EmptyState
              title={text("표시할 플러그인이 없습니다", "No plugins to show")}
              description={text(
                "실제 플러그인 정보가 연결되면 이 화면에만 표시됩니다.",
                "Only real plugin entries will appear here once the plugin runtime is connected.",
              )}
            />
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
