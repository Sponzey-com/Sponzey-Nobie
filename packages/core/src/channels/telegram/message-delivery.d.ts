import { InputFile } from "grammy";
export interface TelegramMessageDeliveryApi {
    sendMessage: (chatId: number, text: string, other?: Record<string, unknown>) => Promise<{
        message_id: number;
    }>;
    sendDocument: (chatId: number, document: InputFile, other?: Record<string, unknown>) => Promise<{
        message_id: number;
    }>;
}
export interface TelegramDeliveryTarget {
    chatId: number;
    threadId?: number;
}
export declare function sendTelegramTextParts(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    text: string;
}): Promise<number[]>;
export declare function sendTelegramPlainMessage(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    text: string;
}): Promise<number>;
export declare function sendTelegramFile(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    filePath: string;
    caption?: string;
}): Promise<number>;
//# sourceMappingURL=message-delivery.d.ts.map