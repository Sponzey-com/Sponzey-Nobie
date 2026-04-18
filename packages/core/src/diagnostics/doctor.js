import { existsSync, mkdirSync, accessSync, constants, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig, PATHS } from "../config/index.js";
import { buildRuntimeManifest } from "../runtime/manifest.js";
import { buildQueueBackpressureSnapshot } from "../runs/queue-backpressure.js";
import { eventBus } from "../events/index.js";
import { listControlEvents } from "../db/index.js";
import { mcpRegistry } from "../mcp/registry.js";
import { buildExtensionRegistrySnapshot } from "../security/extension-governance.js";
import { toolDispatcher } from "../tools/index.js";
import { DEFAULT_EVIDENCE_CONFLICT_POLICY } from "../runs/web-conflict-resolver.js";
import { DEFAULT_RETRIEVAL_CACHE_TTL_POLICY } from "../runs/web-retrieval-cache.js";
import { buildWebSourceAdapterRegistrySnapshot } from "../runs/web-source-adapters/index.js";
import { runPlanDriftCheck } from "./plan-drift.js";
const SECRET_VALUE_PATTERNS = [
    /sk-[A-Za-z0-9_-]{12,}/g,
    /xox[abprs]-[A-Za-z0-9-]{12,}/g,
    /\b\d{6,}:[A-Za-z0-9_-]{12,}\b/g,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /"(?:apiKey|botToken|appToken|password|token|secret|credential)"\s*:\s*"[^"]+"/gi,
];
function makeCheck(name, status, message, detail = {}, guide = null) {
    return { name, status, message, detail: sanitizeValue(detail), guide };
}
function sanitizeText(value) {
    let next = value;
    for (const pattern of SECRET_VALUE_PATTERNS)
        next = next.replace(pattern, "***");
    return next;
}
function sanitizeValue(value) {
    if (typeof value === "string")
        return sanitizeText(value);
    if (Array.isArray(value))
        return value.map(sanitizeValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (/api[_-]?key|token|secret|password|credential|authorization/i.test(key) && typeof item === "string")
                return [key, "***"];
            return [key, sanitizeValue(item)];
        }));
    }
    return value;
}
function hasSecretLeak(value) {
    const serialized = JSON.stringify(value);
    return SECRET_VALUE_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(serialized);
    });
}
function summarize(checks) {
    return {
        ok: checks.filter((check) => check.status === "ok").length,
        warning: checks.filter((check) => check.status === "warning").length,
        blocked: checks.filter((check) => check.status === "blocked").length,
        unknown: checks.filter((check) => check.status === "unknown").length,
    };
}
function overallStatus(checks) {
    if (checks.some((check) => check.status === "blocked"))
        return "blocked";
    if (checks.some((check) => check.status === "warning"))
        return "warning";
    if (checks.some((check) => check.status === "unknown"))
        return "unknown";
    return "ok";
}
function checkRuntimeManifest(manifest) {
    return manifest.id
        ? makeCheck("runtime.manifest", "ok", "Runtime manifest가 생성되었습니다.", { id: manifest.id, displayVersion: manifest.app.displayVersion })
        : makeCheck("runtime.manifest", "blocked", "Runtime manifest ID가 없습니다.");
}
function checkProviderChat(manifest) {
    const provider = manifest.provider;
    if (!provider.provider)
        return makeCheck("provider.chat", "blocked", "AI provider가 설정되어 있지 않습니다.", { resolverPath: provider.resolverPath }, "AI 연결 설정에서 provider를 저장하세요.");
    if (!provider.model)
        return makeCheck("provider.chat", "blocked", "기본 모델이 설정되어 있지 않습니다.", { provider: provider.provider }, "AI 연결 설정에서 기본 모델을 선택하세요.");
    if (provider.capabilityMatrix.endpointMismatch.status === "warning") {
        return makeCheck("provider.chat", "warning", "Provider endpoint 설정과 실행 경로가 완전히 일치하지 않습니다.", {
            provider: provider.provider,
            model: provider.model,
            profileId: provider.profileId,
            adapterType: provider.capabilityMatrix.adapterType,
            baseUrlClass: provider.capabilityMatrix.baseUrlClass,
            endpointMismatch: provider.capabilityMatrix.endpointMismatch,
        }, "AI 연결 설정의 provider 종류, 인증 방식, endpoint를 다시 확인하세요.");
    }
    return makeCheck("provider.chat", "ok", "Chat provider 설정이 존재합니다.", {
        provider: provider.provider,
        model: provider.model,
        profileId: provider.profileId,
        adapterType: provider.capabilityMatrix.adapterType,
        authMode: provider.authMode,
        credentialConfigured: provider.credentialConfigured,
    });
}
function checkProviderResolver(manifest) {
    const provider = manifest.provider;
    if (provider.profileId !== provider.runtimeProfileId) {
        return makeCheck("provider.resolver", "blocked", "설정 화면의 provider profile과 runtime resolver profile이 다릅니다.", {
            configuredProfileId: provider.profileId,
            runtimeProfileId: provider.runtimeProfileId,
            resolverPath: provider.resolverPath,
        }, "설정을 다시 저장하고 런타임을 재시작하세요.");
    }
    return makeCheck("provider.resolver", "ok", "Provider resolver evidence가 설정 profile과 일치합니다.", {
        profileId: provider.profileId,
        resolverPath: provider.resolverPath,
        adapterType: provider.capabilityMatrix.adapterType,
        credentialSourceKind: provider.capabilityMatrix.authType,
        lastCheckResult: provider.capabilityMatrix.lastCheckResult,
    });
}
function checkProviderEmbedding(manifest) {
    const provider = manifest.provider;
    if (!provider.embeddingConfigured) {
        return makeCheck("provider.embedding", "warning", "Embedding provider가 설정되어 있지 않아 vector 검색은 제한됩니다.", {
            searchMode: manifest.memory.searchMode,
            capability: provider.capabilityMatrix.embeddings,
        });
    }
    return makeCheck("provider.embedding", "ok", "Embedding provider 설정이 존재합니다.", {
        provider: provider.embeddingProvider,
        model: provider.embeddingModel,
        capability: provider.capabilityMatrix.embeddings,
    });
}
function countRecentWebRetrievalEvents() {
    const events = listControlEvents({ component: "web_retrieval", limit: 500 });
    let conflictCount = 0;
    let plannerSchemaFailureCount = 0;
    let failedAttemptCount = 0;
    for (const event of events) {
        const serialized = `${event.event_type} ${event.summary} ${event.detail_json ?? ""}`.toLocaleLowerCase("en-US");
        if (serialized.includes("conflict") || serialized.includes("insufficient_conflict"))
            conflictCount += 1;
        if (serialized.includes("planner_") && (serialized.includes("schema") || serialized.includes("invalid") || serialized.includes("parse_failed")))
            plannerSchemaFailureCount += 1;
        if (serialized.includes("attempt") && (serialized.includes("failed") || serialized.includes("timeout") || serialized.includes("error")))
            failedAttemptCount += 1;
    }
    return { conflictCount, plannerSchemaFailureCount, failedAttemptCount };
}
function checkWebRetrievalCapability() {
    try {
        const cfg = getConfig();
        const adapters = buildWebSourceAdapterRegistrySnapshot();
        const recent = countRecentWebRetrievalEvents();
        const detail = {
            searchProvider: cfg.search.web?.provider ?? "duckduckgo",
            configuredMaxResults: cfg.search.web?.maxResults ?? 5,
            providerOrder: [
                "web_search: selenium browser first",
                "web_search: duckduckgo lite fallback",
                "web_fetch: direct fetch",
                "known_source_adapter: finance/weather parser",
                "ai_assisted_planner: bounded next-source planner",
            ],
            cacheTtl: DEFAULT_RETRIEVAL_CACHE_TTL_POLICY,
            conflictPolicy: DEFAULT_EVIDENCE_CONFLICT_POLICY,
            browser: {
                driver: "selenium-webdriver",
                fallback: "duckduckgo_lite",
                availability: "checked_at_runtime",
            },
            adapters: adapters.adapters.map((adapter) => ({
                adapterId: adapter.adapterId,
                adapterVersion: adapter.adapterVersion,
                parserVersion: adapter.parserVersion,
                checksum: adapter.checksum,
                status: adapter.status,
                domains: adapter.sourceDomains,
                targetKinds: adapter.supportedTargetKinds,
                degradedReason: adapter.degradedReason ?? null,
            })),
            activeAdapterCount: adapters.activeCount,
            degradedAdapterCount: adapters.degradedCount,
            recent,
        };
        if (adapters.activeCount === 0)
            return makeCheck("web.retrieval", "blocked", "활성 web source adapter가 없습니다.", detail, "finance/weather adapter registry와 parser checksum을 확인하세요.");
        if (adapters.degradedCount > 0 || recent.plannerSchemaFailureCount > 0)
            return makeCheck("web.retrieval", "warning", "Web retrieval에 검토가 필요한 adapter/planner 상태가 있습니다.", detail);
        return makeCheck("web.retrieval", "ok", "Web retrieval 검색, fallback, adapter 상태가 확인되었습니다.", detail);
    }
    catch (error) {
        return makeCheck("web.retrieval", "unknown", "Web retrieval capability를 확인하지 못했습니다.", { error: error instanceof Error ? error.message : String(error) });
    }
}
function checkGatewayExposure(manifest) {
    const webui = manifest.channels.webui;
    const exposed = webui.host === "0.0.0.0" || webui.host === "::";
    if (exposed && !webui.authEnabled) {
        return makeCheck("gateway.exposure", "blocked", "WebUI가 외부 인터페이스에 인증 없이 노출되어 있습니다.", { host: webui.host, port: webui.port }, "WebUI auth를 켜거나 host를 127.0.0.1로 제한하세요.");
    }
    if (exposed) {
        return makeCheck("gateway.exposure", "warning", "WebUI가 외부 인터페이스에 노출되어 있습니다.", { host: webui.host, port: webui.port, authEnabled: webui.authEnabled });
    }
    return makeCheck("gateway.exposure", "ok", "Gateway 노출 범위가 로컬 중심입니다.", { host: webui.host, port: webui.port });
}
function checkCredentialRedaction(manifest) {
    return hasSecretLeak(manifest)
        ? makeCheck("credential.redaction", "blocked", "Runtime manifest에 secret처럼 보이는 값이 포함되어 있습니다.", {}, "manifest/doctor 출력 필드의 secret redaction을 점검하세요.")
        : makeCheck("credential.redaction", "ok", "Runtime manifest 출력에 secret 원문이 포함되지 않았습니다.");
}
function checkTelegram(manifest) {
    const telegram = manifest.channels.telegram;
    if (!telegram.enabled)
        return makeCheck("channel.telegram", "unknown", "Telegram 채널이 비활성화되어 있습니다.");
    if (!telegram.credentialConfigured)
        return makeCheck("channel.telegram", "blocked", "Telegram bot token이 설정되어 있지 않습니다.");
    if (!telegram.targetConfigured)
        return makeCheck("channel.telegram", "warning", "Telegram 허용 사용자/그룹 대상이 비어 있습니다.");
    return makeCheck("channel.telegram", "ok", "Telegram 채널 설정이 존재합니다.");
}
function checkSlack(manifest) {
    const slack = manifest.channels.slack;
    if (!slack.enabled)
        return makeCheck("channel.slack", "unknown", "Slack 채널이 비활성화되어 있습니다.");
    if (!slack.credentialConfigured)
        return makeCheck("channel.slack", "blocked", "Slack bot/app token이 설정되어 있지 않습니다.");
    if (!slack.targetConfigured)
        return makeCheck("channel.slack", "warning", "Slack 허용 채널 대상이 비어 있습니다.");
    return makeCheck("channel.slack", "ok", "Slack 채널 설정이 존재합니다.");
}
function checkWebui(manifest) {
    const webui = manifest.channels.webui;
    if (!webui.enabled)
        return makeCheck("channel.webui", "unknown", "WebUI가 비활성화되어 있습니다.");
    return makeCheck("channel.webui", "ok", "WebUI 채널이 활성화되어 있습니다.", { host: webui.host, port: webui.port, authEnabled: webui.authEnabled });
}
function checkMqtt(manifest) {
    const mqtt = manifest.channels.mqtt;
    if (!mqtt.enabled)
        return makeCheck("yeonjang.mqtt", "unknown", "MQTT 브로커가 비활성화되어 있습니다.");
    if (!mqtt.running)
        return makeCheck("yeonjang.mqtt", "warning", mqtt.reason ?? "MQTT 브로커가 실행 중이 아닙니다.", { host: mqtt.host, port: mqtt.port });
    return makeCheck("yeonjang.mqtt", "ok", "MQTT 브로커가 실행 중입니다.", { host: mqtt.host, port: mqtt.port, authEnabled: mqtt.authEnabled });
}
function checkYeonjangProtocol(manifest) {
    if (manifest.yeonjang.nodeCount === 0)
        return makeCheck("yeonjang.protocol", "unknown", "연장 노드가 연결되어 있지 않습니다.");
    const missing = manifest.yeonjang.nodes.filter((node) => !node.protocolVersion || !node.capabilityHash);
    if (missing.length > 0) {
        return makeCheck("yeonjang.protocol", "warning", "일부 연장 노드의 protocol/capability 정보가 부족합니다.", { missing: missing.map((node) => node.extensionId) });
    }
    return makeCheck("yeonjang.protocol", "ok", "연장 protocol/capability 정보가 확인되었습니다.", { nodeCount: manifest.yeonjang.nodeCount });
}
function checkDbMigration(manifest) {
    const db = manifest.database;
    if (db.unknownAppliedVersions.length > 0) {
        return makeCheck("db.migration", "blocked", "현재 코드가 알지 못하는 DB migration version이 적용되어 있습니다.", { unknownAppliedVersions: db.unknownAppliedVersions });
    }
    if (!db.exists)
        return makeCheck("db.migration", "warning", "DB 파일이 아직 생성되지 않았습니다. 최초 실행 시 migration이 적용됩니다.", { latestVersion: db.latestVersion });
    if (!db.upToDate)
        return makeCheck("db.migration", "warning", "적용되지 않은 DB migration이 있습니다.", { currentVersion: db.currentVersion, latestVersion: db.latestVersion, pendingVersions: db.pendingVersions });
    return makeCheck("db.migration", "ok", "DB migration이 최신입니다.", { currentVersion: db.currentVersion, latestVersion: db.latestVersion });
}
function checkMigrationLock(manifest) {
    const lock = manifest.rollout.migrationLock.active;
    if (lock) {
        return makeCheck("db.migration.lock", "blocked", "Migration lock이 active 상태라 쓰기 작업을 차단해야 합니다.", {
            lockId: lock.id,
            phase: lock.phase,
            backupSnapshotId: lock.backup_snapshot_id,
            rollbackRunbookRef: lock.rollback_runbook_ref,
            pendingVersions: lock.pending_versions_json,
            updatedAt: lock.updated_at,
        }, "write-heavy 작업을 재개하기 전에 backup snapshot과 migration rollback runbook을 확인하세요.");
    }
    const latest = manifest.rollout.migrationLock.latest;
    if (latest?.status === "failed") {
        return makeCheck("db.migration.lock", "blocked", "마지막 migration lock이 실패 상태로 끝났습니다.", {
            lockId: latest.id,
            phase: latest.phase,
            backupSnapshotId: latest.backup_snapshot_id,
            rollbackRunbookRef: latest.rollback_runbook_ref,
            errorMessage: latest.error_message,
        }, "새 migration을 재시도하기 전에 rollback runbook과 DB integrity를 확인하세요.");
    }
    return makeCheck("db.migration.lock", "ok", "활성 migration lock이 없습니다.", latest ? { latestLockId: latest.id, latestStatus: latest.status } : {});
}
function checkFeatureFlags(manifest) {
    const flags = manifest.rollout.featureFlags;
    const rollback = flags.filter((flag) => flag.mode === "rollback");
    const enforced = flags.filter((flag) => flag.mode === "enforced");
    const shadow = flags.filter((flag) => flag.mode === "shadow" || flag.mode === "dual_write");
    const detail = {
        flags: flags.map((flag) => ({ featureKey: flag.featureKey, mode: flag.mode, compatibilityMode: flag.compatibilityMode, source: flag.source })),
        enforcedCount: enforced.length,
        shadowOrDualWriteCount: shadow.length,
        rollbackCount: rollback.length,
    };
    if (rollback.length > 0)
        return makeCheck("feature.flags", "warning", "일부 feature flag가 rollback mode입니다.", detail, "rollback mode가 의도된 상태인지 확인하고 rollout evidence를 점검하세요.");
    return makeCheck("feature.flags", "ok", "Feature flag snapshot이 정상적으로 확인되었습니다.", detail);
}
function checkRolloutEvidence(manifest) {
    const rollout = manifest.rollout;
    const detail = {
        mismatchCount: rollout.shadowCompare.mismatchCount,
        warningCount: rollout.evidence.warningCount,
        blockedCount: rollout.evidence.blockedCount,
        latestEvidence: rollout.evidence.latest.map((item) => ({ featureKey: item.feature_key, stage: item.stage, status: item.status, summary: item.summary })),
        recentMismatches: rollout.shadowCompare.recentMismatches.map((item) => ({ featureKey: item.feature_key, targetKind: item.target_kind, targetId: item.target_id, summary: item.summary })),
    };
    if (rollout.evidence.blockedCount > 0)
        return makeCheck("rollout.evidence", "blocked", "Rollout evidence에 blocked 항목이 있습니다.", detail, "enforced 전환을 중단하고 blocked evidence의 run/control timeline을 확인하세요.");
    if (rollout.shadowCompare.mismatchCount > 0 || rollout.evidence.warningCount > 0)
        return makeCheck("rollout.evidence", "warning", "Shadow compare 또는 rollout evidence에 검토가 필요한 항목이 있습니다.", detail);
    return makeCheck("rollout.evidence", "ok", "Rollout evidence에 blocking mismatch가 없습니다.", detail);
}
function checkPlanDrift() {
    try {
        const report = runPlanDriftCheck();
        const detail = {
            summary: report.summary,
            phasePlans: report.phasePlans,
            releaseNoteEvidence: {
                verifiedTasks: report.releaseNoteEvidence.verifiedTasks.length,
                manualOnlyTasks: report.releaseNoteEvidence.manualOnlyTasks.length,
                unverifiedTasks: report.releaseNoteEvidence.unverifiedTasks.length,
                pendingTasks: report.releaseNoteEvidence.pendingTasks.length,
                warningsByCode: report.releaseNoteEvidence.warningsByCode,
            },
            warnings: report.warnings.slice(0, 20),
        };
        if (report.summary.blockedCount > 0)
            return makeCheck("plan.drift", "blocked", "Plan drift check에 blocked 항목이 있습니다.", detail, "phase/task 문서와 evidence 상태를 먼저 정리하세요.");
        if (report.summary.warningCount > 0)
            return makeCheck("plan.drift", "warning", "Plan drift check에 검토가 필요한 항목이 있습니다.", detail, "완료 task에는 자동 테스트, 수동 smoke, manual-only evidence 중 하나를 남기세요.");
        return makeCheck("plan.drift", "ok", "Phase plan과 task evidence 상태가 현재 기준과 일치합니다.", detail);
    }
    catch (error) {
        return makeCheck("plan.drift", "unknown", "Plan drift 상태를 확인하지 못했습니다.", { error: error instanceof Error ? error.message : String(error) });
    }
}
function checkPromptRegistry(manifest) {
    const prompts = manifest.promptSources;
    if (prompts.count === 0)
        return makeCheck("prompt.registry", "blocked", "prompt source registry를 읽지 못했습니다.", { diagnostics: prompts.diagnostics });
    if (!prompts.localeParityOk)
        return makeCheck("prompt.registry", "warning", "prompt source locale parity 문제가 있습니다.", { diagnostics: prompts.diagnostics });
    return makeCheck("prompt.registry", "ok", "prompt source registry가 정상입니다.", { count: prompts.count, checksum: prompts.checksum });
}
function checkMemoryFts(manifest) {
    const memory = manifest.memory;
    if (!memory.dbExists)
        return makeCheck("memory.fts", "warning", "DB 파일이 없어 FTS 상태를 확인하지 못했습니다.");
    if (memory.ftsAvailable === true)
        return makeCheck("memory.fts", "ok", "Memory FTS 테이블이 존재합니다.");
    if (memory.ftsAvailable === false)
        return makeCheck("memory.fts", "warning", "Memory FTS 테이블을 찾지 못했습니다.");
    return makeCheck("memory.fts", "unknown", "Memory FTS 상태를 확인하지 못했습니다.");
}
function checkMemoryVector(manifest) {
    const memory = manifest.memory;
    if (!memory.embeddingProvider || !memory.embeddingModel)
        return makeCheck("memory.vector", "warning", "Embedding 설정이 없어 vector 검색은 비활성 또는 제한 상태입니다.");
    if (memory.vectorTableAvailable === true)
        return makeCheck("memory.vector", "ok", "Memory vector 테이블이 존재합니다.", { embeddingRows: memory.embeddingRows });
    if (memory.vectorTableAvailable === false)
        return makeCheck("memory.vector", "warning", "Memory vector 테이블을 찾지 못했습니다.");
    return makeCheck("memory.vector", "unknown", "Memory vector 상태를 확인하지 못했습니다.");
}
function checkQueueBackpressure() {
    try {
        const queues = buildQueueBackpressureSnapshot();
        const stopped = queues.filter((queue) => queue.status === "stopped");
        const recovering = queues.filter((queue) => queue.status === "recovering");
        const waiting = queues.filter((queue) => queue.status === "waiting");
        const detail = {
            queues: queues.map((queue) => ({
                queueName: queue.queueName,
                status: queue.status,
                running: queue.running,
                pending: queue.pending,
                oldestPendingAgeMs: queue.oldestPendingAgeMs,
                deadLetterCount: queue.deadLetterCount,
            })),
        };
        if (stopped.length > 0) {
            return makeCheck("queue.backpressure", "blocked", "일부 queue가 dead-letter 상태로 자동 재시도를 중단했습니다.", detail, "해당 recovery key를 확인하고 명시적으로 재시도하거나 운영자 조치로 retry budget을 reset하세요.");
        }
        if (recovering.length > 0)
            return makeCheck("queue.backpressure", "warning", "일부 queue가 backpressure 복구 상태입니다.", detail);
        if (waiting.length > 0)
            return makeCheck("queue.backpressure", "warning", "일부 queue에 대기 중인 작업이 있습니다.", detail);
        return makeCheck("queue.backpressure", "ok", "Queue backpressure 상태가 정상입니다.", detail);
    }
    catch (error) {
        return makeCheck("queue.backpressure", "unknown", "Queue backpressure 상태를 확인하지 못했습니다.", { error: error instanceof Error ? error.message : String(error) });
    }
}
function checkExtensionRegistry() {
    try {
        const registry = buildExtensionRegistrySnapshot({
            tools: toolDispatcher.getAll({ includeIsolated: true }),
            mcpStatuses: mcpRegistry.getStatuses(),
        });
        const degraded = registry.entries.filter((entry) => entry.status === "degraded" || entry.status === "error");
        const approvalRequired = registry.entries.filter((entry) => entry.enabled && entry.trustPolicy.requiresApproval && !entry.trustPolicy.approved);
        const detail = {
            checksum: registry.checksum,
            totalCount: registry.totalCount,
            enabledCount: registry.enabledCount,
            disabledCount: registry.disabledCount,
            degradedCount: registry.degradedCount,
            dangerousCount: registry.dangerousCount,
            degraded: degraded.map((entry) => ({ id: entry.id, kind: entry.kind, status: entry.status, reason: entry.degradedReason })),
            approvalRequired: approvalRequired.map((entry) => ({ id: entry.id, kind: entry.kind, permissionScope: entry.permissionScope, trustLevel: entry.trustPolicy.trustLevel })),
        };
        if (approvalRequired.length > 0) {
            return makeCheck("extension.registry", "blocked", "승인되지 않은 위험 확장이 활성화 대상에 포함되어 있습니다.", detail, "위험 권한 확장은 approval registry를 통과한 뒤 활성화하세요.");
        }
        if (degraded.length > 0) {
            return makeCheck("extension.registry", "warning", "일부 확장이 실패 또는 degraded 상태입니다.", detail, "해당 확장의 diagnostic event와 checksum을 확인하고 필요하면 rollback 하세요.");
        }
        return makeCheck("extension.registry", "ok", "Extension registry와 trust policy 상태가 정상입니다.", detail);
    }
    catch (error) {
        return makeCheck("extension.registry", "unknown", "Extension registry 상태를 확인하지 못했습니다.", { error: error instanceof Error ? error.message : String(error) });
    }
}
function checkArtifactStorage() {
    const artifactsDir = join(PATHS.stateDir, "artifacts");
    try {
        mkdirSync(artifactsDir, { recursive: true });
        accessSync(artifactsDir, constants.R_OK | constants.W_OK);
        return makeCheck("artifact.storage", "ok", "Artifact 저장소를 읽고 쓸 수 있습니다.", { artifactsDir });
    }
    catch (error) {
        return makeCheck("artifact.storage", "blocked", "Artifact 저장소를 사용할 수 없습니다.", { artifactsDir, error: error instanceof Error ? error.message : String(error) });
    }
}
function checkScheduleQueue(manifest) {
    const cfg = getConfig();
    if (!cfg.scheduler.enabled)
        return makeCheck("schedule.queue", "unknown", "Scheduler가 비활성화되어 있습니다.");
    if (!manifest.database.exists)
        return makeCheck("schedule.queue", "warning", "DB가 없어 schedule queue 상태를 확인하지 못했습니다.");
    return makeCheck("schedule.queue", "ok", "Scheduler가 활성화되어 있고 DB가 존재합니다.", { timezone: cfg.scheduler.timezone });
}
function checkReleasePackage(manifest) {
    const releasePackage = manifest.releasePackage;
    if (!releasePackage.manifestId)
        return makeCheck("release.package", "unknown", "Release manifest 상태를 계산하지 못했습니다.");
    if ((releasePackage.requiredMissingCount ?? 0) > 0) {
        return makeCheck("release.package", "warning", "Release package 필수 산출물이 일부 누락되어 있습니다.", { requiredMissingCount: releasePackage.requiredMissingCount });
    }
    return makeCheck("release.package", "ok", "Release package manifest preflight가 통과했습니다.", { manifestId: releasePackage.manifestId, releaseVersion: releasePackage.releaseVersion });
}
export function runDoctor(options = {}) {
    const mode = options.mode ?? "quick";
    const manifestOptions = {
        includeEnvironment: options.includeEnvironment ?? mode === "full",
        includeReleasePackage: options.includeReleasePackage ?? mode === "full",
    };
    if (options.now)
        manifestOptions.now = options.now;
    const manifest = buildRuntimeManifest(manifestOptions);
    const checks = [
        checkRuntimeManifest(manifest),
        checkProviderChat(manifest),
        checkProviderResolver(manifest),
        checkProviderEmbedding(manifest),
        checkWebRetrievalCapability(),
        checkGatewayExposure(manifest),
        checkCredentialRedaction(manifest),
        checkTelegram(manifest),
        checkSlack(manifest),
        checkWebui(manifest),
        checkMqtt(manifest),
        checkYeonjangProtocol(manifest),
        checkDbMigration(manifest),
        checkMigrationLock(manifest),
        checkPromptRegistry(manifest),
        checkMemoryFts(manifest),
        checkMemoryVector(manifest),
        checkQueueBackpressure(),
        checkExtensionRegistry(),
        checkFeatureFlags(manifest),
        checkRolloutEvidence(manifest),
        checkPlanDrift(),
        checkArtifactStorage(),
        checkScheduleQueue(manifest),
        checkReleasePackage(manifest),
    ];
    const summary = summarize(checks);
    const createdAt = (options.now ?? new Date()).toISOString();
    const report = sanitizeValue({
        kind: "nobie.doctor.report",
        version: 1,
        id: `${manifest.id}-${mode}`,
        mode,
        createdAt,
        overallStatus: overallStatus(checks),
        runtimeManifestId: manifest.id,
        checks,
        summary,
        manifest,
    });
    eventBus.emit("doctor.checked", {
        reportId: report.id,
        mode: report.mode,
        overallStatus: report.overallStatus,
        runtimeManifestId: report.runtimeManifestId,
    });
    return report;
}
export function writeDoctorReportArtifact(report) {
    const dir = join(PATHS.stateDir, "diagnostics");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `doctor-${report.createdAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
    return path;
}
export function lastDoctorReportExists() {
    return existsSync(join(PATHS.stateDir, "diagnostics"));
}
//# sourceMappingURL=doctor.js.map