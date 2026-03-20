import { useState } from "react"
import type { ToolCall } from "../stores/chat"
import { useUiI18n } from "../lib/ui-i18n"

export function ToolCallPanel({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const pending = call.result === undefined
  const { text, displayText } = useUiI18n()

  return (
    <div className="my-1 min-w-0 rounded border border-gray-200 bg-gray-50 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-100"
      >
        <span>{pending ? "⏳" : call.success ? "✓" : "✗"}</span>
        <span className="min-w-0 flex-1 break-all font-mono font-semibold text-gray-700">{call.name}</span>
        <span className="ml-auto text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="min-w-0 space-y-1 border-t border-gray-200 px-3 py-2">
          <div className="font-semibold text-gray-500">{text("입력", "Input")}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-100 p-2 text-xs [overflow-wrap:anywhere]">
            {JSON.stringify(call.params, null, 2)}
          </pre>
          {!pending && (
            <>
              <div className={`font-semibold ${call.success ? "text-green-600" : "text-red-600"}`}>
                {call.success ? text("결과", "Result") : text("오류", "Error")}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-100 p-2 text-xs [overflow-wrap:anywhere]">
                {displayText(call.result ?? "")}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
