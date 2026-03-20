import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

const MOCK_PLUGINS = [
  {
    name: "telegram-adapter",
    version: "0.1.0",
    summaryKo: "Telegram 채널 어댑터. gateway 재연결 전까지는 disabled 상태로 유지합니다.",
    summaryEn: "Telegram channel adapter. It stays disabled until the gateway reconnects.",
    status: "disabled",
  },
  {
    name: "memory-indexer",
    version: "0.0.1",
    summaryKo: "로컬 메모리/시맨틱 검색용 플러그인. phase0001에서는 planned 상태만 노출합니다.",
    summaryEn: "Plugin for local memory and semantic search. In phase0001, only the planned state is shown.",
    status: "planned",
  },
]

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
          <div className="grid gap-4 xl:grid-cols-2">
            {MOCK_PLUGINS.map((plugin) => (
              <div key={plugin.name} className="rounded-[1.75rem] border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-stone-900">{plugin.name}</div>
                    <div className="mt-1 text-xs text-stone-500">v{plugin.version}</div>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] uppercase tracking-wide text-stone-600">
                    {plugin.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-stone-600">{text(plugin.summaryKo, plugin.summaryEn)}</p>
                <div className="mt-5 flex gap-3">
                  <button disabled className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-400">
                    {text("활성화", "Enable")}
                  </button>
                  <button disabled className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-400">
                    {text("제거", "Remove")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </FeatureGate>
      </div>
    </div>
  )
}
