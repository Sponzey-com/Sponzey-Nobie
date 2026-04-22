import type { SetupMcpServerDraft } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"
import type { McpServerErrors } from "../../lib/setupFlow"

function createDraftServer(): SetupMcpServerDraft {
  return {
    id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    cwd: "",
    url: "",
    required: false,
    enabled: true,
    status: "disabled",
    reason: undefined,
    tools: [],
  }
}

export function McpSetupForm({
  value,
  onChange,
  onTest,
  testingServerId,
  errors = {},
}: {
  value: { servers: SetupMcpServerDraft[] }
  onChange: (value: { servers: SetupMcpServerDraft[] }) => void
  onTest: (serverId: string) => void
  testingServerId?: string | null
  errors?: Record<string, McpServerErrors>
}) {
  const { text, displayText } = useUiI18n()

  function updateServer(serverId: string, patch: Partial<SetupMcpServerDraft>) {
    onChange({
      servers: value.servers.map((server) => (server.id === serverId ? { ...server, ...patch } : server)),
    })
  }

  function removeServer(serverId: string) {
    onChange({ servers: value.servers.filter((server) => server.id !== serverId) })
  }

  function addServer() {
    onChange({ servers: [...value.servers, createDraftServer()] })
  }

  return (
    <div className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-stone-900">{text("외부 기능 연결 (MCP)", "External Tool Connection (MCP)")}</div>
          <div className="mt-1 text-sm leading-6 text-stone-600">
            {text("외부 프로그램이 가진 기능을 Nobie에 연결하는 단계입니다. 지금은 stdio 방식만 바로 사용할 수 있습니다.", "This step connects external program features to Nobie. Right now, only stdio transport is available for direct use.")}
          </div>
        </div>
        <button
          type="button"
          onClick={addServer}
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-700"
        >
          {text("새 MCP 추가", "Add MCP Server")}
        </button>
      </div>

      <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
        {text("외부 기능 연결이 없으면 일부 자동화나 확장 도구는 동작하지 않을 수 있습니다.", "Without external tool connections, some automation and extension tools may not work.")}
      </div>

      {value.servers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-500">
          {text("아직 추가된 MCP 서버가 없습니다. 필요하면 추가하고 연결 확인을 진행해 주세요.", "No MCP servers have been added yet. Add one if needed, then run the connection check.")}
        </div>
      ) : null}

      <div className="space-y-4">
        {value.servers.map((server) => {
          const serverErrors = errors[server.id]
          const isTesting = testingServerId === server.id
          return (
            <McpServerEditorCard
              key={server.id}
              server={server}
              isTesting={isTesting}
              errors={serverErrors}
              onChange={(patch) => updateServer(server.id, patch)}
              onRemove={() => removeServer(server.id)}
              onTest={() => onTest(server.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function McpServerEditorCard({
  server,
  isTesting = false,
  errors,
  onChange,
  onRemove,
  onTest,
}: {
  server: SetupMcpServerDraft
  isTesting?: boolean
  errors?: McpServerErrors
  onChange: (patch: Partial<SetupMcpServerDraft>) => void
  onRemove: () => void
  onTest: () => void
}) {
  const { text, displayText } = useUiI18n()
  const statusTone = server.status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : server.status === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-stone-200 bg-stone-100 text-stone-700"

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900">{server.name.trim() || text("새 MCP 서버", "New MCP Server")}</div>
          <div className="mt-1 text-xs text-stone-500">{text("외부 기능 연결 서버 (MCP Server)", "MCP Server")}</div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}>
          {server.status === "ready" ? text("연결됨", "Connected") : server.status === "error" ? text("오류", "Error") : text("준비 전", "Not Ready")}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("서버 이름 (Server Name) *", "Server Name *")}</label>
          <input
            className="input"
            value={server.name}
            onChange={(event) => onChange({ name: event.target.value, status: "disabled", reason: undefined, tools: [] })}
            placeholder={text("예: file_tools", "Example: file_tools")}
          />
          {errors?.name ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.name}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("연결 방식 (Transport) *", "Transport *")}</label>
          <select
            className="input"
            value={server.transport}
            onChange={(event) => onChange({
              transport: event.target.value as SetupMcpServerDraft["transport"],
              status: "disabled",
              reason: undefined,
              tools: [],
            })}
          >
            <option value="stdio">stdio</option>
            <option value="http">{text("http (준비 중)", "http (coming soon)")}</option>
          </select>
          {errors?.transport ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.transport}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          {text("이 서버 사용", "Use this server")}
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={server.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          {text("필수 서버로 표시", "Mark as required")}
        </label>
      </div>

      {server.transport === "stdio" ? (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">{text("실행 명령 (Command) *", "Command *")}</label>
            <input
              className="input font-mono"
              value={server.command}
              onChange={(event) => onChange({ command: event.target.value, status: "disabled", reason: undefined, tools: [] })}
              placeholder={text("예: node", "Example: node")}
            />
            {errors?.command ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.command}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">{text("실행 인자 (Args)", "Args")}</label>
            <textarea
              className="input min-h-[88px] font-mono text-sm"
              value={server.argsText}
              onChange={(event) => onChange({ argsText: event.target.value, status: "disabled", reason: undefined, tools: [] })}
              placeholder={text(`한 줄에 하나씩 입력\n예: ./server.js`, `One item per line\nExample: ./server.js`)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">{text("작업 폴더 (Working Directory)", "Working Directory")}</label>
            <input
              className="input font-mono"
              value={server.cwd}
              onChange={(event) => onChange({ cwd: event.target.value, status: "disabled", reason: undefined, tools: [] })}
              placeholder={text("비워두면 현재 프로젝트 폴더를 사용합니다", "Leave empty to use the current project folder")}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-stone-700">{text("HTTP 주소 (URL) *", "HTTP URL *")}</label>
          <input
            className="input font-mono"
            value={server.url}
            onChange={(event) => onChange({ url: event.target.value, status: "disabled", reason: undefined, tools: [] })}
            placeholder={text("예: http://127.0.0.1:3001", "Example: http://127.0.0.1:3001")}
          />
          {errors?.url ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.url}</p> : null}
        </div>
      )}

      {server.reason ? (
        <div className={`mt-4 rounded-xl px-3 py-3 text-sm leading-6 ${server.status === "error" ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-700"}`}>
          {displayText(server.reason)}
        </div>
      ) : null}
      {errors?.status ? <p className="mt-2 text-xs leading-5 text-red-600">{errors.status}</p> : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isTesting ? text("연결 확인 중...", "Checking connection...") : text("연결 확인", "Check Connection")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
        >
          {text("삭제", "Delete")}
        </button>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{text("도구 목록 (Tools)", "Tools")}</div>
        {server.tools.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {server.tools.map((tool) => (
              <span key={tool} className="rounded-full bg-white px-3 py-1 text-xs text-stone-700">
                {tool}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-dashed border-stone-200 bg-white px-3 py-4 text-sm text-stone-500">
            {text("연결 확인을 마치면 사용 가능한 도구 이름이 여기에 표시됩니다.", "Available tool names will appear here after the connection check completes.")}
          </div>
        )}
      </div>
    </div>
  )
}
