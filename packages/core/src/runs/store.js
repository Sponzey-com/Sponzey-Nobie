import { getDb } from "../db/index.js";
import { eventBus } from "../events/index.js";
import { DEFAULT_RUN_STEPS } from "./types.js";
const activeRunControllers = new Map();
const ACTIVE_WORKER_SESSION_STATUSES = ["queued", "running", "awaiting_approval", "awaiting_user"];
const ACTIVE_REQUEST_GROUP_STATUSES = ["queued", "running", "awaiting_approval", "awaiting_user"];
function truncateTitle(prompt) {
    const normalized = prompt.trim().replace(/\s+/g, " ");
    return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}
const RECONNECT_STOP_WORDS = new Set([
    "그", "그거", "그것", "이거", "이것", "저거", "저것", "기존", "이전", "아까", "방금", "전에", "파일", "폴더", "프로그램", "화면", "페이지", "코드", "수정", "고쳐", "바꿔", "추가", "보완", "업데이트",
    "the", "that", "it", "those", "this", "file", "folder", "program", "page", "screen", "code", "modify", "edit", "fix", "change", "update", "continue", "resume",
]);
const CONTINUATION_MESSAGE_PATTERNS = [
    /(?:그리고|또|그럼|그러면|이어서|계속|다시|방금|이제|근데|그런데|여기|이건|그건|저건|이쪽|그쪽|저쪽|아직|왜\s*안|안\s*돼|안돼|실패|오류|에러|결과)/u,
    /(?:보여줘|보내줘|고쳐줘|수정해줘|바꿔줘|이어가|계속해|다시\s*해|이어서\s*해|이어서\s*진행)/u,
    /\b(?:and|also|then|next|continue|resume|again|now|here|this|that|it|but|why|result|failed|error)\b/i,
    /\b(?:show|send|fix|change|update|continue|resume|again|failed|error|result)\b/i,
];
function isActiveRequestGroupStatus(status) {
    return ACTIVE_REQUEST_GROUP_STATUSES.includes(status);
}
function looksLikeContinuationMessage(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return false;
    if (CONTINUATION_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        return true;
    }
    return false;
}
function extractQuotedReconnectTerms(value) {
    const result = [];
    const regex = /["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/g;
    for (const match of value.matchAll(regex)) {
        const token = match[1]?.trim();
        if (token)
            result.push(token.toLowerCase());
    }
    return result;
}
function tokenizeReconnectTerms(value) {
    const tokens = value
        .toLowerCase()
        .match(/[a-z0-9가-힣][a-z0-9가-힣._:-]*/g) ?? [];
    return [...new Set(tokens.filter((token) => token.length > 1 && !RECONNECT_STOP_WORDS.has(token)))];
}
function scoreReconnectCandidate(message, run, recencyIndex) {
    const haystack = [run.title, run.prompt, run.summary].join("\n").toLowerCase();
    const quotedTerms = extractQuotedReconnectTerms(message);
    const tokens = tokenizeReconnectTerms(message);
    const overlap = tokens.filter((token) => haystack.includes(token));
    const continuation = looksLikeContinuationMessage(message);
    let score = 0;
    for (const quoted of quotedTerms) {
        if (haystack.includes(quoted))
            score += 80;
    }
    score += overlap.length * 12;
    if (overlap.length > 0 || quotedTerms.length > 0) {
        score += Math.max(0, 10 - recencyIndex);
    }
    if (continuation) {
        score += isActiveRequestGroupStatus(run.status) ? 24 : 10;
        score += Math.max(0, 6 - recencyIndex);
        if (overlap.length === 0 && quotedTerms.length === 0 && recencyIndex === 0) {
            score += 8;
        }
    }
    if (isActiveRequestGroupStatus(run.status)) {
        score += overlap.length > 0 || continuation ? 8 : 0;
    }
    return score;
}
function mapStep(row) {
    return {
        key: row.step_key,
        title: row.title,
        index: row.step_index,
        status: row.status,
        summary: row.summary,
        ...(row.started_at ? { startedAt: row.started_at } : {}),
        ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    };
}
function mapEvent(row) {
    return {
        id: row.id,
        at: row.at,
        label: row.label,
    };
}
function parsePromptSourceSnapshot(value) {
    if (!value)
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function hydrateRun(row) {
    const db = getDb();
    const promptSourceSnapshot = parsePromptSourceSnapshot(row.prompt_source_snapshot);
    const steps = db
        .prepare(`SELECT run_id, step_key, title, step_index, status, summary, started_at, finished_at
       FROM run_steps WHERE run_id = ? ORDER BY step_index ASC`)
        .all(row.id)
        .map(mapStep);
    const recentEvents = db
        .prepare(`SELECT id, run_id, at, label
       FROM run_events WHERE run_id = ? ORDER BY at DESC LIMIT 12`)
        .all(row.id)
        .map(mapEvent)
        .sort((a, b) => a.at - b.at);
    return {
        id: row.id,
        sessionId: row.session_id,
        requestGroupId: row.request_group_id || row.id,
        lineageRootRunId: row.lineage_root_run_id || row.request_group_id || row.id,
        runScope: row.run_scope ?? "root",
        ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
        ...(row.handoff_summary ? { handoffSummary: row.handoff_summary } : {}),
        title: row.title,
        prompt: row.prompt,
        source: row.source,
        status: row.status,
        taskProfile: row.task_profile,
        ...(row.target_id ? { targetId: row.target_id } : {}),
        ...(row.target_label ? { targetLabel: row.target_label } : {}),
        ...(row.worker_runtime_kind ? { workerRuntimeKind: row.worker_runtime_kind } : {}),
        ...(row.worker_session_id ? { workerSessionId: row.worker_session_id } : {}),
        contextMode: row.context_mode ?? "full",
        delegationTurnCount: row.delegation_turn_count,
        maxDelegationTurns: row.max_delegation_turns,
        currentStepKey: row.current_step_key,
        currentStepIndex: row.current_step_index,
        totalSteps: row.total_steps,
        summary: row.summary,
        canCancel: Boolean(row.can_cancel),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        steps,
        recentEvents,
        ...(promptSourceSnapshot ? { promptSourceSnapshot } : {}),
    };
}
function buildSqlPlaceholders(count) {
    return Array.from({ length: count }, () => "?").join(", ");
}
function resolveLineageKey(row) {
    return row.lineage_root_run_id || row.request_group_id || row.id;
}
function selectRunRowsForLineage(lineageKey) {
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE COALESCE(lineage_root_run_id, request_group_id, id) = ?
       ORDER BY created_at ASC, updated_at ASC`)
        .all(lineageKey);
}
function deleteRunRows(params) {
    const { runIds, requestGroupIds } = params;
    if (runIds.length === 0)
        return 0;
    for (const runId of runIds) {
        const controller = activeRunControllers.get(runId);
        if (controller)
            controller.abort();
        clearActiveRunController(runId);
    }
    const db = getDb();
    const tx = db.transaction(() => {
        const runPlaceholders = buildSqlPlaceholders(runIds.length);
        db.prepare(`DELETE FROM messages WHERE root_run_id IN (${runPlaceholders})`).run(...runIds);
        db.prepare(`DELETE FROM channel_message_refs WHERE root_run_id IN (${runPlaceholders})`).run(...runIds);
        if (requestGroupIds.length > 0) {
            const requestGroupPlaceholders = buildSqlPlaceholders(requestGroupIds.length);
            db.prepare(`DELETE FROM channel_message_refs WHERE request_group_id IN (${requestGroupPlaceholders})`).run(...requestGroupIds);
        }
        db.prepare(`DELETE FROM root_runs WHERE id IN (${runPlaceholders})`).run(...runIds);
    });
    tx();
    return runIds.length;
}
export function listRootRuns(limit = 50) {
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       ORDER BY updated_at DESC
       LIMIT ?`)
        .all(limit)
        .map(hydrateRun);
}
export function listActiveRootRuns(limit = 100) {
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
       ORDER BY updated_at DESC
       LIMIT ?`)
        .all(limit)
        .map(hydrateRun);
}
export function listActiveSessionRequestGroups(sessionId, excludingRunId) {
    const rows = excludingRunId
        ? getDb()
            .prepare(`SELECT *
           FROM root_runs
           WHERE session_id = ?
             AND id <> ?
             AND status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
           ORDER BY updated_at DESC`)
            .all(sessionId, excludingRunId)
        : getDb()
            .prepare(`SELECT *
           FROM root_runs
           WHERE session_id = ?
             AND status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
           ORDER BY updated_at DESC`)
            .all(sessionId);
    const grouped = new Map();
    for (const run of rows.map(hydrateRun)) {
        if (!grouped.has(run.requestGroupId))
            grouped.set(run.requestGroupId, run);
    }
    return [...grouped.values()];
}
export function listRunsForActiveRequestGroups(limitGroups = 100, limitRuns = 300) {
    const activeGroups = [...new Set(listActiveRootRuns(limitGroups).map((run) => run.requestGroupId))];
    if (activeGroups.length === 0)
        return [];
    const placeholders = activeGroups.map(() => "?").join(", ");
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE request_group_id IN (${placeholders})
       ORDER BY updated_at DESC
       LIMIT ?`)
        .all(...activeGroups, limitRuns)
        .map(hydrateRun);
}
export function listRunsForRecentRequestGroups(limitGroups = 120, limitRuns = 1000) {
    const groups = getDb()
        .prepare(`SELECT COALESCE(lineage_root_run_id, request_group_id, id) AS lineage_key, MAX(updated_at) AS latest_updated
       FROM root_runs
       GROUP BY COALESCE(lineage_root_run_id, request_group_id, id)
       ORDER BY latest_updated DESC
       LIMIT ?`)
        .all(limitGroups)
        .map((row) => row.lineage_key)
        .filter((value) => typeof value === "string" && value.length > 0);
    if (groups.length === 0)
        return [];
    const placeholders = groups.map(() => "?").join(", ");
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE COALESCE(lineage_root_run_id, request_group_id, id) IN (${placeholders})
       ORDER BY updated_at DESC
       LIMIT ?`)
        .all(...groups, limitRuns)
        .map(hydrateRun);
}
export function recoverActiveRunsOnStartup() {
    const activeRuns = listActiveRootRuns(200);
    const recovered = [];
    for (const run of activeRuns) {
        if (run.status === 'awaiting_user') {
            if (!run.canCancel) {
                const updated = updateRunStatus(run.id, 'awaiting_user', run.summary || '추가 입력을 기다리고 있습니다.', true);
                if (updated)
                    recovered.push(updated);
            }
            continue;
        }
        const summary = run.status === 'awaiting_approval'
            ? '프로세스가 다시 시작되어 권한 확인이 초기화되었습니다. 다시 확인하거나 요청을 다시 실행해 주세요.'
            : '프로세스가 다시 시작되어 자동 실행이 중단되었습니다. 이어서 진행하려면 요청을 다시 실행하거나 취소해 주세요.';
        appendRunEvent(run.id, '프로세스 재시작 후 상태 복구');
        setRunStepStatus(run.id, 'awaiting_user', 'running', summary);
        const updated = updateRunStatus(run.id, 'awaiting_user', summary, true);
        if (updated)
            recovered.push(updated);
    }
    return recovered;
}
export function getRootRun(runId) {
    const row = getDb()
        .prepare("SELECT * FROM root_runs WHERE id = ?")
        .get(runId);
    return row ? hydrateRun(row) : undefined;
}
export function listRequestGroupRuns(requestGroupId) {
    return getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE request_group_id = ?
       ORDER BY created_at ASC, updated_at ASC`)
        .all(requestGroupId)
        .map(hydrateRun);
}
export function hasActiveRequestGroupRuns(requestGroupId) {
    return listRequestGroupRuns(requestGroupId).some((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status));
}
export function isReusableRequestGroup(requestGroupId) {
    const runs = listRequestGroupRuns(requestGroupId);
    if (runs.length === 0)
        return false;
    return runs.some((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status));
}
export function getRequestGroupDelegationTurnCount(requestGroupId) {
    const row = getDb()
        .prepare(`SELECT MAX(delegation_turn_count) as max_count
       FROM root_runs
       WHERE request_group_id = ?`)
        .get(requestGroupId);
    return row?.max_count ?? 0;
}
export function findReconnectRequestGroupSelection(sessionId, message) {
    const runs = getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 80`)
        .all(sessionId)
        .map(hydrateRun);
    const grouped = new Map();
    for (const run of runs) {
        if (!grouped.has(run.requestGroupId)) {
            grouped.set(run.requestGroupId, run);
        }
    }
    const reusableRuns = [...grouped.values()].filter((run) => isActiveRequestGroupStatus(run.status));
    const activeGroupCount = reusableRuns.filter((run) => isActiveRequestGroupStatus(run.status)).length;
    const continuation = looksLikeContinuationMessage(message);
    const scored = reusableRuns
        .map((run, index) => ({ run, score: scoreReconnectCandidate(message, run, index) }))
        .filter((item) => item.score >= 18 || (continuation && activeGroupCount === 1 && item.score >= 14))
        .sort((a, b) => (b.score - a.score) || (b.run.updatedAt - a.run.updatedAt));
    const best = scored[0]?.run;
    const secondScore = scored[1]?.score ?? -1;
    const bestScore = scored[0]?.score ?? -1;
    const ambiguous = Boolean(best && secondScore >= 18 && bestScore - secondScore < 12);
    return {
        ...(best ? { best } : {}),
        candidates: scored.slice(0, 3).map((item) => item.run),
        ambiguous,
    };
}
export function findReconnectRequestGroup(sessionId, message) {
    return findReconnectRequestGroupSelection(sessionId, message).best;
}
function resolveInterruptStepKey(run) {
    if (DEFAULT_RUN_STEPS.some((step) => step.key === run.currentStepKey)) {
        return run.currentStepKey;
    }
    switch (run.status) {
        case "awaiting_approval":
            return "awaiting_approval";
        case "awaiting_user":
            return "awaiting_user";
        case "queued":
            return "received";
        default:
            return "executing";
    }
}
export function findLatestWorkerSessionRun(requestGroupId, workerSessionId, excludingRunId) {
    const runs = getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE request_group_id = ?
         AND worker_session_id = ?
       ORDER BY updated_at DESC
       LIMIT 40`)
        .all(requestGroupId, workerSessionId)
        .map(hydrateRun);
    return runs.find((run) => (excludingRunId ? run.id !== excludingRunId : true));
}
export function interruptOrphanWorkerSessionRuns(params) {
    const summary = params.summary ?? "새 작업 세션이 시작되어 이전 실행을 정리했습니다.";
    const runs = getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE request_group_id = ?
         AND worker_session_id = ?
         AND id != ?
       ORDER BY updated_at DESC`)
        .all(params.requestGroupId, params.workerSessionId, params.keepRunId)
        .map(hydrateRun)
        .filter((run) => ACTIVE_WORKER_SESSION_STATUSES.includes(run.status));
    const interrupted = [];
    for (const run of runs) {
        const controller = activeRunControllers.get(run.id);
        if (controller) {
            controller.abort();
            clearActiveRunController(run.id);
        }
        appendRunEvent(run.id, "새 작업 세션이 연결되어 이전 실행을 중단합니다.");
        setRunStepStatus(run.id, resolveInterruptStepKey(run), "cancelled", summary);
        const updated = updateRunStatus(run.id, "interrupted", summary, false);
        interrupted.push(updated ?? run);
    }
    return interrupted;
}
export function createRootRun(params) {
    const now = Date.now();
    const totalSteps = DEFAULT_RUN_STEPS.length;
    const taskProfile = params.taskProfile ?? "general_chat";
    const summary = params.prompt.trim();
    const title = truncateTitle(params.prompt);
    const db = getDb();
    const tx = db.transaction(() => {
        db.prepare(`INSERT INTO root_runs
       (id, session_id, request_group_id, lineage_root_run_id, parent_run_id, run_scope, handoff_summary,
        title, prompt, source, status, task_profile, target_id, target_label,
        worker_runtime_kind, worker_session_id, context_mode,
        delegation_turn_count, max_delegation_turns, current_step_key, current_step_index,
        total_steps, summary, can_cancel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(params.id, params.sessionId, params.requestGroupId ?? params.id, params.lineageRootRunId ?? params.requestGroupId ?? params.id, params.parentRunId ?? null, params.runScope ?? "root", params.handoffSummary ?? null, title, params.prompt, params.source, "queued", taskProfile, params.targetId ?? null, params.targetLabel ?? null, params.workerRuntimeKind ?? null, params.workerSessionId ?? null, params.contextMode ?? "full", params.delegationTurnCount ?? 0, params.maxDelegationTurns ?? 5, "received", 1, totalSteps, summary, 1, now, now);
        const insertStep = db.prepare(`INSERT INTO run_steps
       (id, run_id, step_key, title, step_index, status, summary, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        DEFAULT_RUN_STEPS.forEach((step, index) => {
            insertStep.run(crypto.randomUUID(), params.id, step.key, step.title, index + 1, index === 0 ? "running" : "pending", index === 0 ? "요청을 받았습니다." : "", index === 0 ? now : null, null);
        });
        db.prepare(`INSERT INTO run_events (id, run_id, at, label)
       VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), params.id, now, "요청 수신");
    });
    tx();
    const run = getRootRun(params.id);
    eventBus.emit("run.created", { run });
    eventBus.emit("run.progress", { run });
    return run;
}
export function appendRunEvent(runId, label) {
    const at = Date.now();
    getDb()
        .prepare(`INSERT INTO run_events (id, run_id, at, label) VALUES (?, ?, ?, ?)`)
        .run(crypto.randomUUID(), runId, at, label);
}
export function updateRunSummary(runId, summary) {
    const now = Date.now();
    getDb()
        .prepare(`UPDATE root_runs SET summary = ?, updated_at = ? WHERE id = ?`)
        .run(summary, now, runId);
    const run = getRootRun(runId);
    if (run) {
        eventBus.emit("run.summary", { runId, summary: run.summary, run });
        eventBus.emit("run.progress", { run });
    }
    return run;
}
export function updateRunStatus(runId, status, summary, canCancel) {
    const now = Date.now();
    const current = getRootRun(runId);
    if (!current)
        return undefined;
    const nextSummary = summary ?? current.summary;
    const nextCanCancel = canCancel ?? current.canCancel;
    getDb()
        .prepare(`UPDATE root_runs SET status = ?, summary = ?, can_cancel = ?, updated_at = ? WHERE id = ?`)
        .run(status, nextSummary, nextCanCancel ? 1 : 0, now, runId);
    const run = getRootRun(runId);
    if (run) {
        eventBus.emit("run.status", { run });
        eventBus.emit("run.progress", { run });
        if (status === "completed")
            eventBus.emit("run.completed", { run });
        if (status === "failed")
            eventBus.emit("run.failed", { run });
        if (status === "cancelled")
            eventBus.emit("run.cancelled", { run });
    }
    return run;
}
export function incrementDelegationTurnCount(runId, summary) {
    const now = Date.now();
    const current = getRootRun(runId);
    if (!current)
        return undefined;
    const nextCount = current.delegationTurnCount + 1;
    getDb()
        .prepare(`UPDATE root_runs
       SET delegation_turn_count = CASE
             WHEN delegation_turn_count < ? THEN ?
             ELSE delegation_turn_count
           END,
           summary = CASE WHEN id = ? THEN ? ELSE summary END,
           updated_at = CASE WHEN id = ? THEN ? ELSE updated_at END
       WHERE request_group_id = ?`)
        .run(nextCount, nextCount, runId, summary ?? current.summary, runId, now, current.requestGroupId);
    const runs = listRequestGroupRuns(current.requestGroupId);
    for (const run of runs) {
        eventBus.emit("run.progress", { run });
    }
    return runs.find((run) => run.id === runId);
}
export function updateActiveRunsMaxDelegationTurns(maxDelegationTurns) {
    const now = Date.now();
    getDb()
        .prepare(`UPDATE root_runs
       SET max_delegation_turns = ?, updated_at = ?
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')`)
        .run(maxDelegationTurns, now);
    const runs = getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
       ORDER BY updated_at DESC`)
        .all()
        .map(hydrateRun);
    for (const run of runs) {
        eventBus.emit("run.progress", { run });
    }
    return runs;
}
export function setRunStepStatus(runId, stepKey, status, summary) {
    const now = Date.now();
    const step = DEFAULT_RUN_STEPS.find((item) => item.key === stepKey);
    if (!step)
        return undefined;
    const currentRow = getDb()
        .prepare(`SELECT run_id, step_key, title, step_index, status, summary, started_at, finished_at
       FROM run_steps WHERE run_id = ? AND step_key = ?`)
        .get(runId, stepKey);
    if (!currentRow)
        return undefined;
    const startedAt = currentRow.started_at ?? now;
    const finishedAt = status === "running" ? null : now;
    getDb()
        .prepare(`UPDATE run_steps
       SET status = ?, summary = ?, started_at = ?, finished_at = ?
       WHERE run_id = ? AND step_key = ?`)
        .run(status, summary, startedAt, finishedAt, runId, stepKey);
    getDb()
        .prepare(`UPDATE root_runs
       SET current_step_key = ?, current_step_index = ?, summary = ?, updated_at = ?
       WHERE id = ?`)
        .run(stepKey, currentRow.step_index, summary, now, runId);
    const run = getRootRun(runId);
    if (run) {
        const updatedStep = run.steps.find((item) => item.key === stepKey);
        if (updatedStep) {
            if (status === "running")
                eventBus.emit("run.step.started", { runId, step: updatedStep, run });
            else
                eventBus.emit("run.step.completed", { runId, step: updatedStep, run });
        }
        eventBus.emit("run.progress", { run });
    }
    return run;
}
export function bindActiveRunController(runId, controller) {
    activeRunControllers.set(runId, controller);
}
export function clearActiveRunController(runId) {
    activeRunControllers.delete(runId);
}
export function cancelRootRun(runId, options = {}) {
    const current = getRootRun(runId);
    if (!current)
        return undefined;
    const activeRuns = listRequestGroupRuns(current.requestGroupId).filter((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status) || activeRunControllers.has(run.id));
    if (activeRuns.length === 0)
        return undefined;
    for (const run of activeRuns) {
        appendRunEvent(run.id, options.eventLabel ?? "취소 요청");
        eventBus.emit("run.cancel.requested", { runId: run.id });
        const controller = activeRunControllers.get(run.id);
        if (controller) {
            controller.abort();
            clearActiveRunController(run.id);
        }
        const stepKey = resolveInterruptStepKey(run);
        setRunStepStatus(run.id, stepKey, "cancelled", options.stepSummary ?? "사용자가 실행 취소를 요청했습니다.");
        updateRunStatus(run.id, "cancelled", options.runSummary ?? "사용자가 실행을 취소했습니다.", false);
    }
    return getRootRun(runId) ?? current;
}
export function deleteRunHistory(runId) {
    const target = getDb()
        .prepare("SELECT * FROM root_runs WHERE id = ?")
        .get(runId);
    if (!target)
        return undefined;
    const lineageKey = resolveLineageKey(target);
    const rows = selectRunRowsForLineage(lineageKey);
    const runIds = rows.map((row) => row.id);
    const requestGroupIds = [...new Set(rows.map((row) => row.request_group_id).filter((value) => typeof value === "string" && value.length > 0))];
    return {
        deletedRunCount: deleteRunRows({ runIds, requestGroupIds }),
    };
}
export function clearHistoricalRunHistory() {
    const rows = getDb()
        .prepare(`SELECT *
       FROM root_runs
       WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')
       ORDER BY updated_at DESC`)
        .all();
    if (rows.length === 0) {
        return { deletedRunCount: 0 };
    }
    const runIds = rows.map((row) => row.id);
    const requestGroupIds = [...new Set(rows.map((row) => row.request_group_id).filter((value) => typeof value === "string" && value.length > 0))];
    return {
        deletedRunCount: deleteRunRows({ runIds, requestGroupIds }),
    };
}
//# sourceMappingURL=store.js.map