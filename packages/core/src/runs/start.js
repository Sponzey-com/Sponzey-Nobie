import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { reviewTaskCompletion } from "../agent/completion-review.js";
import { analyzeTaskIntake } from "../agent/intake.js";
import { runAgent } from "../agent/index.js";
import { eventBus } from "../events/index.js";
import { getDb, getSession, insertMessage, insertSchedule, insertSession } from "../db/index.js";
import { getConfig } from "../config/index.js";
import { inferProviderId } from "../ai/index.js";
import { createLogger } from "../logger/index.js";
import { loadMergedInstructions } from "../instructions/merge.js";
import { loadNobieMd } from "../memory/nobie-md.js";
import { resolveRunRoute } from "./routing.js";
import { isValidCron } from "../scheduler/cron.js";
import { buildScheduledFollowupPrompt, getScheduledRunExecutionOptions } from "./scheduled.js";
import { grantRunApprovalScope, grantRunSingleApproval } from "../tools/dispatcher.js";
import { appendRunEvent, bindActiveRunController, clearActiveRunController, createRootRun, cancelRootRun, getRootRun, findLatestWorkerSessionRun, findReconnectRequestGroupSelection, incrementDelegationTurnCount, interruptOrphanWorkerSessionRuns, setRunStepStatus, updateRunStatus, updateRunSummary, } from "./store.js";
const log = createLogger("runs:start");
const MAX_DELAY_TIMER_MS = 2_147_483_647;
const delayedRunTimers = new Map();
const delayedSessionQueues = new Map();
const requestGroupExecutionQueues = new Map();
const syntheticApprovalScopes = new Set();
function normalizeTaskProfile(taskProfile) {
    switch (taskProfile) {
        case "planning":
        case "coding":
        case "review":
        case "research":
        case "private_local":
        case "summarization":
        case "operations":
            return taskProfile;
        default:
            return "general_chat";
    }
}
function mapTaskProfileToWorkerRole(taskProfile) {
    switch (taskProfile) {
        case "coding":
            return "coding";
        case "research":
            return "research";
        case "review":
            return "verification";
        case "operations":
        case "private_local":
            return "local-ops";
        case "planning":
        case "summarization":
            return "planning";
        default:
            return "general";
    }
}
function buildWorkerSessionId(params) {
    if (params.isRootRequest && !params.workerRuntime)
        return undefined;
    const workerRole = mapTaskProfileToWorkerRole(params.taskProfile);
    const rawTarget = params.workerRuntime?.kind || params.targetId || "default";
    const normalizedTarget = rawTarget
        .replace(/^provider:/, "")
        .replace(/^worker:/, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    return `B-${params.requestGroupId.slice(0, 8)}-${workerRole}-${normalizedTarget || "default"}`;
}
function shouldReuseConversationContext(message) {
    const trimmed = message.trim();
    if (!trimmed)
        return false;
    const koreanReferencePatterns = [
        /(?:아까|방금|이전|전에|앞에서|위에서)\b/u,
        /(?:기존(?:에)?|만들었던|만든|작성한|열었던|하던)\s*(?:것|거|파일|폴더|프로그램|화면|페이지)?/u,
        /(?:그|저)\s*(?:것|거|파일|폴더|프로그램|화면|페이지|코드|달력|계산기)/u,
        /(?:수정|고쳐|바꿔|이어(?:서)?|계속(?:해서)?|추가(?:해)?|보완(?:해)?|업데이트(?:해)?|리팩터링(?:해)?)/u,
    ];
    if (koreanReferencePatterns.some((pattern) => pattern.test(trimmed))) {
        return true;
    }
    const englishReferencePatterns = [
        /\b(?:previous|earlier|before|existing)\b/i,
        /\b(?:that|it|those)\s+(?:file|folder|program|page|screen|code|calendar|calculator)\b/i,
        /\b(?:modify|edit|fix|change|continue|resume|update|extend|improve|refactor)\b/i,
        /\b(?:the file|the folder|the program|the page|the code)\b/i,
    ];
    return englishReferencePatterns.some((pattern) => pattern.test(trimmed));
}
function markAbortedRunCancelledIfActive(runId) {
    const current = getRootRun(runId);
    if (!current)
        return;
    if (current.status === "interrupted" || current.status === "cancelled" || current.status === "completed" || current.status === "failed") {
        return;
    }
    updateRunStatus(runId, "cancelled", "사용자가 실행을 취소했습니다.", false);
}
function inferDelegatedTaskProfile(params) {
    const payload = params.action.payload;
    const explicit = getString(payload.task_profile) || getString(payload.taskProfile);
    if (explicit)
        return explicit;
    const combined = [
        params.originalMessage,
        params.intake.intent.summary,
        params.action.title,
        getString(payload.goal) || "",
        getString(payload.context) || "",
    ].join("\n");
    if (requestRequiresFilesystemMutation(combined) || /(코드|프로그램|웹\s*페이지|html|css|javascript|typescript|react|vue|앱|app|script|component|폴더|파일|directory|folder|file|code|program|web\s*app|ui)/iu.test(combined)) {
        return "coding";
    }
    if (/(검색|리서치|조사|최신|뉴스|공식\s*문서|웹\s*검색|browse|search|research|latest|current|news|official\s*docs?|documentation|web)/iu.test(combined)) {
        return "research";
    }
    if (/(검토|리뷰|원인|버그|문제\s*분석|review|bug|issue|root cause|investigat)/iu.test(combined)) {
        return "review";
    }
    if (/(요약|정리|summar|digest)/iu.test(combined)) {
        return "summarization";
    }
    if (/(설치|실행|운영|프로세스|서비스|daemon|shell|command|환경\s*설정|automation|deploy|runbook)/iu.test(combined)) {
        return "operations";
    }
    return "general_chat";
}
export function startRootRun(params) {
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const runId = crypto.randomUUID();
    const shouldReconnectGroup = params.requestGroupId == null && shouldReuseConversationContext(params.message);
    const reconnectSelection = shouldReconnectGroup
        ? findReconnectRequestGroupSelection(sessionId, params.message)
        : undefined;
    const reconnectTarget = reconnectSelection?.best;
    const reconnectNeedsClarification = Boolean(shouldReconnectGroup && params.requestGroupId == null && (!reconnectTarget || reconnectSelection?.ambiguous));
    const requestGroupId = params.requestGroupId ?? (reconnectNeedsClarification ? runId : reconnectTarget?.requestGroupId) ?? runId;
    const isRootRequest = requestGroupId === runId;
    const controller = new AbortController();
    const targetId = params.targetId ?? (params.model ? inferProviderId(params.model) : undefined);
    const effectiveTaskProfile = normalizeTaskProfile(params.taskProfile);
    const now = Date.now();
    const workDir = params.workDir ?? process.cwd();
    const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns;
    const shouldReuseContext = shouldReuseConversationContext(params.message);
    const effectiveContextMode = params.contextMode ?? (isRootRequest ? (shouldReuseContext ? "full" : "isolated") : "request_group");
    const workerSessionId = buildWorkerSessionId({
        isRootRequest,
        requestGroupId,
        taskProfile: effectiveTaskProfile,
        ...(targetId ? { targetId } : {}),
        ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
    });
    const reusableWorkerSessionRun = workerSessionId
        ? findLatestWorkerSessionRun(requestGroupId, workerSessionId)
        : undefined;
    ensureSessionExists(sessionId, params.source, now);
    const run = createRootRun({
        id: runId,
        sessionId,
        requestGroupId,
        prompt: params.message,
        source: params.source,
        maxDelegationTurns,
        ...(targetId ? { targetId } : {}),
        ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
        taskProfile: effectiveTaskProfile,
        ...(params.workerRuntime ? { workerRuntimeKind: params.workerRuntime.kind } : {}),
        ...(workerSessionId ? { workerSessionId } : {}),
        contextMode: effectiveContextMode,
    });
    bindActiveRunController(runId, controller);
    const interruptedWorkerRuns = workerSessionId
        ? interruptOrphanWorkerSessionRuns({
            requestGroupId,
            workerSessionId,
            keepRunId: runId,
        })
        : [];
    const queuedBehindRequestGroupRun = requestGroupExecutionQueues.has(requestGroupId);
    setRunStepStatus(runId, "received", "completed", "요청을 받았습니다.");
    setRunStepStatus(runId, "classified", "completed", "일반 채팅 요청으로 분류했습니다.");
    setRunStepStatus(runId, "target_selected", "completed", params.targetLabel?.trim()
        ? `${params.targetLabel.trim()} 대상을 선택했습니다.`
        : params.model?.trim()
            ? `${params.model.trim()} 모델을 선택했습니다.`
            : "기본 실행 대상을 선택했습니다.");
    if (queuedBehindRequestGroupRun) {
        setRunStepStatus(runId, "executing", "pending", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.");
        updateRunStatus(runId, "queued", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.", true);
        appendRunEvent(runId, "같은 요청 그룹의 이전 작업 대기");
    }
    else {
        setRunStepStatus(runId, "executing", "running", "응답을 생성 중입니다.");
        updateRunStatus(runId, "running", "응답을 생성 중입니다.", true);
        appendRunEvent(runId, "실행 시작");
    }
    if (reconnectTarget && requestGroupId !== runId) {
        appendRunEvent(runId, `기존 요청 그룹 재연결: ${reconnectTarget.title}`);
        updateRunSummary(runId, `기존 요청 "${reconnectTarget.title}" 작업 흐름에 이어서 연결합니다.`);
    }
    if (workerSessionId) {
        if (reusableWorkerSessionRun) {
            appendRunEvent(runId, `기존 작업 세션 재사용: ${workerSessionId}`);
        }
        else {
            appendRunEvent(runId, `새 작업 세션 생성: ${workerSessionId}`);
        }
        appendRunEvent(runId, `작업 세션 연결: ${workerSessionId}`);
        if (interruptedWorkerRuns.length > 0) {
            appendRunEvent(runId, `이전 작업 세션 잔여 실행 ${interruptedWorkerRuns.length}건 정리`);
        }
    }
    const finished = enqueueRequestGroupRun(requestGroupId, runId, async () => {
        let failed = false;
        let currentMessage = params.message;
        const priorAssistantMessages = [];
        const seenFollowupPrompts = new Set();
        let activeWorkerRuntime = params.workerRuntime;
        const requiresFilesystemMutation = requestRequiresFilesystemMutation(params.message);
        const pendingToolParams = new Map();
        const filesystemMutationPaths = new Set();
        let sawRealFilesystemMutation = false;
        let filesystemMutationRecoveryAttempted = false;
        let truncatedOutputRecoveryAttempted = false;
        if (queuedBehindRequestGroupRun && !controller.signal.aborted) {
            setRunStepStatus(runId, "executing", "running", "응답을 생성 중입니다.");
            updateRunStatus(runId, "running", "응답을 생성 중입니다.", true);
            appendRunEvent(runId, "대기 종료 후 실행 시작");
        }
        if (activeWorkerRuntime && requiresFilesystemMutation) {
            appendRunEvent(runId, `${activeWorkerRuntime.label} 대신 로컬 작업 도구로 실행을 전환합니다.`);
            updateRunSummary(runId, '실제 파일/폴더 작업을 위해 로컬 도구 실행으로 전환합니다.');
            log.info('worker runtime bypassed for filesystem mutation request', {
                runId,
                sessionId,
                workerRuntime: activeWorkerRuntime.kind,
            });
            activeWorkerRuntime = undefined;
        }
        try {
            await new Promise((resolve) => setImmediate(resolve));
            if (!params.skipIntake) {
                const handled = await tryHandleIntakeBridge({
                    message: params.message,
                    sessionId,
                    requestGroupId,
                    model: params.model,
                    workDir,
                    source: params.source,
                    runId,
                    onChunk: params.onChunk,
                });
                if (handled) {
                    return getRootRun(runId);
                }
            }
            if (reconnectNeedsClarification) {
                appendRunEvent(runId, "기존 작업 수정 대상 확인 필요");
                await moveRunToAwaitingUser(runId, sessionId, params.source, params.onChunk, {
                    preview: "",
                    summary: reconnectTarget
                        ? "수정할 기존 작업 후보가 여러 개라서 확인이 필요합니다."
                        : "수정할 기존 작업을 찾지 못해 확인이 필요합니다.",
                    reason: reconnectTarget
                        ? "같은 채팅 안에 비슷한 작업이 여러 개 있어 자동으로 하나를 선택하지 않았습니다."
                        : "참조형 수정 요청으로 보이지만 연결할 기존 작업 후보를 찾지 못했습니다.",
                    userMessage: reconnectTarget
                        ? "어느 기존 작업을 수정하려는지 더 구체적으로 적어 주세요. 폴더명이나 파일명, 예를 들어 달력 또는 계산기처럼 지정해 주세요."
                        : "수정할 기존 작업을 더 구체적으로 적어 주세요. 폴더명, 파일명, 프로그램명 중 하나를 함께 적어 주세요.",
                    remainingItems: reconnectSelection?.candidates?.length
                        ? reconnectSelection.candidates.map((candidate) => `후보: ${candidate.title}`)
                        : ["수정할 대상 작업 이름 또는 경로를 지정해 주세요."],
                });
                return getRootRun(runId);
            }
            while (!controller.signal.aborted) {
                let preview = "";
                failed = false;
                if (activeWorkerRuntime && workerSessionId) {
                    appendRunEvent(runId, `${workerSessionId} 실행 시작`);
                    updateRunSummary(runId, `${activeWorkerRuntime.label}에서 작업을 실행 중입니다.`);
                }
                const chunkStream = runAgent({
                    userMessage: currentMessage,
                    sessionId,
                    runId,
                    model: params.model,
                    ...(params.providerId ? { providerId: params.providerId } : {}),
                    ...(params.provider ? { provider: params.provider } : {}),
                    workDir,
                    source: params.source,
                    signal: controller.signal,
                    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
                    ...(isRootRequest ? {} : { requestGroupId }),
                    contextMode: effectiveContextMode,
                });
                for await (const chunk of chunkStream) {
                    if (chunk.type === "text") {
                        preview = `${preview}${chunk.delta}`.trim();
                        if (preview)
                            updateRunSummary(runId, preview.slice(-500));
                    }
                    else if (chunk.type === "tool_start") {
                        pendingToolParams.set(chunk.toolName, chunk.params);
                        const summary = `${chunk.toolName} 실행 중`;
                        appendRunEvent(runId, `${chunk.toolName} 실행 시작`);
                        updateRunSummary(runId, summary);
                    }
                    else if (chunk.type === "tool_end") {
                        const toolParams = pendingToolParams.get(chunk.toolName);
                        pendingToolParams.delete(chunk.toolName);
                        if (chunk.success && isRealFilesystemMutation(chunk.toolName, toolParams)) {
                            sawRealFilesystemMutation = true;
                            for (const mutationPath of collectFilesystemMutationPaths(chunk.toolName, toolParams, workDir)) {
                                filesystemMutationPaths.add(mutationPath);
                            }
                        }
                        const summary = chunk.success ? `${chunk.toolName} 실행 완료` : `${chunk.toolName} 실행 실패`;
                        appendRunEvent(runId, summary);
                        updateRunSummary(runId, summary);
                    }
                    else if (chunk.type === "error") {
                        failed = !controller.signal.aborted;
                        appendRunEvent(runId, chunk.message);
                        if (activeWorkerRuntime && workerSessionId) {
                            appendRunEvent(runId, `${workerSessionId} 실행 실패`);
                        }
                        if (controller.signal.aborted) {
                            markAbortedRunCancelledIfActive(runId);
                        }
                        else {
                            setRunStepStatus(runId, "executing", "failed", chunk.message);
                            updateRunStatus(runId, "failed", chunk.message, false);
                        }
                    }
                    await deliverChunk(params.onChunk, chunk, runId);
                }
                if (controller.signal.aborted || failed) {
                    break;
                }
                if (requiresFilesystemMutation && !sawRealFilesystemMutation) {
                    if (filesystemMutationRecoveryAttempted) {
                        await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                            preview,
                            summary: "실제 파일/폴더 생성 또는 수정이 확인되지 않아 자동 진행을 멈췄습니다.",
                            reason: "응답 내용만 생성되었고 실제 로컬 파일 작업이 확인되지 않았습니다.",
                            remainingItems: [
                                "요청한 파일 또는 폴더가 실제로 생성되거나 수정되지 않았습니다.",
                                "로컬 도구 실행 권한과 대상 경로를 다시 확인해 주세요.",
                            ],
                        });
                        break;
                    }
                    filesystemMutationRecoveryAttempted = true;
                    appendRunEvent(runId, "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.");
                    updateRunSummary(runId, "실제 파일/폴더 작업을 다시 시도합니다.");
                    setRunStepStatus(runId, "executing", "running", "실제 파일/폴더 작업을 다시 시도합니다.");
                    updateRunStatus(runId, "running", "실제 파일/폴더 작업을 다시 시도합니다.", true);
                    activeWorkerRuntime = undefined;
                    currentMessage = buildFilesystemMutationFollowupPrompt({
                        originalRequest: params.message,
                        previousResult: preview,
                    });
                    continue;
                }
                if (requiresFilesystemMutation && sawRealFilesystemMutation) {
                    const verification = await runFilesystemVerificationSubtask({
                        parentRunId: runId,
                        requestGroupId,
                        sessionId,
                        source: params.source,
                        onChunk: params.onChunk,
                        originalRequest: params.message,
                        mutationPaths: [...filesystemMutationPaths],
                        workDir,
                    });
                    if (!verification.ok) {
                        await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                            preview,
                            summary: verification.summary,
                            ...(verification.reason ? { reason: verification.reason } : {}),
                            ...(verification.remainingItems ? { remainingItems: verification.remainingItems } : {}),
                        });
                        break;
                    }
                    appendRunEvent(runId, "실제 파일/폴더 결과 검증을 완료했습니다.");
                    updateRunSummary(runId, verification.summary);
                    preview = [preview.trim(), verification.summary].filter(Boolean).join("\n\n");
                }
                if (activeWorkerRuntime && workerSessionId) {
                    appendRunEvent(runId, `${workerSessionId} 실행 종료`);
                }
                if (activeWorkerRuntime && preview) {
                    insertMessage({
                        id: crypto.randomUUID(),
                        session_id: sessionId,
                        root_run_id: runId,
                        role: "assistant",
                        content: preview,
                        tool_calls: null,
                        tool_call_id: null,
                        created_at: Date.now(),
                    });
                }
                logAssistantReply(params.source, preview);
                setRunStepStatus(runId, "executing", "completed", preview || "응답 생성을 마쳤습니다.");
                setRunStepStatus(runId, "reviewing", "running", "남은 작업이 있는지 검토 중입니다.");
                const review = await reviewTaskCompletion({
                    originalRequest: params.message,
                    latestAssistantMessage: preview,
                    priorAssistantMessages,
                    ...(params.model ? { model: params.model } : {}),
                    ...(params.providerId ? { providerId: params.providerId } : {}),
                    ...(params.provider ? { provider: params.provider } : {}),
                    workDir,
                }).catch((error) => {
                    log.warn(`completion review failed: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                });
                priorAssistantMessages.push(preview);
                if (!review || review.status === "complete") {
                    const reviewSummary = review?.summary?.trim() || preview || "실행을 완료했습니다.";
                    setRunStepStatus(runId, "reviewing", "completed", reviewSummary);
                    setRunStepStatus(runId, "finalizing", "completed", "실행 결과를 저장했습니다.");
                    setRunStepStatus(runId, "completed", "completed", preview || "실행을 완료했습니다.");
                    updateRunStatus(runId, "completed", preview || "실행을 완료했습니다.", false);
                    appendRunEvent(runId, "실행 완료");
                    break;
                }
                const currentRun = getRootRun(runId);
                const usedTurns = currentRun?.delegationTurnCount ?? 0;
                const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns;
                if (review.status === "followup") {
                    const followupPrompt = review.followupPrompt?.trim();
                    const normalizedPrompt = followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase();
                    if (!followupPrompt) {
                        await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                            preview,
                            summary: review.summary || "추가 작업이 남아 있지만 후속 지시가 비어 있습니다.",
                            reason: review.reason || "후속 처리 지시 생성 실패",
                            remainingItems: review.remainingItems,
                        });
                        break;
                    }
                    if (normalizedPrompt && seenFollowupPrompts.has(normalizedPrompt)) {
                        await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                            preview,
                            summary: "같은 후속 지시가 반복되어 자동 진행을 멈췄습니다.",
                            reason: review.reason || "반복 후속 지시 감지",
                            remainingItems: review.remainingItems,
                        });
                        break;
                    }
                    if (maxTurns > 0 && usedTurns >= maxTurns) {
                        await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                            preview,
                            summary: `자동 후속 처리 한도(${maxTurns}회)에 도달했습니다.`,
                            reason: review.reason || "최대 자동 후속 처리 횟수 초과",
                            remainingItems: review.remainingItems,
                        });
                        break;
                    }
                    if (normalizedPrompt) {
                        seenFollowupPrompts.add(normalizedPrompt);
                    }
                    incrementDelegationTurnCount(runId, review.summary || "추가 자동 처리를 시작합니다.");
                    appendRunEvent(runId, `후속 처리 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`);
                    setRunStepStatus(runId, "reviewing", "completed", review.summary || "추가 처리가 필요합니다.");
                    setRunStepStatus(runId, "executing", "running", review.summary || "추가 자동 처리를 시작합니다.");
                    currentMessage = followupPrompt;
                    continue;
                }
                if (shouldRetryTruncatedOutput({
                    review,
                    preview,
                    originalRequest: params.message,
                    requiresFilesystemMutation,
                })) {
                    if (!truncatedOutputRecoveryAttempted) {
                        if (maxTurns > 0 && usedTurns >= maxTurns) {
                            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                                preview,
                                summary: `자동 후속 처리 한도(${maxTurns}회)에 도달했습니다.`,
                                reason: review.reason || "최대 자동 후속 처리 횟수 초과",
                                remainingItems: review.remainingItems,
                                ...(review.userMessage ? { userMessage: review.userMessage } : {}),
                            });
                            break;
                        }
                        truncatedOutputRecoveryAttempted = true;
                        incrementDelegationTurnCount(runId, review.summary || "중간에 끊긴 작업을 자동으로 다시 시도합니다.");
                        appendRunEvent(runId, `중간 절단 복구 재시도 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`);
                        setRunStepStatus(runId, "reviewing", "completed", review.summary || "중간에 끊긴 작업을 다시 시도합니다.");
                        setRunStepStatus(runId, "executing", "running", "중간에 끊긴 작업을 자동으로 다시 시도합니다.");
                        updateRunStatus(runId, "running", "중간에 끊긴 작업을 자동으로 다시 시도합니다.", true);
                        activeWorkerRuntime = undefined;
                        currentMessage = buildTruncatedOutputRecoveryPrompt({
                            originalRequest: params.message,
                            previousResult: preview,
                            summary: review.summary,
                            reason: review.reason,
                            remainingItems: review.remainingItems,
                        });
                        continue;
                    }
                }
                const syntheticApproval = detectSyntheticApprovalRequest({
                    originalRequest: params.message,
                    preview,
                    review,
                    usesWorkerRuntime: Boolean(activeWorkerRuntime),
                });
                if (syntheticApproval) {
                    if (syntheticApprovalScopes.has(runId)) {
                        appendRunEvent(runId, `${syntheticApproval.toolName} 전체 승인 상태로 계속 진행합니다.`);
                        setRunStepStatus(runId, "reviewing", "completed", review.summary || syntheticApproval.summary);
                        setRunStepStatus(runId, "executing", "running", "승인된 작업을 계속 진행합니다.");
                        updateRunStatus(runId, "running", "승인된 작업을 계속 진행합니다.", true);
                        activeWorkerRuntime = undefined;
                        currentMessage = syntheticApproval.continuationPrompt;
                        continue;
                    }
                    const decision = await requestSyntheticApproval({
                        runId,
                        sessionId,
                        toolName: syntheticApproval.toolName,
                        summary: syntheticApproval.summary,
                        ...(syntheticApproval.guidance ? { guidance: syntheticApproval.guidance } : {}),
                        params: {
                            source: activeWorkerRuntime?.kind ?? "worker_runtime",
                            originalRequest: params.message,
                            latestAssistantMessage: preview,
                        },
                        signal: controller.signal,
                    });
                    if (decision === "deny" || controller.signal.aborted) {
                        break;
                    }
                    if (decision === "allow_run") {
                        syntheticApprovalScopes.add(runId);
                        grantRunApprovalScope(runId);
                    }
                    else {
                        grantRunSingleApproval(runId);
                    }
                    appendRunEvent(runId, decision === "allow_run" ? `${syntheticApproval.toolName} 전체 승인` : `${syntheticApproval.toolName} 단계 승인`);
                    setRunStepStatus(runId, "reviewing", "completed", review.summary || syntheticApproval.summary);
                    setRunStepStatus(runId, "executing", "running", "승인된 작업을 계속 진행합니다.");
                    updateRunStatus(runId, "running", "승인된 작업을 계속 진행합니다.", true);
                    activeWorkerRuntime = undefined;
                    currentMessage = syntheticApproval.continuationPrompt;
                    continue;
                }
                await moveRunToAwaitingUser(runId, sessionId, params.source, params.onChunk, {
                    preview,
                    summary: review.summary || "사용자 추가 입력이 필요합니다.",
                    reason: review.reason,
                    remainingItems: review.remainingItems,
                    ...(review.userMessage ? { userMessage: review.userMessage } : {}),
                });
                break;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (controller.signal.aborted) {
                markAbortedRunCancelledIfActive(runId);
            }
            else {
                setRunStepStatus(runId, "executing", "failed", message);
                updateRunStatus(runId, "failed", message, false);
                appendRunEvent(runId, message);
            }
            await deliverChunk(params.onChunk, { type: "error", message }, runId);
        }
        finally {
            syntheticApprovalScopes.delete(runId);
            clearActiveRunController(runId);
        }
        return getRootRun(runId);
    });
    return {
        runId: run.id,
        sessionId,
        status: "started",
        finished,
    };
}
function detectSyntheticApprovalRequest(params) {
    if (!params.usesWorkerRuntime)
        return null;
    if (params.review.status !== "ask_user")
        return null;
    const combined = [params.preview, params.review.reason, params.review.userMessage]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n");
    const looksLikePermission = /(허용|승인|권한|allow|approve|permission)/i.test(combined);
    if (!looksLikePermission)
        return null;
    return {
        toolName: inferSyntheticApprovalToolName(combined),
        summary: params.review.summary || "로컬 작업 진행 전 사용자 승인이 필요합니다.",
        guidance: params.review.userMessage?.trim() || "계속 진행을 허용하면 같은 요청 안에서 실제 작업을 이어서 수행합니다.",
        continuationPrompt: buildSyntheticApprovalContinuationPrompt({
            originalRequest: params.originalRequest,
            preview: params.preview,
        }),
    };
}
function inferSyntheticApprovalToolName(text) {
    if (/(파일|폴더|쓰기|생성|write|file|folder|directory)/i.test(text)) {
        return "file_write";
    }
    if (/(프로그램|앱|실행|launch|application|program)/i.test(text)) {
        return "app_launch";
    }
    return "external_action";
}
function buildSyntheticApprovalContinuationPrompt(params) {
    return [
        "[Approval Granted Continuation]",
        "사용자가 앞서 요청된 로컬 작업을 승인했습니다.",
        `원래 사용자 요청: ${params.originalRequest}`,
        `이전 승인 요청 응답: ${params.preview}`,
        "이제 실제 작업을 계속 진행하세요.",
        "같은 권한 요청을 다시 반복하지 마세요.",
        "사용 가능한 로컬 도구를 이용해 승인된 작업을 실제로 수행하고 마무리하세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요. 사용자가 번역을 요청하지 않았다면 언어를 바꾸지 마세요.",
    ].join("\n\n");
}
async function requestSyntheticApproval(params) {
    const timeoutSec = getConfig().security.approvalTimeout;
    const fallback = getConfig().security.approvalTimeoutFallback === "allow" ? "allow_once" : "deny";
    appendRunEvent(params.runId, `${params.toolName} 승인 요청`);
    setRunStepStatus(params.runId, "reviewing", "completed", params.summary);
    setRunStepStatus(params.runId, "awaiting_approval", "running", params.summary);
    updateRunStatus(params.runId, "awaiting_approval", params.summary, true);
    log.info("synthetic approval requested", {
        runId: params.runId,
        sessionId: params.sessionId,
        toolName: params.toolName,
    });
    return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (resolved)
                return;
            resolved = true;
            appendRunEvent(params.runId, `${params.toolName} 승인 시간 초과`);
            setRunStepStatus(params.runId, "awaiting_approval", "cancelled", `${params.toolName} 승인 대기 시간이 지났습니다.`);
            if (fallback === "deny") {
                cancelRootRun(params.runId);
            }
            else {
                setRunStepStatus(params.runId, "executing", "running", `${params.toolName} 실행을 계속합니다.`);
                updateRunStatus(params.runId, "running", `${params.toolName} 실행을 계속합니다.`, true);
            }
            eventBus.emit("approval.resolved", { runId: params.runId, decision: fallback, toolName: params.toolName });
            resolve(fallback);
        }, Math.max(5, timeoutSec) * 1000);
        params.signal.addEventListener("abort", () => {
            if (resolved)
                return;
            resolved = true;
            clearTimeout(timeout);
            resolve("deny");
        }, { once: true });
        eventBus.emit("approval.request", {
            runId: params.runId,
            toolName: params.toolName,
            params: params.params,
            kind: "approval",
            ...(params.guidance ? { guidance: params.guidance } : {}),
            resolve: (decision) => {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timeout);
                if (decision === "deny") {
                    appendRunEvent(params.runId, `${params.toolName} 실행 거부`);
                    setRunStepStatus(params.runId, "awaiting_approval", "cancelled", `${params.toolName} 실행이 거부되어 요청을 취소했습니다.`);
                    cancelRootRun(params.runId);
                }
                else {
                    setRunStepStatus(params.runId, "awaiting_approval", "completed", decision === "allow_run"
                        ? `${params.toolName} 실행을 이 요청 전체에 대해 허용했습니다.`
                        : `${params.toolName} 실행을 이번 단계에 대해 허용했습니다.`);
                }
                resolve(decision);
            },
        });
    });
}
async function moveRunToAwaitingUser(runId, sessionId, source, onChunk, params) {
    const message = buildAwaitingUserMessage(params);
    if (message) {
        await emitStandaloneAssistantMessage(runId, sessionId, message, source, onChunk);
    }
    const summary = params.summary || "추가 입력이 필요해 자동 진행을 멈췄습니다.";
    setRunStepStatus(runId, "reviewing", "completed", summary);
    setRunStepStatus(runId, "awaiting_user", "running", summary);
    updateRunStatus(runId, "awaiting_user", summary, true);
    appendRunEvent(runId, "사용자 추가 입력 대기");
}
async function moveRunToCancelledAfterStop(runId, sessionId, source, onChunk, params) {
    const message = buildAwaitingUserMessage(params);
    if (message) {
        await emitStandaloneAssistantMessage(runId, sessionId, message, source, onChunk);
    }
    const summary = params.summary || "자동 진행을 중단하고 요청을 취소했습니다.";
    setRunStepStatus(runId, "reviewing", "completed", summary);
    setRunStepStatus(runId, "finalizing", "completed", "중단 결과를 사용자에게 안내했습니다.");
    updateRunStatus(runId, "cancelled", summary, false);
    appendRunEvent(runId, "자동 진행 중단 후 요청 취소");
}
function ensureSessionExists(sessionId, source, now) {
    const existing = getSession(sessionId);
    if (!existing) {
        insertSession({
            id: sessionId,
            source,
            source_id: null,
            created_at: now,
            updated_at: now,
            summary: null,
        });
        return;
    }
    getDb()
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, sessionId);
}
async function tryHandleIntakeBridge(params) {
    const intakeSessionId = params.requestGroupId !== params.runId || shouldReuseConversationContext(params.message)
        ? params.sessionId
        : undefined;
    const intake = await analyzeTaskIntake({
        userMessage: params.message,
        ...(intakeSessionId ? { sessionId: intakeSessionId } : {}),
        requestGroupId: params.requestGroupId,
        ...(params.model ? { model: params.model } : {}),
        workDir: params.workDir,
    }).catch(() => null);
    if (!intake)
        return false;
    log.info("intake bridge result", {
        runId: params.runId,
        sessionId: params.sessionId,
        category: intake.intent.category,
        actions: intake.action_items.map((item) => item.type),
        scheduling: intake.scheduling,
    });
    appendRunEvent(params.runId, `Intake: ${intake.intent.category}`);
    if (intake.intent.summary.trim()) {
        updateRunSummary(params.runId, intake.intent.summary.trim());
    }
    const replyAction = intake.action_items.find((item) => item.type === "reply");
    if (replyAction) {
        const content = getString(replyAction.payload.content);
        if (content) {
            await completeRunWithAssistantMessage(params.runId, params.sessionId, content, params.source, params.onChunk);
            return true;
        }
    }
    const scheduleActions = intake.action_items.filter((item) => item.type === "create_schedule");
    const delegatedActions = intake.action_items.filter((item) => item.type === "run_task" || item.type === "delegate_agent");
    if (scheduleActions.length > 0 || delegatedActions.length > 0 || intake.intent.category === "schedule_request") {
        const responseParts = [];
        if (scheduleActions.length > 0 || intake.intent.category === "schedule_request") {
            const scheduleResult = executeCreateScheduleActions(scheduleActions, intake, params);
            log.info("schedule action handled", {
                runId: params.runId,
                sessionId: params.sessionId,
                count: scheduleActions.length,
                ok: scheduleResult.ok,
                message: scheduleResult.message,
            });
            if (scheduleResult.message.trim()) {
                responseParts.push(scheduleResult.message.trim());
            }
        }
        if (delegatedActions.length > 0) {
            const delegatedReceipt = buildDelegatedReceipt(intake, delegatedActions, responseParts.length > 0);
            if (delegatedReceipt)
                responseParts.push(delegatedReceipt);
        }
        if (responseParts.length > 0) {
            await completeRunWithAssistantMessage(params.runId, params.sessionId, responseParts.join("\n\n"), params.source, params.onChunk);
        }
        for (const delegatedAction of delegatedActions) {
            const delegatedTaskProfile = inferDelegatedTaskProfile({
                originalMessage: params.message,
                intake,
                action: delegatedAction,
            });
            const followupPrompt = buildFollowupPrompt(params.message, intake, delegatedAction, delegatedTaskProfile);
            const route = resolveRunRoute({
                preferredTarget: getString(delegatedAction.payload.preferred_target)
                    || getString(delegatedAction.payload.preferredTarget)
                    || intake.execution.suggested_target,
                taskProfile: delegatedTaskProfile,
                fallbackModel: params.model,
            });
            appendRunEvent(params.runId, route.targetLabel
                ? `후속 실행 생성: ${delegatedAction.title} -> ${route.targetLabel} (${delegatedTaskProfile})`
                : `후속 실행 생성: ${delegatedAction.title} (${delegatedTaskProfile})`);
            log.info("delegated follow-up run created", {
                runId: params.runId,
                sessionId: params.sessionId,
                delegatedType: delegatedAction.type,
                delegatedTitle: delegatedAction.title,
                delegatedTaskProfile,
                targetId: route.targetId ?? null,
                targetLabel: route.targetLabel ?? null,
                model: route.model ?? params.model ?? null,
                providerId: route.providerId ?? null,
                workerRuntime: route.workerRuntime?.kind ?? null,
            });
            incrementDelegationTurnCount(params.runId, `${delegatedAction.title} 후속 작업을 시작합니다.`);
            startRootRun({
                message: followupPrompt,
                sessionId: params.sessionId,
                taskProfile: normalizeTaskProfile(delegatedTaskProfile),
                requestGroupId: params.requestGroupId,
                model: route.model ?? params.model,
                ...(route.providerId ? { providerId: route.providerId } : {}),
                ...(route.provider ? { provider: route.provider } : {}),
                ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
                ...(route.targetId ? { targetId: route.targetId } : {}),
                ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
                workDir: params.workDir,
                source: params.source,
                skipIntake: true,
                onChunk: params.onChunk,
            });
        }
        return responseParts.length > 0 || delegatedActions.length > 0;
    }
    if (intake.user_message.mode === "clarification_receipt" || intake.user_message.mode === "failed_receipt") {
        const text = intake.user_message.text.trim();
        if (text) {
            await completeRunWithAssistantMessage(params.runId, params.sessionId, text, params.source, params.onChunk);
            return true;
        }
    }
    return false;
}
function executeCreateScheduleActions(actions, intake, params) {
    if (actions.length === 0) {
        const receipt = intake.user_message.text.trim();
        return {
            ok: false,
            message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
            detail: "일정 생성 항목이 없습니다.",
        };
    }
    if (actions.length === 1) {
        return executeCreateScheduleAction(actions[0], intake, params, intake.user_message.text.trim());
    }
    const results = actions.map((action) => executeCreateScheduleAction(action, intake, params, ""));
    const receipt = intake.user_message.text.trim() || "여러 예약 작업을 접수했습니다.";
    const heading = results.every((result) => result.ok)
        ? "일회성 예약 실행이 저장되었습니다."
        : "일부 일정 생성에 실패했습니다.";
    return {
        ok: results.every((result) => result.ok),
        message: [receipt, "", heading, ...results.map((result) => `- ${result.detail}`)].join("\n"),
        detail: results.map((result) => result.detail).join(" / "),
    };
}
function executeCreateScheduleAction(action, intake, params, receipt) {
    if (!action) {
        return {
            ok: false,
            message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
            detail: "일정 생성 정보가 부족합니다.",
        };
    }
    const title = getString(action.payload.title) || "Scheduled Task";
    const task = getString(action.payload.task) || intake.intent.summary || title;
    const cron = getString(action.payload.cron) || intake.scheduling.cron;
    const runAt = getString(action.payload.run_at) || intake.scheduling.run_at;
    const actionScheduleText = getString(action.payload.schedule_text);
    if (runAt) {
        const scheduledAt = Date.parse(runAt);
        if (Number.isNaN(scheduledAt)) {
            return {
                ok: false,
                message: receipt
                    ? `${receipt}\n\n일정 생성 실패: run_at 형식이 올바르지 않습니다.`
                    : "일정 생성 실패: run_at 형식이 올바르지 않습니다.",
                detail: `${actionScheduleText ?? title}: run_at 형식이 올바르지 않습니다.`,
            };
        }
        const followup = getFollowupRunPayload(action);
        log.info("registering delayed run", {
            sessionId: params.sessionId,
            title,
            runAt,
            task,
            preferredTarget: followup.preferredTarget ?? null,
            taskProfile: followup.taskProfile ?? null,
        });
        const scheduledTaskProfile = normalizeTaskProfile(followup.taskProfile ?? "general_chat");
        const executionOptions = getScheduledRunExecutionOptions(task, scheduledTaskProfile);
        scheduleDelayedRootRun({
            runAtMs: scheduledAt,
            message: buildScheduledFollowupPrompt({
                task,
                goal: followup.goal ?? task,
                taskProfile: scheduledTaskProfile,
                preferredTarget: followup.preferredTarget ?? intake.execution.suggested_target,
                toolsEnabled: executionOptions.toolsEnabled,
            }),
            sessionId: params.sessionId,
            requestGroupId: params.requestGroupId,
            model: params.model,
            source: params.source,
            onChunk: params.onChunk,
            toolsEnabled: executionOptions.toolsEnabled,
            contextMode: executionOptions.contextMode,
            ...(params.workDir ? { workDir: params.workDir } : {}),
            ...(followup.preferredTarget ? { preferredTarget: followup.preferredTarget } : {}),
            taskProfile: scheduledTaskProfile,
        });
        const scheduleText = actionScheduleText || new Date(scheduledAt).toLocaleString("ko-KR");
        return {
            ok: true,
            message: receipt
                ? `${receipt}\n\n일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`
                : `일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`,
            detail: `${scheduleText}: ${task}`,
        };
    }
    if (!cron || !isValidCron(cron)) {
        const reason = intake.scheduling.failure_reason
            ?? "현재 실행 브리지에서는 유효한 cron 일정이 필요합니다.";
        return {
            ok: false,
            message: receipt
                ? `${receipt}\n\n일정 생성 실패: ${reason}`
                : `일정 생성 실패: ${reason}`,
            detail: `${actionScheduleText ?? title}: ${reason}`,
        };
    }
    const now = Date.now();
    const scheduleId = crypto.randomUUID();
    insertSchedule({
        id: scheduleId,
        name: title,
        cron_expression: cron,
        prompt: task,
        enabled: 1,
        target_channel: "agent",
        model: params.model ?? null,
        max_retries: 3,
        timeout_sec: 300,
        created_at: now,
        updated_at: now,
    });
    const scheduleText = actionScheduleText || cron;
    return {
        ok: true,
        message: receipt
            ? `${receipt}\n\n스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}`
            : `스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}`,
        detail: `${scheduleText}: ${task}`,
    };
}
function buildDelegatedReceipt(intake, actions, appendMode) {
    if (actions.length === 0)
        return "";
    if (actions.length === 1) {
        const fallback = "요청을 접수했습니다. 후속 실행을 시작합니다.";
        if (appendMode)
            return "추가 후속 실행을 시작합니다.";
        return intake.user_message.text.trim() || fallback;
    }
    const lines = actions.map((action) => `- ${action.title}`);
    const header = appendMode
        ? "추가 후속 실행을 시작합니다."
        : (intake.user_message.text.trim() || "여러 요청을 접수했고 후속 실행을 시작합니다.");
    return [header, ...lines].join("\n");
}
function buildFollowupPrompt(originalMessage, intake, action, taskProfile) {
    const payload = action.payload;
    const goal = getString(payload.goal) || action.title;
    const context = getString(payload.context) || intake.intent.summary || originalMessage;
    const successCriteria = toStringList(payload.success_criteria);
    const constraints = toStringList(payload.constraints);
    const preferredTarget = getString(payload.preferred_target) || getString(payload.preferredTarget) || intake.execution.suggested_target;
    const requiresFilesystemMutation = requestRequiresFilesystemMutation(originalMessage);
    return [
        "[Task Intake Bridge]",
        "이 요청은 intake router에서 접수되어 후속 실행으로 전달되었습니다.",
        `원래 사용자 요청: ${originalMessage}`,
        `목표: ${goal}`,
        `문맥: ${context}`,
        `작업 프로필: ${taskProfile}`,
        preferredTarget ? `선호 대상: ${preferredTarget}` : "",
        successCriteria.length > 0 ? ["성공 조건:", ...successCriteria.map((item) => `- ${item}`)].join("\n") : "",
        constraints.length > 0 ? ["제약 사항:", ...constraints.map((item) => `- ${item}`)].join("\n") : "",
        "사용자가 지정한 이름, 따옴표 안 문자열, 파일명, 폴더명, 경로, 언어를 그대로 유지하세요. 폴더명 같은 리터럴을 번역하지 마세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요. 사용자가 번역을 요청하지 않았다면 언어를 바꾸지 마세요.",
        requiresFilesystemMutation
            ? "이 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다. 로컬 도구를 사용해 실제로 생성하거나 수정하세요. 코드 조각, 설명문, 수동 안내만 남기고 끝내지 마세요."
            : "지금 실제 작업을 수행하세요. 다시 intake 접수 메시지를 만들지 말고, 실제 결과를 만들어 내세요.",
    ].filter(Boolean).join("\n\n");
}
function getFollowupRunPayload(action) {
    const payload = action.payload.followup_run_payload;
    if (!payload || typeof payload !== "object") {
        return {};
    }
    const record = payload;
    const goal = getString(record.goal);
    const taskProfile = getString(record.task_profile) || getString(record.taskProfile);
    const preferredTarget = getString(record.preferred_target) || getString(record.preferredTarget);
    return {
        ...(goal ? { goal } : {}),
        ...(taskProfile ? { taskProfile } : {}),
        ...(preferredTarget ? { preferredTarget } : {}),
    };
}
async function completeRunWithAssistantMessage(runId, sessionId, text, source, onChunk) {
    eventBus.emit("agent.start", { sessionId, runId });
    if (text) {
        insertMessage({
            id: crypto.randomUUID(),
            session_id: sessionId,
            root_run_id: runId,
            role: "assistant",
            content: text,
            tool_calls: null,
            tool_call_id: null,
            created_at: Date.now(),
        });
        logAssistantReply(source, text);
        eventBus.emit("agent.stream", { sessionId, runId, delta: text });
        await deliverChunk(onChunk, { type: "text", delta: text }, runId);
    }
    eventBus.emit("agent.end", { sessionId, runId, durationMs: 0 });
    await deliverChunk(onChunk, { type: "done", totalTokens: 0 }, runId);
    setRunStepStatus(runId, "executing", "completed", text || "응답 생성을 마쳤습니다.");
    setRunStepStatus(runId, "reviewing", "completed", text || "응답을 정리했습니다.");
    setRunStepStatus(runId, "finalizing", "completed", "실행 결과를 저장했습니다.");
    setRunStepStatus(runId, "completed", "completed", text || "실행을 완료했습니다.");
    updateRunStatus(runId, "completed", text || "실행을 완료했습니다.", false);
    appendRunEvent(runId, "실행 완료");
}
async function emitStandaloneAssistantMessage(runId, sessionId, text, source, onChunk) {
    if (!text.trim())
        return;
    eventBus.emit("agent.start", { sessionId, runId });
    insertMessage({
        id: crypto.randomUUID(),
        session_id: sessionId,
        root_run_id: runId,
        role: "assistant",
        content: text,
        tool_calls: null,
        tool_call_id: null,
        created_at: Date.now(),
    });
    logAssistantReply(source, text);
    eventBus.emit("agent.stream", { sessionId, runId, delta: text });
    await deliverChunk(onChunk, { type: "text", delta: text }, runId);
    eventBus.emit("agent.end", { sessionId, runId, durationMs: 0 });
    await deliverChunk(onChunk, { type: "done", totalTokens: 0 }, runId);
}
function buildAwaitingUserMessage(params) {
    const remainingItems = params.remainingItems?.filter((item) => item.trim()) ?? [];
    const lines = [
        params.userMessage?.trim() || params.summary.trim(),
        params.preview.trim() ? `현재까지 결과:\n${params.preview.trim()}` : "",
        remainingItems.length > 0 ? `남은 항목:\n- ${remainingItems.join("\n- ")}` : "",
        params.reason?.trim() ? `중단 사유: ${params.reason.trim()}` : "",
    ].filter(Boolean);
    return lines.join("\n\n");
}
async function runFilesystemVerificationSubtask(params) {
    const runId = crypto.randomUUID();
    const prompt = buildFilesystemVerificationPrompt(params.originalRequest, params.mutationPaths);
    createRootRun({
        id: runId,
        sessionId: params.sessionId,
        requestGroupId: params.requestGroupId,
        prompt,
        source: params.source,
        taskProfile: "review",
        targetLabel: "결과 검증",
        contextMode: "request_group",
        maxDelegationTurns: 0,
    });
    appendRunEvent(params.parentRunId, "결과 검증 하위 작업을 생성했습니다.");
    setRunStepStatus(runId, "received", "completed", "결과 검증 하위 작업을 생성했습니다.");
    setRunStepStatus(runId, "classified", "completed", "파일 생성 결과 검증 요청으로 분류했습니다.");
    setRunStepStatus(runId, "target_selected", "completed", "로컬 파일 검증 대상을 선택했습니다.");
    setRunStepStatus(runId, "executing", "running", "생성 결과를 확인 중입니다.");
    updateRunStatus(runId, "running", "생성 결과를 확인 중입니다.", true);
    appendRunEvent(runId, "결과 검증 시작");
    const verification = verifyFilesystemTargets({
        originalRequest: params.originalRequest,
        mutationPaths: params.mutationPaths,
        workDir: params.workDir,
    });
    if (verification.ok) {
        await completeRunWithAssistantMessage(runId, params.sessionId, verification.message, params.source, params.onChunk);
        appendRunEvent(params.parentRunId, "결과 검증 하위 작업이 완료되었습니다.");
        return { ok: true, summary: verification.summary };
    }
    await emitStandaloneAssistantMessage(runId, params.sessionId, verification.message, params.source, params.onChunk);
    setRunStepStatus(runId, "executing", "failed", verification.summary);
    setRunStepStatus(runId, "reviewing", "failed", verification.summary);
    updateRunStatus(runId, "failed", verification.summary, false);
    appendRunEvent(runId, "결과 검증 실패");
    appendRunEvent(params.parentRunId, "결과 검증 하위 작업이 실패했습니다.");
    return {
        ok: false,
        summary: verification.summary,
        ...(verification.reason ? { reason: verification.reason } : {}),
        ...(verification.remainingItems ? { remainingItems: verification.remainingItems } : {}),
    };
}
function buildFilesystemVerificationPrompt(originalRequest, mutationPaths) {
    const lines = [
        "[Filesystem Verification]",
        `원래 사용자 요청: ${originalRequest}`,
    ];
    if (mutationPaths.length > 0) {
        lines.push("검증 대상 경로:");
        for (const mutationPath of mutationPaths)
            lines.push(`- ${mutationPath}`);
    }
    return lines.join("\n");
}
function verifyFilesystemTargets(params) {
    const targets = inferFilesystemVerificationTargets(params.originalRequest, params.mutationPaths, params.workDir);
    if (targets.length === 0) {
        return {
            ok: false,
            summary: "생성 결과를 검증할 경로를 찾지 못했습니다.",
            message: "검증 결과:\n- 검증할 파일 또는 폴더 경로를 자동으로 추론하지 못했습니다.",
            reason: "검증 대상 경로 추론 실패",
            remainingItems: ["생성 또는 수정이 일어난 경로를 다시 확인해 주세요."],
        };
    }
    const confirmed = [];
    const missing = [];
    const readableSummaries = [];
    for (const target of targets) {
        if (!existsSync(target.path)) {
            if (target.expect === "exists")
                missing.push(`${displayHomePath(target.path)} (${target.kind})`);
            else
                confirmed.push(`삭제 확인: ${displayHomePath(target.path)}`);
            continue;
        }
        const stat = safeStat(target.path);
        if (!stat) {
            missing.push(`${displayHomePath(target.path)} (${target.kind})`);
            continue;
        }
        if (target.expect === "missing") {
            missing.push(`${displayHomePath(target.path)} (삭제되어야 함)`);
            continue;
        }
        if (target.kind === "dir" && !stat.isDirectory()) {
            missing.push(`${displayHomePath(target.path)} (폴더가 아님)`);
            continue;
        }
        if (target.kind === "file" && !stat.isFile()) {
            missing.push(`${displayHomePath(target.path)} (파일이 아님)`);
            continue;
        }
        confirmed.push(`${target.kind === "dir" ? "폴더 확인" : "파일 확인"}: ${displayHomePath(target.path)}`);
        if (target.kind === "file" && readableSummaries.length < 2) {
            const snippet = safeReadSnippet(target.path);
            if (snippet)
                readableSummaries.push(`읽기 확인: ${displayHomePath(target.path)} -> ${snippet}`);
        }
    }
    if (missing.length > 0) {
        const remainingItems = missing.map((item) => `${item} 경로를 다시 확인해야 합니다.`);
        const lines = [
            "검증 결과:",
            ...confirmed.map((item) => `- ${item}`),
            ...readableSummaries.map((item) => `- ${item}`),
            ...missing.map((item) => `- 누락: ${item}`),
        ];
        return {
            ok: false,
            summary: "생성된 파일 또는 폴더를 자동 검증하지 못했습니다.",
            message: lines.join("\n"),
            reason: "실제 생성 증거가 충분하지 않습니다.",
            remainingItems,
        };
    }
    const lines = [
        "검증 결과:",
        ...confirmed.map((item) => `- ${item}`),
        ...readableSummaries.map((item) => `- ${item}`),
    ];
    const firstConfirmed = confirmed[0];
    return {
        ok: true,
        summary: firstConfirmed
            ? `실제 파일/폴더 생성 검증 완료: ${firstConfirmed.replace(/^.+?:\s*/, "")}`
            : "실제 파일/폴더 생성 검증을 완료했습니다.",
        message: lines.join("\n"),
    };
}
function inferFilesystemVerificationTargets(originalRequest, mutationPaths, workDir) {
    const targets = new Map();
    const requestForInference = extractVerificationSourceRequest(originalRequest);
    const normalizedMutationPaths = mutationPaths
        .map((item) => normalizeFilesystemPath(item, workDir))
        .filter((item) => Boolean(item));
    const expectsDeletion = /(삭제|지워|remove|delete)/iu.test(requestForInference);
    for (const mutationPath of normalizedMutationPaths) {
        const normalized = mutationPath.replace(/\/$/, "");
        if (!normalized)
            continue;
        const kind = extname(normalized) ? "file" : "dir";
        targets.set(normalized, { path: normalized, kind, expect: expectsDeletion ? "missing" : "exists" });
        if (kind === "file") {
            const parent = resolve(normalized, "..");
            if (!targets.has(parent) && !expectsDeletion) {
                targets.set(parent, { path: parent, kind: "dir", expect: "exists" });
            }
        }
    }
    // 실제 도구 실행에서 확인된 경로가 있으면 그 경로를 최우선으로 신뢰한다.
    // 후속 프롬프트나 intake 요약문에서 다시 경로를 추론하면 문장 조각이 섞여 오탐이 발생할 수 있다.
    if (normalizedMutationPaths.length > 0) {
        return [...targets.values()];
    }
    const baseDir = inferFilesystemBaseDir(requestForInference);
    const quotedNames = extractQuotedFilesystemNames(requestForInference);
    const mentionsFolder = /(폴더|디렉터리|folder|directory)/iu.test(requestForInference);
    const mentionsWebProgram = /(웹\s*(달력|계산기|페이지|프로그램)|html|css|js|javascript|web\s*(app|page)|calendar|calculator)/iu.test(requestForInference);
    if (baseDir && quotedNames.length > 0) {
        for (const name of quotedNames) {
            if (!name.includes("/")) {
                const dirPath = resolve(join(baseDir, name));
                if (mentionsFolder || mentionsWebProgram) {
                    targets.set(dirPath, { path: dirPath, kind: "dir", expect: expectsDeletion ? "missing" : "exists" });
                    if (mentionsWebProgram && !expectsDeletion) {
                        const indexPath = join(dirPath, "index.html");
                        targets.set(indexPath, { path: indexPath, kind: "file", expect: "exists" });
                    }
                }
            }
            if (/\.[a-z0-9]+$/iu.test(name)) {
                const filePath = resolve(join(baseDir, name));
                targets.set(filePath, { path: filePath, kind: "file", expect: expectsDeletion ? "missing" : "exists" });
            }
        }
    }
    return [...targets.values()];
}
function extractVerificationSourceRequest(value) {
    const normalized = value.split("\r").join("");
    const markers = ["\uc6d0\ub798 \uc0ac\uc6a9\uc790 \uc694\uccad:", "Original user request:"];
    for (const marker of markers) {
        const line = normalized.split("\n").find((item) => item.startsWith(marker));
        if (line)
            return line.slice(marker.length).trim();
    }
    return normalized;
}
function extractQuotedFilesystemNames(value) {
    const names = new Set();
    for (const quote of ['"', "'"]) {
        let cursor = 0;
        while (cursor < value.length) {
            const startIndex = value.indexOf(quote, cursor);
            if (startIndex < 0)
                break;
            const endIndex = value.indexOf(quote, startIndex + 1);
            if (endIndex < 0)
                break;
            const token = value.slice(startIndex + 1, endIndex).trim();
            if (token && isSafeFilesystemLiteral(token))
                names.add(token);
            cursor = endIndex + 1;
        }
    }
    return [...names];
}
function isSafeFilesystemLiteral(value) {
    if (!value)
        return false;
    for (const blockedCharacter of ["\r", "\n", "\t", "<", ">"]) {
        if (value.includes(blockedCharacter))
            return false;
    }
    const lowered = value.toLowerCase();
    const blockedPrefixes = [
        "context",
        "goal",
        "success criteria",
        "\uc6d0\ub798 \uc0ac\uc6a9\uc790 \uc694\uccad",
        "\ubb38\ub9e5",
        "\ubaa9\ud45c",
        "\uc81c\uc57d \uc0ac\ud56d",
    ];
    if (blockedPrefixes.some((prefix) => lowered.startsWith(prefix.toLowerCase()))) {
        return false;
    }
    const wordCount = value.trim().split(" ").filter(Boolean).length;
    if (wordCount > 6 && !value.includes("/") && !value.includes("\\")) {
        return false;
    }
    return true;
}
function inferFilesystemBaseDir(originalRequest) {
    const lowered = originalRequest.toLowerCase();
    if (lowered.includes("downloads") || originalRequest.includes("\ub2e4\uc6b4\ub85c\ub4dc")) {
        return join(homedir(), "Downloads");
    }
    if (lowered.includes("desktop") || originalRequest.includes("\ubc14\ud0d5\ud654\uba74")) {
        return join(homedir(), "Desktop");
    }
    if (lowered.includes("documents") || originalRequest.includes("\ubb38\uc11c")) {
        return join(homedir(), "Documents");
    }
    return undefined;
}
function normalizeFilesystemPath(value, workDir) {
    if (!value)
        return undefined;
    let trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        trimmed = trimmed.slice(1, -1);
    }
    if (!trimmed)
        return undefined;
    const home = homedir();
    if (trimmed.startsWith("~/"))
        return resolve(join(home, trimmed.slice(2)));
    if (trimmed.startsWith("$HOME/"))
        return resolve(join(home, trimmed.slice(6)));
    if (trimmed.startsWith("/"))
        return resolve(trimmed);
    for (const homeRelativePrefix of ["Downloads/", "Desktop/", "Documents/"]) {
        if (trimmed.startsWith(homeRelativePrefix)) {
            return resolve(join(home, trimmed));
        }
    }
    if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
        return resolve(workDir, trimmed);
    }
    return undefined;
}
function collectFilesystemMutationPaths(toolName, params, workDir) {
    if (!params || typeof params !== "object")
        return [];
    const record = params;
    if (toolName === "file_write" || toolName === "file_delete") {
        const path = normalizeFilesystemPath(getString(record.path), workDir);
        return path ? [path] : [];
    }
    if (toolName === "file_patch") {
        const patch = getString(record.patch);
        if (!patch)
            return [];
        const paths = [];
        for (const line of patch.split("\n")) {
            for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Delete File: "]) {
                if (!line.startsWith(prefix))
                    continue;
                const rawPath = line.slice(prefix.length).trim();
                if (!rawPath)
                    continue;
                paths.push(normalizeFilesystemPath(rawPath, workDir) ?? resolve(workDir, rawPath));
            }
        }
        return [...new Set(paths)];
    }
    if (toolName !== "shell_exec")
        return [];
    const command = getString(record.command);
    if (!command)
        return [];
    const tokens = command
        .split("\n")
        .join(" ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
    const paths = new Set();
    for (const token of tokens) {
        const cleaned = token.replace(/^["'()]+|["'();,&|]+$/g, "");
        const normalized = normalizeFilesystemPath(cleaned, workDir);
        if (normalized)
            paths.add(normalized);
    }
    return [...paths];
}
function displayHomePath(value) {
    const home = homedir();
    return value.startsWith(home) ? value.replace(home, "~") : value;
}
function safeStat(value) {
    try {
        return statSync(value);
    }
    catch {
        return undefined;
    }
}
function safeReadSnippet(value) {
    try {
        const raw = readFileSync(value, "utf-8").replace(/\s+/g, " ").trim();
        if (!raw)
            return undefined;
        return raw.length > 120 ? `${raw.slice(0, 119)}...` : raw;
    }
    catch {
        return undefined;
    }
}
function requestRequiresFilesystemMutation(message) {
    const normalized = message.trim();
    if (!normalized)
        return false;
    const lowered = normalized.toLowerCase();
    const filesystemKeywords = [
        "repo",
        "repository",
        "directory",
        "folder",
        "file",
        "path",
        "downloads",
        "desktop",
        "documents",
        "readme",
        "html",
        "css",
        "js",
        "json",
        "md",
        "txt",
        "csv",
        "xml",
        "yaml",
        "yml",
        "\ud30c\uc77c",
        "\ud3f4\ub354",
        "\ub514\ub809\ud130\ub9ac",
        "\uacbd\ub85c",
        "\ub2e4\uc6b4\ub85c\ub4dc",
        "\ubc14\ud0d5\ud654\uba74",
        "\ubb38\uc11c",
        "\ud504\ub85c\uc81d\ud2b8",
        "\uc800\uc7a5\uc18c",
    ];
    const mutationKeywords = [
        "rename",
        "create",
        "write",
        "save",
        "edit",
        "update",
        "delete",
        "copy",
        "move",
        "mkdir",
        "touch",
        "\uc0dd\uc131",
        "\ub9cc\ub4e4",
        "\uc791\uc131",
        "\uc800\uc7a5",
        "\uc218\uc815",
        "\ud3b8\uc9d1",
        "\uc0ad\uc81c",
        "\ubcf5\uc0ac",
        "\uc774\ub3d9",
        "\ubc14\uafd4",
        "\ucd94\uac00",
    ];
    const mentionsFilesystemTarget = filesystemKeywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
    const mentionsMutation = mutationKeywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
    return mentionsFilesystemTarget && mentionsMutation;
}
function isRealFilesystemMutation(toolName, params) {
    if (toolName === "file_write" || toolName === "file_patch" || toolName === "file_delete") {
        return true;
    }
    if (toolName !== "shell_exec" || !params || typeof params !== "object") {
        return false;
    }
    const command = getString(params.command);
    if (!command)
        return false;
    const normalizedCommand = command
        .split("&&").join("\n")
        .split("||").join("\n")
        .split(";").join("\n");
    const segments = normalizedCommand
        .split("\n")
        .map((segment) => segment.trim())
        .filter(Boolean);
    return segments.some((segment) => {
        if (["mkdir ", "touch ", "cp ", "mv ", "install ", "rm ", "unzip ", "tar "].some((prefix) => segment.includes(prefix)))
            return true;
        if (segment.includes("ln -s"))
            return true;
        if (segment.includes("git clone"))
            return true;
        if (segment.includes("npm install") || segment.includes("pnpm install"))
            return true;
        if (segment.includes("tee") && segment.includes(">"))
            return true;
        if ((segment.includes("cat") || segment.includes("printf") || segment.includes("echo")) && segment.includes(">"))
            return true;
        return false;
    });
}
function buildFilesystemMutationFollowupPrompt(params) {
    return [
        "[Filesystem Execution Required]",
        "원래 사용자 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다.",
        `원래 사용자 요청: ${params.originalRequest}`,
        params.previousResult.trim() ? `이전 불완전 결과: ${params.previousResult.trim()}` : "",
        "요청한 파일이나 폴더가 로컬 환경에서 실제로 생성되거나 수정되어야만 완료입니다.",
        "이제 사용 가능한 파일 또는 쉘 도구로 실제 로컬 작업을 수행하세요.",
        "수동 안내, 예시 코드만 제시하거나 실제 파일 변경 없이 완료했다고 말하지 마세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
    ].filter(Boolean).join("\n\n");
}
function shouldRetryTruncatedOutput(params) {
    if (params.review.status !== "ask_user")
        return false;
    if (!params.requiresFilesystemMutation && !requestRequiresFilesystemMutation(params.originalRequest))
        return false;
    const combined = [
        params.review.summary,
        params.review.reason,
        params.review.userMessage,
        ...(params.review.remainingItems ?? []),
        params.preview,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n");
    return /(중간[^\n]{0,20}(절단|중단)|절단 오류|코드[^\n]{0,20}(절단|중단)|미완성|incomplete|truncat|cut off|unfinished)/iu.test(combined);
}
function buildTruncatedOutputRecoveryPrompt(params) {
    const remaining = params.remainingItems?.filter((item) => item.trim()).map((item) => `- ${item}`) ?? [];
    return [
        "[Truncated Output Recovery]",
        "이전 시도에서 코드 또는 결과가 중간에 끊기거나 미완성으로 끝났습니다.",
        `원래 사용자 요청: ${params.originalRequest}`,
        params.summary?.trim() ? `검토 요약: ${params.summary.trim()}` : "",
        params.reason?.trim() ? `검토 사유: ${params.reason.trim()}` : "",
        remaining.length > 0 ? ["남은 항목:", ...remaining].join("\n") : "",
        params.previousResult.trim() ? `이전 불완전 결과:
${params.previousResult.trim()}` : "",
        "지금 작업을 다시 시도하고 완전하게 끝내세요.",
        "파일을 써야 한다면 로컬 파일 또는 쉘 도구를 이용해 최종 파일을 실제로 생성하세요.",
        "부분 코드만 반복하지 말고, 파일 중간에서 끊기지 말고, 닫히지 않은 태그·함수·블록·문장으로 끝내지 마세요.",
        "사용자가 지정한 이름, 폴더명, 경로, 언어를 그대로 유지하고 번역하지 마세요.",
        "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
    ].filter(Boolean).join("\n\n");
}
function getString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function toStringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
async function deliverChunk(onChunk, chunk, runId) {
    if (!onChunk)
        return;
    try {
        await onChunk(chunk);
    }
    catch (error) {
        log.warn(`runId=${runId} chunk delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function logAssistantReply(source, text) {
    if (source !== "webui" && source !== "telegram")
        return;
    const normalized = text.trim();
    if (!normalized)
        return;
    process.stdout.write(`${normalized}\n`);
}
function buildWorkerRuntimePrompt(message, workDir) {
    const instructions = loadMergedInstructions(workDir);
    const nobieMd = loadNobieMd(workDir);
    return [
        instructions.mergedText ? `[Instruction Chain]\n${instructions.mergedText}` : "",
        nobieMd ? `[프로젝트 메모리]\n${nobieMd}` : "",
        message,
    ]
        .filter(Boolean)
        .join("\n\n");
}
function scheduleDelayedRootRun(params) {
    const jobId = crypto.randomUUID();
    log.info("delayed run armed", {
        jobId,
        sessionId: params.sessionId,
        source: params.source,
        runAtMs: params.runAtMs,
        preferredTarget: params.preferredTarget ?? null,
        taskProfile: params.taskProfile ?? null,
        toolsEnabled: params.toolsEnabled ?? true,
        contextMode: params.contextMode ?? "full",
    });
    const fire = () => {
        delayedRunTimers.delete(jobId);
        void enqueueDelayedSessionRun(params.sessionId, jobId, async () => {
            const route = resolveRunRoute({
                preferredTarget: params.preferredTarget,
                taskProfile: params.taskProfile,
                fallbackModel: params.model,
            });
            log.info("delayed run firing", {
                jobId,
                sessionId: params.sessionId,
                targetId: route.targetId ?? null,
                targetLabel: route.targetLabel ?? null,
                model: route.model ?? params.model ?? null,
                providerId: route.providerId ?? null,
                workerRuntime: route.workerRuntime?.kind ?? null,
                toolsEnabled: params.toolsEnabled ?? true,
                contextMode: params.contextMode ?? "full",
            });
            const started = startRootRun({
                message: params.message,
                sessionId: params.sessionId,
                ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
                requestGroupId: params.requestGroupId,
                model: route.model ?? params.model,
                ...(route.providerId ? { providerId: route.providerId } : {}),
                ...(route.provider ? { provider: route.provider } : {}),
                ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
                ...(route.targetId ? { targetId: route.targetId } : {}),
                ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
                ...(params.workDir ? { workDir: params.workDir } : {}),
                source: params.source,
                skipIntake: true,
                ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
                ...(params.contextMode ? { contextMode: params.contextMode } : {}),
                onChunk: params.onChunk,
            });
            await started.finished;
        });
    };
    const arm = () => {
        const remaining = params.runAtMs - Date.now();
        if (remaining <= 0) {
            fire();
            return;
        }
        const handle = setTimeout(arm, Math.min(remaining, MAX_DELAY_TIMER_MS));
        delayedRunTimers.set(jobId, handle);
    };
    arm();
}
function enqueueRequestGroupRun(requestGroupId, runId, task) {
    const previous = requestGroupExecutionQueues.get(requestGroupId);
    if (previous) {
        log.info("request group run queued behind active group task", { runId, requestGroupId });
    }
    const next = (previous ?? Promise.resolve(undefined))
        .catch((error) => {
        log.warn(`previous request group queue recovered: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    })
        .then(() => task())
        .catch((error) => {
        log.error("request group queue task failed", {
            runId,
            requestGroupId,
            error: error instanceof Error ? error.message : String(error),
        });
        return getRootRun(runId);
    })
        .finally(() => {
        if (requestGroupExecutionQueues.get(requestGroupId) === next) {
            requestGroupExecutionQueues.delete(requestGroupId);
        }
    });
    requestGroupExecutionQueues.set(requestGroupId, next);
    return next;
}
function enqueueDelayedSessionRun(sessionId, jobId, task) {
    const previous = delayedSessionQueues.get(sessionId);
    if (previous) {
        log.info("delayed run queued behind active session task", { jobId, sessionId });
    }
    const next = (previous ?? Promise.resolve())
        .catch((error) => {
        log.warn(`previous delayed run queue recovered: ${error instanceof Error ? error.message : String(error)}`);
    })
        .then(task)
        .catch((error) => {
        log.error("delayed run queue task failed", {
            jobId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
    })
        .finally(() => {
        if (delayedSessionQueues.get(sessionId) === next) {
            delayedSessionQueues.delete(sessionId);
        }
    });
    delayedSessionQueues.set(sessionId, next);
}
//# sourceMappingURL=start.js.map
