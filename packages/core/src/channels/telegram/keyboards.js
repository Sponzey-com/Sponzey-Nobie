import { InlineKeyboard } from "grammy";
export function buildApprovalKeyboard(runId) {
    return new InlineKeyboard()
        .text("✅ 전체 승인", `approve:${runId}:all`)
        .row()
        .text("🔹 이번 단계만", `approve:${runId}:once`)
        .row()
        .text("❌ 거부 후 취소", `deny:${runId}`);
}
export function buildResultKeyboard(label) {
    return new InlineKeyboard().text(label, "noop");
}
//# sourceMappingURL=keyboards.js.map