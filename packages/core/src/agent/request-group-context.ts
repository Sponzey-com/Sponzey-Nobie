import type { DbMessage, DbRequestGroupMessage } from "../db/index.js"

const INTERNAL_WORKER_PROMPT_PREFIXES = [
  "[Task Intake Bridge]",
  "[Filesystem Execution Required]",
  "[Approval Granted Continuation]",
  "[Scheduled Task]",
  "[Truncated Output Recovery]",
]

export function selectRequestGroupContextMessages(messages: DbRequestGroupMessage[]): DbMessage[] {
  const hasChildExecution = messages.some((message) => {
    if (!message.root_run_id || !message.run_request_group_id) return false
    if (message.root_run_id !== message.run_request_group_id) return true
    return Boolean(message.run_worker_session_id)
  })

  return messages
    .filter((message) => {
      if (!hasChildExecution) return true
      if (!message.root_run_id || !message.run_request_group_id) return true
      if (message.root_run_id !== message.run_request_group_id) return false

      const prompt = message.run_prompt?.trim() ?? ""
      if (message.role === "user" && !INTERNAL_WORKER_PROMPT_PREFIXES.some((prefix) => prompt.startsWith(prefix))) {
        return true
      }
      if (message.role === "assistant" && !message.tool_calls) {
        return true
      }
      return INTERNAL_WORKER_PROMPT_PREFIXES.some((prefix) => prompt.startsWith(prefix))
    })
    .map((message) => ({
      id: message.id,
      session_id: message.session_id,
      ...(message.root_run_id !== undefined ? { root_run_id: message.root_run_id } : {}),
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id,
      created_at: message.created_at,
    }))
}
