import type { TelegramConfig } from "../../config/types.js";
import type { ChannelRoom } from "../contracts.js";
export declare function telegramAllowedRoomIdsForChatType(chatType: string, allowedGroupIds: number[]): number[];
export declare function telegramRoomTypeForChatType(chatType: string): NonNullable<ChannelRoom["type"]>;
export declare function isAllowedUser(userId: number, chatType: string, chatId: number, config: TelegramConfig): boolean;
//# sourceMappingURL=auth.d.ts.map
