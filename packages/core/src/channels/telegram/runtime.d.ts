import type { TelegramChannel } from "./bot.js";
export declare function setActiveTelegramChannel(channel: TelegramChannel | null): void;
export declare function getActiveTelegramChannel(): TelegramChannel | null;
export declare function setTelegramRuntimeError(message: string | null): void;
export declare function getTelegramRuntimeError(): string | null;
export declare function stopActiveTelegramChannel(): void;
//# sourceMappingURL=runtime.d.ts.map