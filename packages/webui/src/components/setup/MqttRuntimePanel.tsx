import type { MqttRuntimeResponse } from "../../api/client"
import { useUiI18n } from "../../lib/ui-i18n"

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString()
}

function formatPayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function toneClassForState(state: string | null) {
  const normalized = (state ?? "").toLowerCase()
  if (normalized === "ready" || normalized === "online" || normalized === "connected") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
  if (normalized === "error" || normalized === "auth_failed" || normalized === "disconnected") {
    return "border-red-200 bg-red-50 text-red-700"
  }
  return "border-stone-200 bg-stone-100 text-stone-600"
}

export function MqttRuntimePanel({
  runtime,
  loading,
  error,
  disconnectingExtensionId,
  onRefresh,
  onDisconnect,
}: {
  runtime: MqttRuntimeResponse | null
  loading: boolean
  error: string
  disconnectingExtensionId: string | null
  onRefresh: () => void
  onDisconnect: (extensionId: string) => void
}) {
  const { text, displayText } = useUiI18n()
  const extensions = runtime?.extensions ?? []
  const logs = runtime?.logs ?? []

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">{text("연결된 연장", "Connected Extensions")}</h3>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              {text("브로커에 현재 연결되어 있는 연장과 상태를 확인합니다.", "Check extensions currently connected to the broker and their status.")}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700"
          >
            {text("새로고침", "Refresh")}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {displayText(error)}
          </div>
        ) : null}

        {loading && !runtime ? (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
            {text("MQTT 연결 상태를 불러오는 중입니다.", "Loading MQTT runtime status.")}
          </div>
        ) : null}

        {!loading && extensions.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
            {text("현재 브로커에 연결된 연장이 없습니다.", "No extensions are currently connected to the broker.")}
          </div>
        ) : null}

        {extensions.length > 0 ? (
          <div className="mt-4 space-y-3">
            {extensions.map((extension) => (
              <div key={extension.extensionId} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-stone-900">
                        {extension.displayName?.trim() || extension.extensionId}
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${toneClassForState(extension.state)}`}>
                        {extension.state ?? text("알 수 없음", "Unknown")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      ID: <span className="font-mono">{extension.extensionId}</span>
                    </div>
                    {extension.clientId ? (
                      <div className="mt-1 text-xs text-stone-500">
                        Client: <span className="font-mono">{extension.clientId}</span>
                      </div>
                    ) : null}
                    {extension.version ? (
                      <div className="mt-1 text-xs text-stone-500">
                        Version: <span className="font-mono">{extension.version}</span>
                      </div>
                    ) : null}
                    {extension.message ? (
                      <div className="mt-2 text-sm text-stone-700">{displayText(extension.message)}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-stone-500">
                      {text("마지막 수신", "Last seen")}: {formatTimestamp(extension.lastSeenAt)}
                    </div>
                    {extension.methods.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {extension.methods.slice(0, 8).map((method) => (
                          <span key={method} className="rounded-full bg-stone-200 px-2 py-1 text-[11px] font-medium text-stone-700">
                            {method}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => onDisconnect(extension.extensionId)}
                    disabled={disconnectingExtensionId === extension.extensionId}
                    className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {disconnectingExtensionId === extension.extensionId
                      ? text("해지 중...", "Disconnecting...")
                      : text("연동 해지", "Disconnect")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">{text("주고받은 JSON 로그", "JSON Exchange Log")}</h3>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            {text("브로커를 통해 오간 최근 요청과 응답 JSON을 로그 형태로 보여줍니다.", "Shows recent request and response JSON exchanged through the broker.")}
          </p>
        </div>

        {logs.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
            {text("아직 기록된 MQTT JSON 로그가 없습니다.", "There are no recorded MQTT JSON logs yet.")}
          </div>
        ) : (
          <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-1">
            {logs.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-stone-200 px-2 py-1 font-semibold text-stone-700">
                      {entry.direction === "nobie_to_extension"
                        ? text("Nobie → 연장", "Nobie → Extension")
                        : text("연장 → Nobie", "Extension → Nobie")}
                    </span>
                    <span>{formatTimestamp(entry.timestamp)}</span>
                    <span className="font-mono">{entry.topic}</span>
                  </div>
                  {entry.extensionId ? <span className="font-mono">{entry.extensionId}</span> : null}
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-stone-950/95 p-3 text-[11px] leading-5 text-stone-100">
                  {formatPayload(entry.payload)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
