import { InputFile } from "grammy"
import { splitMessage } from "./markdown.js"

export interface TelegramMessageDeliveryApi {
  sendMessage: (
    chatId: number,
    text: string,
    other?: Record<string, unknown>,
  ) => Promise<{ message_id: number }>
  sendDocument: (
    chatId: number,
    document: InputFile,
    other?: Record<string, unknown>,
  ) => Promise<{ message_id: number }>
}

export interface TelegramDeliveryTarget {
  chatId: number
  threadId?: number
}

function buildThreadOptions(threadId?: number): Record<string, unknown> {
  return threadId !== undefined ? { message_thread_id: threadId } : {}
}

export async function sendTelegramTextParts(params: {
  api: TelegramMessageDeliveryApi
  target: TelegramDeliveryTarget
  text: string
}): Promise<number[]> {
  const sentMessageIds: number[] = []
  const parts = splitMessage(params.text)
  const other = buildThreadOptions(params.target.threadId)

  for (const part of parts) {
    const message = await params.api.sendMessage(params.target.chatId, part, other)
    sentMessageIds.push(message.message_id)
  }

  return sentMessageIds
}

export async function sendTelegramPlainMessage(params: {
  api: TelegramMessageDeliveryApi
  target: TelegramDeliveryTarget
  text: string
}): Promise<number> {
  const message = await params.api.sendMessage(
    params.target.chatId,
    params.text,
    buildThreadOptions(params.target.threadId),
  )
  return message.message_id
}

export async function sendTelegramFile(params: {
  api: TelegramMessageDeliveryApi
  target: TelegramDeliveryTarget
  filePath: string
  caption?: string
}): Promise<number> {
  const baseOptions = buildThreadOptions(params.target.threadId)
  const options = params.caption !== undefined ? { ...baseOptions, caption: params.caption } : baseOptions
  const message = await params.api.sendDocument(params.target.chatId, new InputFile(params.filePath), options)
  return message.message_id
}
