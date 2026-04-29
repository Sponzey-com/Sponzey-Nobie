import { InputFile } from "grammy"
import {
  createRawPayloadRef,
  resolveDeliveryReceiptStatus,
  type ChannelTarget,
  type DeliveryReceipt,
} from "../contracts.js"
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

export interface TelegramDeliveryReceiptParams {
  target: TelegramDeliveryTarget
  idempotencyKey: string
  messageId?: number | string
  providerResponse?: unknown
  timestamp?: number | undefined
}

export interface TelegramTextPartsDeliveryResult {
  messageIds: number[]
  receipts: DeliveryReceipt[]
}

export interface TelegramFileDeliveryResult {
  messageId: number
  receipt: DeliveryReceipt
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

export async function sendTelegramTextPartsWithReceipts(params: {
  api: TelegramMessageDeliveryApi
  target: TelegramDeliveryTarget
  text: string
  idempotencyKeyPrefix: string
  timestamp?: number
}): Promise<TelegramTextPartsDeliveryResult> {
  const messageIds: number[] = []
  const receipts: DeliveryReceipt[] = []
  const parts = splitMessage(params.text)
  const other = buildThreadOptions(params.target.threadId)

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? ""
    const message = await params.api.sendMessage(params.target.chatId, part, other)
    messageIds.push(message.message_id)
    receipts.push(buildTelegramSentDeliveryReceipt({
      target: params.target,
      idempotencyKey: `${params.idempotencyKeyPrefix}:part:${index + 1}`,
      messageId: message.message_id,
      providerResponse: message,
      timestamp: params.timestamp,
    }))
  }

  return { messageIds, receipts }
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

export async function sendTelegramFileWithReceipt(params: {
  api: TelegramMessageDeliveryApi
  target: TelegramDeliveryTarget
  filePath: string
  idempotencyKey: string
  caption?: string
  timestamp?: number
}): Promise<TelegramFileDeliveryResult> {
  const baseOptions = buildThreadOptions(params.target.threadId)
  const options = params.caption !== undefined ? { ...baseOptions, caption: params.caption } : baseOptions
  const message = await params.api.sendDocument(params.target.chatId, new InputFile(params.filePath), options)
  return {
    messageId: message.message_id,
    receipt: buildTelegramSentDeliveryReceipt({
      target: params.target,
      idempotencyKey: params.idempotencyKey,
      messageId: message.message_id,
      providerResponse: message,
      timestamp: params.timestamp,
    }),
  }
}

export function buildTelegramSentDeliveryReceipt(params: TelegramDeliveryReceiptParams): DeliveryReceipt {
  return {
    channelId: "telegram:primary",
    provider: "telegram",
    connectionId: "telegram:primary",
    target: telegramTargetToChannelTarget(params.target),
    status: resolveDeliveryReceiptStatus({
      sent: true,
      providerSupportsDelivered: false,
    }),
    timestamp: params.timestamp ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    ...(params.messageId !== undefined ? { messageId: String(params.messageId) } : {}),
    ...(params.target.threadId !== undefined ? { threadId: String(params.target.threadId) } : {}),
    ...(params.providerResponse !== undefined
      ? {
          providerResponseRef: createRawPayloadRef({
            provider: "telegram",
            payload: params.providerResponse,
            createdAt: params.timestamp ?? Date.now(),
          }),
        }
      : {}),
  }
}

export function buildTelegramFailedDeliveryReceipt(params: {
  target: TelegramDeliveryTarget
  idempotencyKey: string
  error: unknown
  timestamp?: number
}): DeliveryReceipt {
  const message = params.error instanceof Error ? params.error.message : String(params.error)
  return {
    channelId: "telegram:primary",
    provider: "telegram",
    connectionId: "telegram:primary",
    target: telegramTargetToChannelTarget(params.target),
    status: "failed",
    timestamp: params.timestamp ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    errorCode: "telegram_delivery_failed",
    errorMessage: message,
  }
}

export function telegramTargetToChannelTarget(target: TelegramDeliveryTarget): ChannelTarget {
  return {
    roomId: String(target.chatId),
    ...(target.threadId !== undefined ? { threadId: String(target.threadId) } : {}),
  }
}
