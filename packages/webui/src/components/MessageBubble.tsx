import ReactMarkdown from "react-markdown"
import { ToolCallPanel } from "./ToolCallPanel"
import type { Message } from "../stores/chat"
import { useUiI18n } from "../lib/ui-i18n"

export function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"
  const { displayText } = useUiI18n()
  const renderedContent = isUser ? msg.content : displayText(msg.content)

  return (
    <div className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] min-w-0 ${isUser ? "order-2" : "order-1"}`}>
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mb-2">
            {msg.toolCalls.map((tc, i) => (
              <ToolCallPanel key={i} call={tc} />
            ))}
          </div>
        )}
        {renderedContent && (
          <div
            className={`min-w-0 overflow-hidden rounded-2xl px-4 py-2.5 ${
              isUser
                ? "bg-blue-600 text-white"
                : "border border-gray-200 bg-white text-gray-800"
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{renderedContent}</p>
            ) : (
              <div className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_code]:break-all [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
                <ReactMarkdown>{renderedContent}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
