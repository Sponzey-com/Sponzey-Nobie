import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ApprovalModal } from "../components/ApprovalModal"
import { EmptyState } from "../components/EmptyState"
import { MessageBubble } from "../components/MessageBubble"
import { CancelRunButton } from "../components/runs/CancelRunButton"
import { RunApprovalActions } from "../components/runs/RunApprovalActions"
import { RunStatusCard } from "../components/runs/RunStatusCard"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { mapChatErrorMessage } from "../lib/chat-errors"
import { filterRunsForChatSession, resolvePendingInteractionForRun } from "../lib/pending-interactions"
import { buildTaskMonitorCards, describeTaskDeliveryStatus, filterActiveTaskMonitorCards } from "../lib/task-monitor"
import { useUiI18n } from "../lib/ui-i18n"
import { useChatStore } from "../stores/chat"
import { useRunsStore } from "../stores/runs"

function TaskMonitorBadges({
  attemptCount,
  internalAttemptCount,
  deliveryLabel,
  text,
}: {
  attemptCount: number
  internalAttemptCount: number
  deliveryLabel: string
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("시도", "Attempts")} {attemptCount}
      </span>
      {internalAttemptCount > 0 ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
          {text("내부 시도", "Internal")} {internalAttemptCount}
        </span>
      ) : null}
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
        {text("전달", "Delivery")} {deliveryLabel}
      </span>
    </div>
  )
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
    tasks,
    selectedRunId,
    ensureInitialized,
    createRun,
    cancelRun,
    selectRun,
  } = useRunsStore()
  const [input, setInput] = useState("")
  const [sendError, setSendError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const { text, displayText, formatTime, language } = useUiI18n()

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sessionRuns = filterRunsForChatSession(runs, sessionId)
  const sessionTasks = sessionId ? tasks.filter((task) => task.sessionId === sessionId) : tasks
  const queueCards = filterActiveTaskMonitorCards(buildTaskMonitorCards(sessionTasks, sessionRuns, text))
  const selectedCard =
    queueCards.find((card) => card.representative.id === selectedRunId || card.key === selectedRunId) ??
    queueCards[0] ??
    null
  const selectedRun = selectedCard?.representative ?? null
  const selectedGroupTimeline = selectedCard?.timeline ?? []
  const selectedDeliveryLabel = selectedCard ? describeTaskDeliveryStatus(selectedCard.delivery.status, text) : ""

  async function cancelQueueCard(runId: string) {
    const card = queueCards.find((item) => item.representative.id === runId || item.key === runId)
    if (!card) return
    await cancelRun(card.representative.id)
  }

  function getApprovalForCard(cardKey: string) {
    const card = queueCards.find((item) => item.key === cardKey)
    if (!card) return null
    if (pendingApproval && card.runs.some((run) => run.id === pendingApproval.runId)) {
      return pendingApproval
    }

    const waitingRun = card.runs
      .filter((run) => run.status === "awaiting_approval" || run.status === "awaiting_user")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!waitingRun) return null

    const interaction = resolvePendingInteractionForRun(waitingRun, pendingApproval, language)
    if (!interaction) return null

    return {
      runId: waitingRun.id,
      toolName: interaction.toolName,
      params: {
        summary: waitingRun.summary,
      },
      kind: interaction.kind,
      guidance: interaction.guidance,
    }
  }

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

  const selectedApproval = selectedCard ? getApprovalForCard(selectedCard.key) : null

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

      <div className="grid min-h-0 flex-1 gap-6 overflow-hidden p-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-4">
            <div className="text-sm font-semibold text-stone-900">{text("대화 기록", "Conversation")}</div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
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

        <div className="min-h-0 overflow-y-auto space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-stone-900">{text("작업 큐", "Task queue")}</div>
                <div className="mt-1 text-xs text-stone-500">{text("현재 세션에서 요청한 태스크 목록입니다.", "This is the list of tasks requested in the current session.")}</div>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
                {text(`${queueCards.length}개`, `${queueCards.length}`)}
              </span>
            </div>
            {queueCards.length > 0 ? (
              <div className="space-y-3">
                {queueCards.map((card) => {
                  const approval = getApprovalForCard(card.key)
                  return (
                    <RunStatusCard
                      key={card.key}
                      run={card.representative}
                      selected={card.key === selectedCard?.key}
                      onSelect={() => selectRun(card.key)}
                      onCancel={() => void cancelQueueCard(card.key)}
                      extraContent={(
                        <div className="space-y-3">
                          {approval ? <RunApprovalActions approval={approval} /> : null}
                          <TaskMonitorBadges
                            attemptCount={card.attempts.length}
                            internalAttemptCount={card.internalAttempts.length}
                            deliveryLabel={describeTaskDeliveryStatus(card.delivery.status, text)}
                            text={text}
                          />
                        </div>
                      )}
                      treeNodes={card.treeNodes}
                    />
                  )
                })}
              </div>
            ) : (
              <EmptyState
                title={text("큐에 등록된 작업이 없습니다", "No tasks in the queue")}
                description={text(
                  "진행 중이거나 확인이 필요한 태스크만 여기에 나타납니다. 완료된 결과는 대화창에서만 확인합니다.",
                  "Only running tasks or tasks that need confirmation appear here. Completed results stay in the conversation.",
                )}
              />
            )}
          </div>

          {selectedRun ? (
            <>
              <RunSummaryPanel
                run={selectedRun}
                extraContent={(
                  <div className="space-y-4">
                    {selectedApproval ? <RunApprovalActions approval={selectedApproval} /> : null}
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("태스크 시도", "Task attempts")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedCard?.attempts.length ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("내부 시도", "Internal attempts")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedCard?.internalAttempts.length ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text("전달 상태", "Delivery status")}</div>
                        <div className="mt-2 text-sm font-medium text-stone-900">{selectedDeliveryLabel}</div>
                      </div>
                    </div>
                    {selectedCard?.delivery.summary ? (
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{text("전달 관측", "Delivery observation")}</div>
                        <div className="mt-2 text-sm text-stone-700 break-words [overflow-wrap:anywhere]">
                          {displayText(selectedCard.delivery.summary)}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{text("태스크 타임라인", "Task timeline")}</div>
                      <div className="mt-3 space-y-3">
                        {selectedGroupTimeline.length > 0 ? (
                          selectedGroupTimeline.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-semibold text-stone-500">{item.runLabel}</div>
                                <div className="mt-1 break-words text-sm text-stone-700 [overflow-wrap:anywhere]">{displayText(item.label)}</div>
                              </div>
                              <div className="shrink-0 text-xs text-stone-500">{formatTime(item.at)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-stone-500">{text("표시할 타임라인이 없습니다.", "No timeline to display.")}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-stone-900">{text("선택한 작업 제어", "Selected task controls")}</div>
                    <div className="mt-1 text-xs text-stone-500">{text("상세 상태를 확인하고 승인 또는 취소를 진행할 수 있습니다.", "Review the details here, then approve or cancel the task.")}</div>
                  </div>
                  <CancelRunButton
                    canCancel={selectedCard?.runs.some((run) => run.canCancel || ["queued", "running", "awaiting_approval", "awaiting_user"].includes(run.status)) ?? false}
                    onCancel={() => void cancelQueueCard(selectedCard?.key ?? selectedRun.id)}
                  />
                </div>
                {selectedGroupTimeline.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {selectedGroupTimeline.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700 break-words [overflow-wrap:anywhere]"
                      >
                        <div className="text-[11px] font-semibold text-stone-500">{event.runLabel} · {formatTime(event.at)}</div>
                        <div className="mt-1">{displayText(event.label)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    to="/runs"
                    className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                  >
                    {text("Task Monitor 열기", "Open Task Monitor")}
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title={text("선택된 작업이 없습니다", "No task selected")}
              description={text(
                "오른쪽 작업 큐에서 항목을 선택하면 상세 상태와 승인 절차를 확인할 수 있습니다.",
                "Select a task from the queue to review its details and approval state.",
              )}
            />
          )}
        </div>
      </div>

      <ApprovalModal />
    </div>
  )
}
