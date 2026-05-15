import { createExecutorDraftFromInference } from "./executor-inference.js";
import { redactNodeDefinitionSuggestionRequest, } from "./node-definition-redaction.js";
export const NODE_DEFINITION_FIELDS = [
    "name",
    "description",
    "expectedOutput",
    "successCriteria",
    "capabilityHints",
    "toolHints",
    "understandingSummary",
];
export const NODE_DEFINITION_ROLE_CHIPS = [
    "실행자",
    "분석자",
    "검토자",
    "승인자",
    "문제 해결자",
    "결과 정리자",
];
export const NODE_DEFINITION_STYLE_CHIPS = [
    "빠르게",
    "꼼꼼하게",
    "초보자도 이해 가능하게",
    "결과 중심으로",
    "협업하기 좋게",
    "실패 대안까지 포함",
];
export const NODE_DEFINITION_OUTPUT_CHIPS = [
    "구현 결과",
    "검토 의견",
    "작업 분할",
    "요약 보고",
    "테스트 결과",
    "다음 실행자에게 넘길 내용",
];
const INTERNAL_TERMS = [
    "EnterpriseTopology",
    "NodeContract",
    "WorkOrder",
    "GraphExecutionPlan",
    "DelegationResolution",
    "runtime profile",
];
export function normalizeNodeDefinitionQuickChips(values) {
    const allowed = new Set([
        ...NODE_DEFINITION_ROLE_CHIPS,
        ...NODE_DEFINITION_STYLE_CHIPS,
    ]);
    return compactStrings(Array.isArray(values) ? values : []).filter((chip) => allowed.has(chip));
}
export function initialNodeDefinitionQuickChipsFromDraft(draft) {
    const saved = normalizeNodeDefinitionQuickChips(draft.quickChips);
    if (saved.length > 0)
        return saved;
    const haystack = [
        draft.name,
        draft.description,
        draft.understandingSummary,
        ...draft.capabilityHints,
    ].join(" ");
    return normalizeNodeDefinitionQuickChips([
        ...NODE_DEFINITION_ROLE_CHIPS,
        ...NODE_DEFINITION_STYLE_CHIPS,
    ].filter((chip) => haystack.includes(chip)));
}
export function defaultNodeDefinitionFieldLocks(overrides = {}) {
    return {
        name: false,
        description: false,
        expectedOutput: false,
        successCriteria: false,
        capabilityHints: false,
        toolHints: false,
        understandingSummary: false,
        ...overrides,
    };
}
export function fieldLocksForNodeDefinitionTrigger(triggerField, userLocks = {}) {
    if (triggerField === "whole_node")
        return defaultNodeDefinitionFieldLocks(userLocks);
    const locks = defaultNodeDefinitionFieldLocks({
        name: true,
        description: true,
        expectedOutput: true,
        successCriteria: true,
        capabilityHints: true,
        toolHints: true,
        understandingSummary: true,
        ...userLocks,
    });
    locks[triggerField] = userLocks[triggerField] ?? false;
    if (triggerField === "description")
        locks.name = true;
    if (triggerField === "expectedOutput") {
        locks.name = true;
        locks.description = true;
    }
    return locks;
}
export function targetFieldsForNodeDefinitionTrigger(triggerField, locks) {
    if (triggerField === "whole_node")
        return NODE_DEFINITION_FIELDS.filter((field) => !locks[field]);
    return locks[triggerField] ? [] : [triggerField];
}
export function nodeDefinitionDraftFromExecutor(executor, locks = {}) {
    return {
        executorId: executor.id,
        name: executor.name,
        description: executor.description,
        ...(executor.definitionQuickChips?.length
            ? { quickChips: normalizeNodeDefinitionQuickChips(executor.definitionQuickChips) }
            : {}),
        expectedOutput: executor.inferredOutputs[0] ?? "",
        successCriteria: [...executor.inferredSuccessCriteria],
        capabilityHints: [...executor.inferredCapabilities],
        toolHints: [...executor.inferredTools],
        understandingSummary: executor.inferenceEvidence?.normalizedUnderstanding.outputs.join(", ") ??
            executor.inferredOutputs.join(", "),
        fieldLocks: defaultNodeDefinitionFieldLocks(locks),
    };
}
export function executorFromNodeDefinitionDraft(input) {
    const inferred = createExecutorDraftFromInference({
        id: input.executor.id,
        name: input.draft.name,
        description: input.draft.description,
        ...(input.executor.sourceNodeId ? { sourceNodeId: input.executor.sourceNodeId } : {}),
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    return {
        ...input.executor,
        name: input.draft.name,
        description: input.draft.description,
        definitionQuickChips: normalizeNodeDefinitionQuickChips(input.draft.quickChips),
        inferredRuntimeMode: inferred.inferredRuntimeMode,
        inferredCapabilities: input.draft.capabilityHints.length > 0
            ? [...input.draft.capabilityHints]
            : inferred.inferredCapabilities,
        inferredTools: input.draft.toolHints.length > 0 ? [...input.draft.toolHints] : inferred.inferredTools,
        inferredOutputs: input.draft.expectedOutput.trim()
            ? [input.draft.expectedOutput.trim()]
            : inferred.inferredOutputs,
        inferredSuccessCriteria: input.draft.successCriteria.length > 0
            ? [...input.draft.successCriteria]
            : inferred.inferredSuccessCriteria,
        confidence: inferred.confidence,
    };
}
export function buildNodeDefinitionGraphContext(input) {
    if (!input.graph || !input.executorId) {
        return { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] };
    }
    const byId = new Map(input.graph.executors.map((executor) => [executor.id, executor]));
    const incoming = [];
    const outgoing = [];
    const meanings = [];
    for (const connection of input.graph.connections) {
        if (connection.toExecutorId === input.executorId) {
            incoming.push(nodeContextSummary(byId, connection, "incoming"));
            meanings.push(connection.label);
        }
        if (connection.fromExecutorId === input.executorId) {
            outgoing.push(nodeContextSummary(byId, connection, "outgoing"));
            meanings.push(connection.label);
        }
    }
    return {
        incomingExecutors: incoming,
        outgoingExecutors: outgoing,
        neighborConnectionMeanings: [...new Set(meanings)],
    };
}
export function normalizeNodeDefinitionSuggestionRequest(request) {
    const currentDraft = normalizeDraft(request.currentDraft);
    const fieldLocks = normalizeFieldLocks(request.fieldLocks ?? currentDraft.fieldLocks);
    const triggerField = isTriggerField(request.triggerField) ? request.triggerField : "whole_node";
    const targetFields = normalizeTargetFields(request.targetFields, fieldLocks, triggerField);
    return {
        workspaceId: nonEmpty(request.workspaceId) || "workspace:draft",
        topologyId: nonEmpty(request.topologyId) || "topology:draft",
        ...(nonEmpty(request.executorId) ? { executorId: nonEmpty(request.executorId) } : {}),
        triggerField,
        targetFields,
        userPrompt: compactWhitespace(request.userPrompt ?? ""),
        quickChips: compactStrings(request.quickChips),
        currentDraft: {
            ...currentDraft,
            fieldLocks,
        },
        fieldLocks,
        graphContext: normalizeGraphContext(request.graphContext),
        redaction: {
            mode: request.redaction?.mode ?? "workspace_default",
            redactedFields: compactStrings(request.redaction?.redactedFields),
        },
        suggestionHistory: normalizeSuggestionHistory(request.suggestionHistory),
        ...(request.modelPreference ? {
            modelPreference: {
                ...(nonEmpty(request.modelPreference.providerId) ? { providerId: nonEmpty(request.modelPreference.providerId) } : {}),
                ...(nonEmpty(request.modelPreference.modelId) ? { modelId: nonEmpty(request.modelPreference.modelId) } : {}),
            },
        } : {}),
    };
}
export function buildNodeDefinitionPromptInput(request) {
    const quickChipGroups = splitDefinitionQuickChips(request.quickChips);
    const promptParts = [
        request.userPrompt ? `노드 개요: ${request.userPrompt}` : "",
        quickChipGroups.roles.length > 0 ? `선택한 역할: ${quickChipGroups.roles.join(", ")}` : "",
        quickChipGroups.styles.length > 0 ? `선택한 스타일: ${quickChipGroups.styles.join(", ")}` : "",
        quickChipGroups.extra.length > 0 ? `추가 조건: ${quickChipGroups.extra.join(", ")}` : "",
        `현재 이름: ${request.currentDraft.name || "비어 있음"}`,
        `현재 설명: ${request.currentDraft.description || "비어 있음"}`,
        request.graphContext.incomingExecutors.length > 0
            ? `이전 실행자: ${request.graphContext.incomingExecutors.map((item) => item.name).join(", ")}`
            : "",
        request.graphContext.outgoingExecutors.length > 0
            ? `다음 실행자: ${request.graphContext.outgoingExecutors.map((item) => item.name).join(", ")}`
            : "",
        `갱신 대상: ${request.targetFields.join(", ")}`,
        `유지할 필드: ${NODE_DEFINITION_FIELDS.filter((field) => request.fieldLocks[field]).join(", ") || "없음"}`,
        request.targetFields.includes("name")
            ? "역할명 작성 지침: patch.name에는 사용자가 바로 이해할 수 있는 짧고 명확한 한국어 역할명을 넣는다. 기능명이나 대안명만 쓰지 말고, 노드 개요와 선택한 역할이 드러나는 이름으로 작성한다."
            : "",
        request.targetFields.includes("description")
            ? "성격과 하는 일 작성 지침: 선택한 역할, 선택한 스타일, 노드 개요를 모두 반영한다. 노드 개요를 그대로 반복하지 말고, 이 실행자가 맡는 책임, 입력을 해석하는 방식, 판단 기준, 실제 처리 순서, 다른 실행자에게 넘기는 내용, 완료 기준을 5~8문장으로 상세하게 풀어쓴다."
            : "",
        request.targetFields.includes("description")
            ? "최종 검토 지침: description 초안을 만든 뒤 책임, 입력 해석, 판단 기준, 처리 순서, 위임/전달 내용, 완료 기준, 리스크 또는 확인 필요 항목이 빠졌는지 한 번 더 검토한다. 빠진 부분을 보완한 최종 description만 patch.description에 넣고, rationale에는 검토 후 보완한 핵심을 짧게 적는다."
            : "",
    ].filter(Boolean);
    return promptParts.join("\n");
}
function splitDefinitionQuickChips(chips) {
    const roleSet = new Set(NODE_DEFINITION_ROLE_CHIPS);
    const styleSet = new Set(NODE_DEFINITION_STYLE_CHIPS);
    const roles = [];
    const styles = [];
    const extra = [];
    for (const chip of chips) {
        if (roleSet.has(chip))
            roles.push(chip);
        else if (styleSet.has(chip))
            styles.push(chip);
        else
            extra.push(chip);
    }
    return { roles, styles, extra };
}
export function applyNodeDefinitionAlternative(input) {
    const previousDraft = structuredClone(input.draft);
    const draft = structuredClone(input.draft);
    const diff = [];
    const appliedFields = [];
    const ignoredLockedFields = [];
    for (const field of NODE_DEFINITION_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(input.patch, field))
            continue;
        if (input.fieldLocks[field]) {
            ignoredLockedFields.push(field);
            continue;
        }
        const nextValue = normalizePatchField(field, input.patch[field]);
        if (isEmptyImportantPatch(field, nextValue))
            continue;
        const before = draft[field];
        if (JSON.stringify(before) === JSON.stringify(nextValue))
            continue;
        draft[field] = nextValue;
        diff.push({ field, before, after: nextValue, locked: false });
        appliedFields.push(field);
    }
    draft.aiSuggestionState = {
        ...(draft.aiSuggestionState ?? {}),
        selectedAlternativeId: input.alternativeId,
        appliedFieldNames: appliedFields,
    };
    return { draft, previousDraft, diff, appliedFields, ignoredLockedFields };
}
export async function createNodeDefinitionSuggestion(input, dependencies = {}) {
    const normalized = normalizeNodeDefinitionSuggestionRequest(input.request);
    if (normalized.targetFields.length === 0) {
        return {
            ok: false,
            error: "no_target_fields",
            message: "갱신할 수 있는 항목이 없습니다. Lock을 해제한 뒤 다시 시도하세요.",
            warnings: [],
        };
    }
    const modelInfo = resolveSuggestionModelInfo(normalized, input.modelConfig);
    if (!modelInfo) {
        return {
            ok: false,
            error: "llm_not_configured",
            message: "등록된 LLM이 없습니다. 설정에서 기본 모델을 등록한 뒤 다시 시도하세요.",
            warnings: [{ code: "llm_not_configured", message: "등록된 LLM이 없습니다." }],
        };
    }
    const redactionInput = {
        request: normalized,
        mode: normalized.redaction.mode,
        isLocalModel: modelInfo.isLocal,
        ...(input.workspaceStrictRedaction !== undefined ? { workspaceStrict: input.workspaceStrictRedaction } : {}),
    };
    const redacted = redactNodeDefinitionSuggestionRequest(redactionInput);
    const prompt = buildNodeDefinitionPrompt(redacted.request);
    const suggestionRunId = dependencies.idProvider?.() ?? `node-definition-suggestion:${Date.now()}`;
    let raw;
    try {
        raw = dependencies.generateStructured
            ? await dependencies.generateStructured({ prompt, request: redacted.request, modelInfo })
            : buildDeterministicAlternativePayload(redacted.request);
    }
    catch (error) {
        if (isRateLimitSuggestionError(error)) {
            return {
                ok: false,
                error: "rate_limited",
                message: "AI 제안 요청이 잠시 제한되었습니다. 잠시 뒤 다시 시도하세요.",
                warnings: [{ code: "rate_limited", message: "AI provider rate limit에 도달했습니다." }],
            };
        }
        return {
            ok: false,
            error: "llm_response_invalid",
            message: "AI 제안 생성에 실패했습니다. 현재 노드 내용은 유지됩니다.",
            warnings: [{ code: "llm_response_invalid", message: suggestionErrorMessage(error) }],
        };
    }
    const validated = validateNodeDefinitionSuggestionPayload({
        raw,
        request: redacted.request,
        suggestionRunId,
        modelInfo,
        redactedFields: redacted.report.redactedFields,
        redactionMode: redacted.report.mode,
    });
    if (!validated.ok)
        return validated;
    return {
        ...validated,
        warnings: [...redacted.report.warnings, ...validated.warnings],
    };
}
export function validateNodeDefinitionSuggestionPayload(input) {
    const parsed = parseRawSuggestionPayload(input.raw);
    if (!Array.isArray(parsed.alternatives)) {
        return {
            ok: false,
            error: "llm_response_invalid",
            message: "AI 제안 응답을 읽을 수 없습니다. 다시 제안해 주세요.",
            warnings: [{ code: "llm_response_invalid", message: "alternatives 배열이 없습니다." }],
        };
    }
    const warnings = [];
    const alternatives = parsed.alternatives
        .slice(0, 3)
        .map((item, index) => normalizeAlternative(item, index, input.request, warnings))
        .filter((item) => item !== null);
    if (alternatives.length === 0) {
        return {
            ok: false,
            error: "llm_response_invalid",
            message: "사용할 수 있는 AI 제안이 없습니다. 조건을 바꿔 다시 시도하세요.",
            warnings: [...warnings, { code: "llm_response_invalid", message: "유효한 대안이 없습니다." }],
        };
    }
    if (hasTooSimilarAlternatives(alternatives)) {
        warnings.push({ code: "alternatives_too_similar", message: "일부 대안이 서로 비슷합니다." });
    }
    return {
        ok: true,
        suggestionRunId: input.suggestionRunId,
        alternatives,
        modelInfo: input.modelInfo,
        appliedRedaction: {
            mode: input.redactionMode ?? input.request.redaction.mode,
            redactedFields: input.redactedFields ?? [],
        },
        warnings,
    };
}
function buildNodeDefinitionPrompt(request) {
    return [
        "You are helping a user define an executor node in a visual workflow.",
        "The user should not need to understand internal runtime concepts.",
        "Return exactly 3 alternatives when possible.",
        "Do not modify locked fields and do not include locked fields in patch.",
        "Prefer concise Korean labels and plain language.",
        "Use all selected roles, selected styles, and the node overview as first-class requirements.",
        "For every alternative, set patch.name to a short, explicit Korean role name that reflects the node overview and selected role.",
        "When patch.description is requested, expand the user's node overview into a detailed Korean role description.",
        "The description must be specific enough for a sub-agent to understand how to work: responsibilities, decision criteria, step-by-step behavior, handoff content, and completion conditions.",
        "Before returning JSON, internally review each alternative for missing responsibilities, input interpretation, decision criteria, work steps, handoff details, completion criteria, and risk or clarification points.",
        "Revise patch.description with anything missing from that review. Return only the final reviewed description, not a separate review checklist.",
        "Use rationale to briefly state what was strengthened after review.",
        "Do not return a one-sentence generic description for patch.description.",
        `Forbidden internal terms: ${INTERNAL_TERMS.join(", ")}`,
        "",
        buildNodeDefinitionPromptInput(request),
    ].join("\n");
}
function resolveSuggestionModelInfo(request, modelConfig) {
    const providerId = request.modelPreference?.providerId || modelConfig?.provider;
    const modelId = request.modelPreference?.modelId || modelConfig?.model;
    if (!providerId || !modelId)
        return null;
    return {
        providerId,
        modelId,
        isLocal: providerId === "ollama" || providerId === "llama",
    };
}
function buildDeterministicAlternativePayload(request) {
    const base = request.userPrompt || request.quickChips.join(" ") || request.currentDraft.description || request.currentDraft.name || "업무 처리";
    const quickChipGroups = splitDefinitionQuickChips(request.quickChips);
    const presets = [
        ["균형형", "요청의 의도를 먼저 확인하고 실행 가능한 계획과 결과를 균형 있게 정리하는 실행자"],
        ["품질형", "누락과 모호함을 줄이기 위해 기준과 근거를 꼼꼼히 확인하는 실행자"],
        ["협업형", "다음 실행자가 바로 이어받을 수 있도록 맥락과 결정 이유를 선명하게 남기는 실행자"],
    ];
    return {
        alternatives: presets.map(([titlePrefix, summary], index) => {
            const roleName = deterministicRoleName({
                base,
                titlePrefix,
                roles: quickChipGroups.roles,
            });
            return {
                alternativeId: `alternative:${index + 1}`,
                title: `${titlePrefix} ${roleName}`,
                summary,
                patch: {
                    name: roleName,
                    description: detailedDeterministicDescription({
                        base,
                        roleName,
                        titlePrefix,
                        summary,
                        roles: quickChipGroups.roles,
                        styles: quickChipGroups.styles,
                        hasIncoming: request.graphContext.incomingExecutors.length > 0,
                        hasOutgoing: request.graphContext.outgoingExecutors.length > 0,
                    }),
                    expectedOutput: `${summary}의 결과와 다음 단계에 필요한 요약`,
                    successCriteria: [
                        "요청한 결과가 명확히 정리됨",
                        "다음 실행자가 바로 이해할 수 있음",
                    ],
                    capabilityHints: [titlePrefix, "업무 처리"],
                    toolHints: request.currentDraft.toolHints,
                    understandingSummary: summary,
                },
                rationale: "역할명, 스타일, 노드 개요를 반영한 뒤 책임, 판단 기준, 처리 순서, 전달 내용이 빠지지 않았는지 검토해 보완했습니다.",
                recommendedConnectionMeaning: request.graphContext.outgoingExecutors.length > 0 ? "넘김" : "참고 요청",
                riskNotes: request.currentDraft.description.includes("삭제") ? ["삭제나 권한 작업은 실행 전 확인이 필요합니다."] : [],
                confidence: 0.72 + index * 0.04,
            };
        }),
    };
}
function deterministicRoleName(input) {
    const role = input.roles[0] || `${input.titlePrefix} 실행자`;
    const topic = input.base
        .replace(/[.,!?。！？]/g, " ")
        .split(/\s+/)
        .map((part) => part.replace(/(을|를|은|는|이|가|에게|으로|로|와|과)$/u, ""))
        .filter(Boolean)
        .slice(0, 2)
        .join(" ");
    return truncate(`${topic || "업무"} ${role}`, 32);
}
function detailedDeterministicDescription(input) {
    const incoming = input.hasIncoming
        ? "이전 실행자가 넘긴 맥락과 요청 배경을 먼저 확인하고, 빠진 정보나 충돌하는 조건이 있는지 점검합니다."
        : "사용자의 요청과 노드 개요를 먼저 읽고, 이 노드가 맡아야 할 범위와 처리하지 말아야 할 범위를 구분합니다.";
    const outgoing = input.hasOutgoing
        ? "다음 실행자가 바로 이어서 처리할 수 있도록 결정 내용, 남은 이슈, 필요한 후속 조치를 함께 정리해 넘깁니다."
        : "마지막에는 사용자가 바로 확인할 수 있는 핵심 결과와 남은 판단 사항을 분명하게 정리합니다.";
    const roleStyle = [
        input.roles.length > 0 ? `선택한 역할인 ${input.roles.join(", ")}의 관점` : "이 노드에 필요한 역할의 관점",
        input.styles.length > 0 ? `선택한 스타일인 ${input.styles.join(", ")}의 방식` : "상황에 맞는 처리 방식",
    ].join("과 ");
    return [
        `${input.roleName}은 ${input.base} 역할을 맡는 ${input.titlePrefix} 실행자입니다.`,
        `${roleStyle}을 기준으로 요청을 해석하고, 사용자가 기대한 결과와 실제로 처리해야 할 작업 범위를 분리합니다.`,
        incoming,
        "업무를 시작하면 목적과 성공 기준을 먼저 세우고, 필요한 작업을 작은 단위로 나누어 우선순위와 실행 순서를 정합니다.",
        `${input.summary}로서 결과만 나열하지 않고, 왜 그렇게 판단했는지와 어떤 기준으로 처리했는지를 함께 남깁니다.`,
        outgoing,
        "작업 중 애매한 입력, 권한 문제, 결과 품질에 영향을 줄 수 있는 위험이 보이면 실행을 멈추기보다 확인할 항목과 가능한 대안을 함께 정리합니다.",
        "한 번 더 검토한 결과 책임, 판단 기준, 처리 순서, 전달 내용 중 빠진 부분이 없는지 확인하고 부족한 설명을 보완합니다.",
        "완료 시에는 처리 결과, 확인한 근거, 추가 확인이 필요한 부분을 구분해 남겨서 이후 흐름이 끊기지 않도록 합니다.",
    ].join(" ");
}
function normalizeAlternative(value, index, request, warnings) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const patch = normalizeAlternativePatch(record.patch, request, warnings);
    if (request.targetFields.includes("name") && !request.fieldLocks.name && !nonEmpty(patch.name)) {
        patch.name = fallbackRoleNameForAlternative(record, index, request, warnings);
    }
    if (Object.keys(patch).length === 0)
        return null;
    const title = cleanUserFacingText(nonEmpty(record.title) || `대안 ${index + 1}`, warnings);
    const summary = cleanUserFacingText(nonEmpty(record.summary) || title, warnings);
    if (summary.length < 4)
        warnings.push({ code: "alternative_too_short", message: `${title} 요약이 너무 짧습니다.` });
    return {
        alternativeId: nonEmpty(record.alternativeId) || `alternative:${index + 1}`,
        title: truncate(title, 80),
        summary: truncate(summary, 180),
        patch,
        rationale: truncate(cleanUserFacingText(nonEmpty(record.rationale) || "요청 내용을 바탕으로 정리했습니다.", warnings), 260),
        ...(nonEmpty(record.recommendedConnectionMeaning)
            ? { recommendedConnectionMeaning: truncate(cleanUserFacingText(nonEmpty(record.recommendedConnectionMeaning), warnings), 40) }
            : {}),
        riskNotes: compactStrings(Array.isArray(record.riskNotes) ? record.riskNotes : []).map((item) => truncate(cleanUserFacingText(item, warnings), 140)),
        confidence: clampConfidence(typeof record.confidence === "number" ? record.confidence : 0.5),
    };
}
function fallbackRoleNameForAlternative(record, index, request, warnings) {
    const explicit = nonEmpty(record.roleName) || nonEmpty(record.name);
    if (explicit)
        return truncate(cleanUserFacingText(explicit, warnings), 32);
    const quickChipGroups = splitDefinitionQuickChips(request.quickChips);
    return deterministicRoleName({
        base: request.userPrompt || request.currentDraft.description || request.currentDraft.name || `대안 ${index + 1}`,
        titlePrefix: nonEmpty(record.title) || `대안 ${index + 1}`,
        roles: quickChipGroups.roles,
    });
}
function normalizeAlternativePatch(patch, request, warnings) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
        return {};
    const record = patch;
    const output = {};
    for (const [key, value] of Object.entries(record)) {
        if (!isNodeDefinitionField(key)) {
            warnings.push({ code: "unknown_field_removed", message: `${key} 필드는 무시했습니다.` });
            continue;
        }
        if (request.fieldLocks[key]) {
            warnings.push({ code: "locked_field_removed", message: `${key} 필드는 잠겨 있어 제안에서 제외했습니다.` });
            continue;
        }
        if (!request.targetFields.includes(key))
            continue;
        const normalized = normalizePatchField(key, value);
        if (isEmptyImportantPatch(key, normalized))
            continue;
        output[key] = normalized;
    }
    return output;
}
function nodeContextSummary(byId, connection, direction) {
    const otherId = direction === "incoming" ? connection.fromExecutorId : connection.toExecutorId;
    const other = byId.get(otherId);
    return {
        executorId: otherId,
        name: other?.name ?? otherId,
        description: other?.description ?? "",
        ...(connection.label ? { connectionLabel: connection.label } : {}),
        direction,
    };
}
function normalizeDraft(value) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fieldLocks = normalizeFieldLocks(record.fieldLocks);
    return {
        executorId: nonEmpty(record.executorId) || "node:draft",
        name: typeof record.name === "string" ? record.name : "",
        description: typeof record.description === "string" ? record.description : "",
        ...(normalizeNodeDefinitionQuickChips(record.quickChips).length > 0
            ? { quickChips: normalizeNodeDefinitionQuickChips(record.quickChips) }
            : {}),
        expectedOutput: typeof record.expectedOutput === "string" ? record.expectedOutput : "",
        successCriteria: compactStrings(Array.isArray(record.successCriteria) ? record.successCriteria : []),
        capabilityHints: compactStrings(Array.isArray(record.capabilityHints) ? record.capabilityHints : []),
        toolHints: compactStrings(Array.isArray(record.toolHints) ? record.toolHints : []),
        understandingSummary: typeof record.understandingSummary === "string" ? record.understandingSummary : "",
        fieldLocks,
    };
}
function normalizeFieldLocks(value) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return defaultNodeDefinitionFieldLocks(Object.fromEntries(NODE_DEFINITION_FIELDS.map((field) => [field, record[field] === true])));
}
function normalizeTargetFields(values, locks, triggerField) {
    const raw = Array.isArray(values) ? values.filter((value) => isNodeDefinitionField(value)) : [];
    const fields = raw.length > 0 ? raw : targetFieldsForNodeDefinitionTrigger(triggerField, locks);
    return [...new Set(fields)].filter((field) => !locks[field]);
}
function normalizeGraphContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] };
    }
    const record = value;
    return {
        incomingExecutors: normalizeContextSummaries(record.incomingExecutors, "incoming"),
        outgoingExecutors: normalizeContextSummaries(record.outgoingExecutors, "outgoing"),
        neighborConnectionMeanings: compactStrings(Array.isArray(record.neighborConnectionMeanings) ? record.neighborConnectionMeanings : []),
    };
}
function normalizeContextSummaries(value, direction) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
        executorId: nonEmpty(item.executorId) || "node:unknown",
        name: nonEmpty(item.name) || nonEmpty(item.executorId) || "이전 실행자",
        description: typeof item.description === "string" ? item.description : "",
        ...(nonEmpty(item.connectionLabel) ? { connectionLabel: nonEmpty(item.connectionLabel) } : {}),
        direction,
    }));
}
function normalizeSuggestionHistory(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
        ...(nonEmpty(item.suggestionRunId) ? { suggestionRunId: nonEmpty(item.suggestionRunId) } : {}),
        userPrompt: typeof item.userPrompt === "string" ? item.userPrompt : "",
        alternativeSummaries: compactStrings(Array.isArray(item.alternativeSummaries) ? item.alternativeSummaries : []),
        ...(nonEmpty(item.selectedAlternativeId) ? { selectedAlternativeId: nonEmpty(item.selectedAlternativeId) } : {}),
        rejectedAlternativeIds: compactStrings(Array.isArray(item.rejectedAlternativeIds) ? item.rejectedAlternativeIds : []),
    }));
}
function parseRawSuggestionPayload(raw) {
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function cleanUserFacingText(value, warnings) {
    let current = value;
    for (const term of INTERNAL_TERMS) {
        if (!current.includes(term))
            continue;
        current = current.replaceAll(term, "실행 설정");
        warnings.push({ code: "internal_term_removed", message: `${term} 용어를 사용자 표현으로 바꿨습니다.` });
    }
    return current;
}
function hasTooSimilarAlternatives(alternatives) {
    const summaries = alternatives.map((alternative) => alternative.summary.trim());
    return new Set(summaries).size < summaries.length;
}
function compactStrings(values = []) {
    return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}
function compactWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}
function isTriggerField(value) {
    return value === "whole_node" || isNodeDefinitionField(value);
}
function isNodeDefinitionField(value) {
    return typeof value === "string" && NODE_DEFINITION_FIELDS.includes(value);
}
function normalizePatchField(field, value) {
    if (field === "successCriteria" || field === "capabilityHints" || field === "toolHints") {
        return compactStrings(Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|,/) : []);
    }
    return typeof value === "string" ? value.trim() : "";
}
function isEmptyImportantPatch(field, value) {
    if (field === "name" || field === "description" || field === "expectedOutput") {
        return typeof value !== "string" || value.trim().length === 0;
    }
    if (Array.isArray(value))
        return value.length === 0;
    return false;
}
function truncate(value, maxLength) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
function clampConfidence(value) {
    return Number(Math.min(1, Math.max(0, value)).toFixed(2));
}
function isRateLimitSuggestionError(error) {
    if (!error || typeof error !== "object")
        return false;
    const record = error;
    if (record.status === 429)
        return true;
    const value = [record.code, record.message].filter((item) => typeof item === "string").join(" ");
    return /rate[_\s-]?limit|too many requests|429/i.test(value);
}
function suggestionErrorMessage(error) {
    if (error instanceof Error && error.message.trim())
        return error.message.trim();
    return "AI provider 응답을 처리할 수 없습니다.";
}
//# sourceMappingURL=node-definition-suggestion.js.map