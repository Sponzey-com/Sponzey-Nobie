import { useEffect, useRef, useState } from "react"
import { ApprovalModal } from "../components/ApprovalModal"
import { EmptyState } from "../components/EmptyState"
import { MessageBubble } from "../components/MessageBubble"
import { CancelRunButton } from "../components/runs/CancelRunButton"
import { RunApprovalActions } from "../components/runs/RunApprovalActions"
import { getStoredToken } from "../api/client"
import {
  BEGINNER_CHAT_COMPOSER_CLASS,
  BEGINNER_CHAT_INPUT_CLASS,
  BEGINNER_CHAT_SCROLL_CLASS,
  buildBeginnerResultCards,
  buildBeginnerRunCards,
  type BeginnerRunCardStatus,
} from "../lib/beginner-workspace"
import { mapChatErrorMessage } from "../lib/chat-errors"
import { uiCatalogText } from "../lib/message-catalog"
import { filterRunsForChatSession, resolvePendingInteractionForSession } from "../lib/pending-interactions"
import { useUiI18n } from "../lib/ui-i18n"
import { useChatStore } from "../stores/chat"
import { useRunsStore } from "../stores/runs"
import { useUiModeStore } from "../stores/uiMode"

function resolveArtifactUrl(url: string): string {
  if (!url.startsWith("/")) return url
  const token = getStoredToken()
  if (!token || url.includes("token=")) return url
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}

function beginnerStatusTone(status: BeginnerRunCardStatus): string {
  switch (status) {
    case "running": return "border-blue-200 bg-blue-50 text-blue-800"
    case "completed": return "border-emerald-200 bg-emerald-50 text-emerald-800"
    case "needs_attention": return "border-amber-200 bg-amber-50 text-amber-800"
    case "failed": return "border-red-200 bg-red-50 text-red-800"
  }
}

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
  const { text, displayText, language, formatTime } = useUiI18n()
  const mode = useUiModeStore((state) => state.mode)

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sessionRuns = filterRunsForChatSession(runs, sessionId)
  const latestSessionRun = [...sessionRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  const currentApproval = resolvePendingInteractionForSession(sessionRuns, sessionId, pendingApproval, language)
  const beginnerRunCards = buildBeginnerRunCards({ runs, sessionId, language, limit: 3 })
  const beginnerResultCards = buildBeginnerResultCards(messages, language, 3)

  async function sendMessage() {
    const messageText = input.trim()
    if (!messageText) return
    setSendError("")
    clearInputError()
    setInput("")
    addUserMessage(messageText)
    try {
      const response = await createRun(messageText, sessionId ?? undefined, sessionId ?? "default")
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

  if (mode === "beginner") {
    return (
      <div className="flex h-full flex-col bg-stone-100">
        <div className="border-b border-stone-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{uiCatalogText(language, "beginner.home.eyebrow")}</div>
              <h1 className="mt-2 text-2xl font-semibold text-stone-900">{uiCatalogText(language, "beginner.home.title")}</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">{uiCatalogText(language, "beginner.home.description")}</p>
            </div>
            <button
              type="button"
              aria-label={uiCatalogText(language, "beginner.home.newChat")}
              onClick={clearMessages}
              className="min-h-10 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            >
              {uiCatalogText(language, "beginner.home.newChat")}
            </button>
          </div>
        </div>

        <div className={BEGINNER_CHAT_SCROLL_CLASS}>
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {currentApproval ? <RunApprovalActions approval={currentApproval} /> : null}

            {beginnerResultCards.length > 0 ? (
              <section className="rounded-[1.75rem] border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="text-sm font-semibold text-stone-900">{uiCatalogText(language, "beginner.home.recentResults")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {beginnerResultCards.map((artifact) => {
                    const isImage = artifact.previewable && artifact.mimeType?.startsWith("image/")
                    const previewUrl = resolveArtifactUrl(artifact.previewUrl || artifact.url)
                    const downloadUrl = resolveArtifactUrl(artifact.downloadUrl)
                    return (
                      <a key={artifact.key} href={downloadUrl} target="_blank" rel="noreferrer" download className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-900/10">
                        {isImage ? <img src={previewUrl} alt={artifact.caption} className="h-36 w-full bg-white object-contain" loading="lazy" /> : null}
                        <div className="p-3">
                          <div className="text-sm font-semibold text-stone-900">{artifact.title}</div>
                          <div className="mt-1 text-xs leading-5 text-stone-500">{artifact.caption}</div>
                        </div>
                      </a>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {beginnerRunCards.length > 0 ? (
              <section className="rounded-[1.75rem] border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="text-sm font-semibold text-stone-900">{uiCatalogText(language, "beginner.home.recentWork")}</div>
                <div className="mt-3 grid gap-3">
                  {beginnerRunCards.map((card) => (
                    <article key={card.key} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${beginnerStatusTone(card.status)}`}>{card.statusLabel}</div>
                          <h2 className="mt-3 break-words text-sm font-semibold text-stone-900 [overflow-wrap:anywhere]">{card.title}</h2>
                          <p className="mt-2 break-words text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">{card.summary}</p>
                          <div className="mt-2 text-xs text-stone-400">{formatTime(card.updatedAt)}</div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                          {card.canCancel ? <CancelRunButton canCancel onCancel={() => void cancelRun(card.key)} /> : null}
                          {card.nextAction ? (
                            <a href={card.nextAction.href} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/10">
                              {card.nextAction.label}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-[1.75rem] border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="text-sm font-semibold text-stone-900">{uiCatalogText(language, "beginner.home.conversation")}</div>
              <div className="mt-4">
                {messages.length === 0 ? (
                  <EmptyState
                    title={uiCatalogText(language, "beginner.home.emptyTitle")}
                    description={uiCatalogText(language, "beginner.home.emptyDescription")}
                  />
                ) : (
                  <>
                    {messages.map((message) => <MessageBubble key={message.id} msg={message} showToolCalls={false} />)}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className={BEGINNER_CHAT_COMPOSER_CLASS}>
          <div className="mx-auto max-w-4xl">
            {sendError || inputError ? (
              <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
                {sendError || inputError}
              </div>
            ) : null}
            <section aria-label={uiCatalogText(language, "beginner.home.inputPlaceholder")} className="rounded-[1.75rem] border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
              <label htmlFor="beginner-chat-input" className="sr-only">{uiCatalogText(language, "beginner.home.inputPlaceholder")}</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <textarea
                  id="beginner-chat-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={uiCatalogText(language, "beginner.home.inputPlaceholder")}
                  rows={2}
                  className={BEGINNER_CHAT_INPUT_CLASS}
                  style={{ maxHeight: "160px" }}
                />
                <button
                  type="button"
                  aria-label={running ? uiCatalogText(language, "beginner.home.queue") : uiCatalogText(language, "beginner.home.send")}
                  onClick={() => void sendMessage()}
                  disabled={!input.trim()}
                  className="min-h-12 w-full rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-stone-900/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {running ? uiCatalogText(language, "beginner.home.queue") : uiCatalogText(language, "beginner.home.send")}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    )
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
              type="button"
              aria-label={text("새 대화 시작", "Start new chat")}
              onClick={clearMessages}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
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
                type="button"
                aria-label={running ? text("현재 메시지를 실행 대기열에 추가", "Add current message to queue") : text("현재 메시지 전송", "Send current message")}
                onClick={() => void sendMessage()}
                disabled={!input.trim()}
                className="rounded-2xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-stone-900/20 disabled:cursor-not-allowed disabled:opacity-50"
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
