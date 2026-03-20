import type { Message, LLMProvider } from "../llm/types.js";
import type { DbMessage } from "../db/index.js";
export declare const COMPRESS_THRESHOLD = 120000;
export declare const COMPRESS_MSG_COUNT = 40;
export declare function needsCompression(messages: Message[], totalTokens: number): boolean;
/**
 * Compress the in-memory message list by summarizing old messages.
 * Returns the new (shorter) message list and the summary text.
 * The caller is responsible for marking the original DB rows as compressed.
 */
export declare function compressContext(messages: Message[], dbMessages: DbMessage[], provider: LLMProvider, model: string): Promise<{
    messages: Message[];
    summary: string;
    compressedIds: string[];
}>;
//# sourceMappingURL=compressor.d.ts.map