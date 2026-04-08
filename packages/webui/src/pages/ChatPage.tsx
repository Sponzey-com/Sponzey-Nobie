import { useEffect, useRef, useState } from "react"
import { ApprovalModal } from "../components/ApprovalModal"
import { EmptyState } from "../components/EmptyState"
import { MessageBubble } from "../components/MessageBubble"
import { CancelRunButton } from "../components/runs/CancelRunButton"
import { RunApprovalActions } from "../components/runs/RunApprovalActions"
import { mapChatErrorMessage } from "../lib/chat-errors"
import { filterRunsForChatSession, resolvePendingInteractionForSession } from "../lib/pending-interactions"
import { useUiI18n } from "../lib/ui-i18n"
import { useChatStore } from "../stores/chat"
import { useRunsStore } from "../stores/runs"

export function ChatPage() {
  const {
    messages,
    running,
    sessionId,
    pendingApproval,
    inputError,
    addUserMessage,
    addAssistantMessage,
    clearMessages,
    setSessionId,
    clearInputError,
  } = useChatStore()
  const {
    runs,
    ensureInitialized,
    createRun,
    cancelRun,
  } = useRunsStore()
  const [input, setInput] = useState("")
  const [sendError, setSendError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const { text, displayText, language } = useUiI18n()

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sessionRuns = filterRunsForChatSession(runs, sessionId)
  const latestSessionRun = [...sessionRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  const currentApproval = resolvePendingInteractionForSession(sessionRuns, sessionId, pendingApproval, language)

  async function sendMessage() {
    const messageText = input.trim()
    if (!messageText) return
    setSendError("")
    clearInputError()
    setInput("")
    addUserMessage(messageText)
    try {
      const response = await createRun(messageText, sessionId ?? undefined)
      setSessionId(response.sessionId)
      if (response.receipt?.trim()) {
        addAssistantMessage(response.receipt.trim())
      }
      return
    } catch (createRunError) {
      const message =
        createRunError instanceof Error
          ? createRunError.message
          : String(createRunError)
      setSendError(mapChatErrorMessage(message, language))
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void sendMessage()
    }
  }
  return (
    <div className="flex h-full flex-col bg-stone-100">
      <div className="border-b border-stone-200 bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{text("채팅 작업 공간", "Chat Workspace")}</div>
            <h1 className="mt-2 text-2xl font-semibold text-stone-900">{text("채팅", "Chat")}</h1>
          </div>
          <div className="flex items-center gap-2">
            {sessionId ? (
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-mono text-stone-500">
                {sessionId.slice(0, 8)}...
              </span>
            ) : null}
            <button
              onClick={clearMessages}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50"
            >
              {text("새 대화", "New chat")}
            </button>
          </div>
        </div>
        {sendError || inputError ? (
          <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {sendError || inputError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-4">
            <div className="text-sm font-semibold text-stone-900">{text("대화 기록", "Conversation")}</div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {latestSessionRun ? (
              <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50/80 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      {text("현재 진행 상황", "Current progress")}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-stone-900">
                      {latestSessionRun.title}
                    </div>
                    <div className="mt-2 break-words text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">
                      {displayText(latestSessionRun.summary)}
                    </div>
                  </div>
                  <CancelRunButton
                    canCancel={latestSessionRun.canCancel || ["queued", "running", "awaiting_approval", "awaiting_user"].includes(latestSessionRun.status)}
                    onCancel={() => void cancelRun(latestSessionRun.id)}
                  />
                </div>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <EmptyState
                title={text("아직 채팅 메시지가 없습니다", "No messages yet")}
                description={text(
                  "메시지를 보내면 실행 상태와 함께 이 영역에 대화가 표시됩니다.",
                  "Send a message to see the conversation and execution status here.",
                )}
              />
            ) : (
              <>
                {messages.map((message) => (
                  <MessageBubble key={message.id} msg={message} />
                ))}
                {currentApproval ? (
                  <div className="mt-4">
                    <RunApprovalActions approval={currentApproval} />
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <div className="border-t border-stone-200 px-5 py-4">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={text(
                  "메시지 입력... (Enter 전송, Shift+Enter 줄바꿈)",
                  "Type a message... (Enter to send, Shift+Enter for a new line)",
                )}
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-stone-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
                style={{ maxHeight: "140px" }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim()}
                className="rounded-2xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? text("큐에 추가", "Add to queue") : text("전송", "Send")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ApprovalModal />
    </div>
  )
}
