import crypto from "node:crypto";
import { insertMessage } from "../db/index.js";
import { logAssistantReply } from "./delivery.js";
const defaultDependencies = {
    appendRunEvent: () => { },
    setRunStepStatus: () => { },
    insertMessage,
    writeReplyLog: logAssistantReply,
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
};
export function prepareRunForReview(params) {
    const dependencies = { ...defaultDependencies, ...params.dependencies };
    if (params.workerSessionId) {
        dependencies.appendRunEvent(params.runId, `${params.workerSessionId} 실행 종료`);
    }
    if (params.persistRuntimePreview && params.preview.trim()) {
        dependencies.insertMessage({
            id: dependencies.createId(),
            session_id: params.sessionId,
            root_run_id: params.runId,
            role: "assistant",
            content: params.preview,
            tool_calls: null,
            tool_call_id: null,
            created_at: dependencies.now(),
        });
    }
    dependencies.writeReplyLog(params.source, params.preview);
    dependencies.setRunStepStatus(params.runId, "executing", "completed", params.preview || "응답 생성을 마쳤습니다.");
    dependencies.setRunStepStatus(params.runId, "reviewing", "running", "남은 작업이 있는지 검토 중입니다.");
}
//# sourceMappingURL=review-transition.js.map