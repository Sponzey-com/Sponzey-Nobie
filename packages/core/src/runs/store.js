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
    let score = Math.max(0, 20 - recencyIndex);
    for (const quoted of quotedTerms) {
        if (haystack.includes(quoted))
            score += 80;
    }
    const overlap = tokens.filter((token) => haystack.includes(token));
    score += overlap.length * 12;
    if (quotedTerms.length === 0 && tokens.length === 0) {
        score += Math.max(0, 12 - recencyIndex);
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
function hydrateRun(row) {
    const db = getDb();
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
    };
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
    const scored = [...grouped.values()]
        .map((run, index) => ({ run, score: scoreReconnectCandidate(message, run, index) }))
        .filter((item) => item.score >= 12)
        .sort((a, b) => (b.score - a.score) || (b.run.updatedAt - a.run.updatedAt));
    const best = scored[0]?.run;
    const secondScore = scored[1]?.score ?? -1;
    const bestScore = scored[0]?.score ?? -1;
    const ambiguous = Boolean(best && secondScore >= 12 && bestScore - secondScore < 15);
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
       (id, session_id, title, prompt, source, status, task_profile, target_id, target_label,
        worker_runtime_kind, worker_session_id, context_mode,
        request_group_id, delegation_turn_count, max_delegation_turns, current_step_key, current_step_index,
        total_steps, summary, can_cancel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(params.id, params.sessionId, title, params.prompt, params.source, "queued", taskProfile, params.targetId ?? null, params.targetLabel ?? null, params.workerRuntimeKind ?? null, params.workerSessionId ?? null, params.contextMode ?? "full", params.requestGroupId ?? params.id, 0, params.maxDelegationTurns ?? 5, "received", 1, totalSteps, summary, 1, now, now);
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
    getDb()
        .prepare(`UPDATE root_runs
       SET delegation_turn_count = delegation_turn_count + 1,
           summary = ?,
           updated_at = ?
       WHERE id = ?`)
        .run(summary ?? current.summary, now, runId);
    const run = getRootRun(runId);
    if (run) {
        eventBus.emit("run.progress", { run });
    }
    return run;
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
export function cancelRootRun(runId) {
    const current = getRootRun(runId);
    if (!current)
        return undefined;
    const activeRuns = listRequestGroupRuns(current.requestGroupId).filter((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status) || activeRunControllers.has(run.id));
    if (activeRuns.length === 0)
        return undefined;
    for (const run of activeRuns) {
        appendRunEvent(run.id, "취소 요청");
        eventBus.emit("run.cancel.requested", { runId: run.id });
        const controller = activeRunControllers.get(run.id);
        if (controller) {
            controller.abort();
            clearActiveRunController(run.id);
        }
        const stepKey = resolveInterruptStepKey(run);
        setRunStepStatus(run.id, stepKey, "cancelled", "사용자가 실행 취소를 요청했습니다.");
        updateRunStatus(run.id, "cancelled", "사용자가 실행을 취소했습니다.", false);
    }
    return getRootRun(runId) ?? current;
}
//# sourceMappingURL=store.js.map