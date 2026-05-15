export type CriticalDecisionAuditCategory =
  | "display-only"
  | "candidate-search"
  | "critical-decision"
  | "temporary-guard"

export type CriticalDecisionSignalKind =
  | "structured-id-or-key"
  | "structured-intake-action"
  | "user-natural-language-regex"
  | "raw-prompt-ai-comparison"
  | "raw-prompt-normalized-dedupe"
  | "structured-contract-ai-comparison"
  | "vector-semantic-candidate"
  | "system-error-classification"
  | "system-event-label-classification"
  | "channel-label-classification"

export interface CriticalDecisionAuditEntry {
  id: string
  file: string
  symbols: string[]
  category: CriticalDecisionAuditCategory
  decisionArea: string
  signalKind: CriticalDecisionSignalKind
  languageSensitive: boolean
  userFacingRisk: string
  currentRole: string
  migrationTask?: string
  migrationReason?: string
  sourceMarker?: string
}

export interface CriticalDecisionSourceScanRule {
  ruleId: string
  entryId: string
  file: string
  pattern: RegExp
  migrationTask: string
  migrationReason: string
}

export const criticalDecisionAuditEntries: CriticalDecisionAuditEntry[] = [
  {
    id: "entry-semantics.active_queue_cancellation",
    file: "packages/core/src/runs/entry-semantics.ts",
    symbols: ["analyzeRequestEntrySemantics"],
    category: "display-only",
    decisionArea: "active queue cancellation",
    signalKind: "structured-intake-action",
    languageSensitive: false,
    userFacingRisk: "자연어만으로 활성 작업을 취소하지 않으므로 직접 취소 문장은 구조화된 intake/명시 id 경로가 필요하다.",
    currentRole: "entry semantics는 활성 작업 취소 결정을 내리지 않고, cancel/update는 explicit id 또는 structured contract 경계에서만 처리한다.",
  },
  {
    id: "entry-comparison.contract_projection_comparison",
    file: "packages/core/src/runs/entry-comparison.ts",
    symbols: ["compareRequestContinuationWithAI"],
    category: "critical-decision",
    decisionArea: "request continuation",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "계약 projection이 부족한 legacy 항목은 자동 재사용하지 않고 clarification/new fallback으로 처리된다.",
    currentRole: "incoming IntentContract와 active run contract projection만 isolated AI에 전달해 continuation/cancel/update 대상을 판단한다.",
    sourceMarker: "nobie-critical-decision-audit: entry-comparison.contract_projection_comparison",
  },
  {
    id: "schedules.comparison.contract_projection_only",
    file: "packages/core/src/schedules/comparison.ts",
    symbols: ["compareScheduleContractsWithAI", "comparisonProjection"],
    category: "critical-decision",
    decisionArea: "schedule duplicate/update/cancel contract comparison",
    signalKind: "structured-contract-ai-comparison",
    languageSensitive: false,
    userFacingRisk: "스케줄 비교 AI에 raw prompt나 표시명을 넘기면 언어별 표현 차이가 최종 동일성 판단에 섞일 수 있다.",
    currentRole: "스케줄 comparator는 schedule id와 구조화된 time/payload/delivery/identity projection만 isolated AI에 전달한다.",
    sourceMarker: "nobie-critical-decision-audit: schedules.comparison.contract_projection_only",
  },
  {
    id: "schedules.candidates.semantic_candidate_boundary",
    file: "packages/core/src/schedules/candidates.ts",
    symbols: ["findScheduleCandidatesByContract"],
    category: "candidate-search",
    decisionArea: "schedule candidate search",
    signalKind: "vector-semantic-candidate",
    languageSensitive: true,
    userFacingRisk: "vector/semantic/FTS 점수가 최종 동일성 판단으로 승격되면 다른 언어 요청에서 예약 수정/취소 대상이 오판될 수 있다.",
    currentRole: "semantic 후보는 candidateReason=semantic_candidate, confidenceKind=semantic, requiresComparison=true로만 남기고 final decision으로 사용하지 않는다.",
    migrationTask: "Task 006",
    migrationReason: "semantic 후보 탐색은 최종 판단이 아니며 contract comparator 또는 명시 ID 기반 후보로 축소해야 한다.",
    sourceMarker: "nobie-critical-decision-audit: schedules.candidates.semantic_candidate_boundary",
  },
  {
    id: "scheduled.tool_disable_keyword_guard",
    file: "packages/core/src/runs/scheduled.ts",
    symbols: ["shouldDisableToolsForScheduledTask"],
    category: "critical-decision",
    decisionArea: "scheduled execution tool availability",
    signalKind: "structured-intake-action",
    languageSensitive: false,
    userFacingRisk: "예약 실행의 도구 사용 여부가 execution semantics 없이 계산되면 필요한 도구가 꺼질 수 있다.",
    currentRole: "저장된 TaskExecutionSemantics만 보고 도구 비활성 여부를 계산한다. raw schedule payload나 task profile 문자열은 의미 판단에 쓰지 않는다.",
  },
  {
    id: "scheduled.direct_literal_extraction",
    file: "packages/core/src/runs/scheduled.ts",
    symbols: ["extractDirectChannelDeliveryText"],
    category: "display-only",
    decisionArea: "scheduled direct literal delivery",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "legacy literal extraction이 다시 동작하면 예약 payload 자연어를 재해석할 수 있다.",
    currentRole: "legacy direct literal extraction은 비활성화되어 항상 null을 반환한다. direct delivery는 저장된 literal payload와 delivery contract를 통해서만 판단한다.",
  },
  {
    id: "action-execution.structured_schedule_action",
    file: "packages/core/src/runs/action-execution.ts",
    symbols: ["executeScheduleActions", "executeScheduleAction"],
    category: "critical-decision",
    decisionArea: "schedule create/cancel action dispatch",
    signalKind: "structured-intake-action",
    languageSensitive: false,
    userFacingRisk: "intake 결과가 잘못 구조화되면 schedule action이 잘못 실행될 수 있으나, 이 위치 자체는 원문 문자열 비교를 하지 않는다.",
    currentRole: "AI intake가 만든 action.type을 실행기로 넘기는 구조화된 dispatch 경계.",
    sourceMarker: "nobie-critical-decision-audit: action-execution.structured_schedule_action",
  },
  {
    id: "start-plan.contract_continuation_boundary",
    file: "packages/core/src/runs/start-plan.ts",
    symbols: ["buildStartPlan", "compareRequestContinuation"],
    category: "critical-decision",
    decisionArea: "request continuation boundary",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "명시 id가 없고 후보 계약이 부족하면 active run을 자동 재사용하지 않고 보수적으로 새 실행 또는 clarification으로 전환한다.",
    currentRole: "start-plan은 active run projection과 incoming contract만 comparator로 전달하며 raw prompt/candidate prompt를 비교 경계에 넘기지 않는다.",
    sourceMarker: "nobie-critical-decision-audit: start-plan.contract_continuation_boundary",
  },
  {
    id: "completion.followup_prompt_dedupe",
    file: "packages/core/src/runs/completion-application.ts",
    symbols: ["decideCompletionApplication"],
    category: "temporary-guard",
    decisionArea: "follow-up retry loop dedupe",
    signalKind: "raw-prompt-normalized-dedupe",
    languageSensitive: true,
    userFacingRisk: "후속 지시 문구가 같은지 lower/trim 문자열로 판단해 언어와 표현 차이에 취약하다.",
    currentRole: "같은 후속 지시 반복으로 무한 루프가 생기는 것을 막는 임시 반복 방지 장치.",
    migrationTask: "Task 006, Task 008",
    migrationReason: "반복 방지는 raw prompt normalize가 아니라 structured follow-up id, recovery key, work order id 기반으로 대체해야 한다.",
    sourceMarker: "nobie-critical-decision-audit: completion.followup_prompt_dedupe",
  },
  {
    id: "recovery.normalized_error_key",
    file: "packages/core/src/runs/recovery.ts",
    symbols: ["buildRecoveryKey", "normalizeRecoveryKeyPart"],
    category: "critical-decision",
    decisionArea: "recovery retry dedupe",
    signalKind: "system-error-classification",
    languageSensitive: false,
    userFacingRisk: "오류 종류 정규화가 너무 거칠면 다른 실패를 같은 recovery key로 묶을 수 있다.",
    currentRole: "사용자 원문이 아니라 tool/error kind/action/target/channel 기반으로 같은 실패 반복을 막는다.",
    sourceMarker: "nobie-critical-decision-audit: recovery.normalized_error_key",
  },
  {
    id: "recovery.command_failure_reason",
    file: "packages/core/src/runs/recovery.ts",
    symbols: ["describeCommandFailureReason", "inferCommandFailureAlternatives"],
    category: "candidate-search",
    decisionArea: "recovery alternative selection",
    signalKind: "system-error-classification",
    languageSensitive: false,
    userFacingRisk: "도구 오류 문구가 예상과 다르면 복구 대안 설명이 부정확할 수 있다.",
    currentRole: "사용자 요청 의미가 아니라 실패 원인 분류와 대안 후보 선택에만 사용한다.",
    sourceMarker: "nobie-critical-decision-audit: recovery.command_failure_reason",
  },
  {
    id: "task-model.delivery_channel_label",
    file: "packages/core/src/runs/task-model.ts",
    symbols: ["detectDeliveryChannel"],
    category: "display-only",
    decisionArea: "task monitor delivery channel display",
    signalKind: "channel-label-classification",
    languageSensitive: false,
    userFacingRisk: "표시용 채널 라벨이 unknown으로 보일 수 있으나 실행 대상 결정에는 사용하지 않는다.",
    currentRole: "task monitor UI 표시용 channel label 추정.",
    sourceMarker: "nobie-critical-decision-audit: task-model.delivery_channel_label",
  },
  {
    id: "task-model.delivery_status_label",
    file: "packages/core/src/runs/task-model.ts",
    symbols: ["resolveTaskDeliverySignal"],
    category: "critical-decision",
    decisionArea: "task delivery status projection",
    signalKind: "system-event-label-classification",
    languageSensitive: false,
    userFacingRisk: "event label 기반 projection이라 delivery receipt 도입 전까지 상태 표시가 실제 receipt와 어긋날 수 있다.",
    currentRole: "시스템이 만든 event label에서 task monitor delivery 상태를 투영한다. 사용자 자연어 판단에는 쓰지 않는다.",
    migrationTask: "Task 012",
    migrationReason: "상태 projection은 receipt와 structured event kind 기반으로 정리하고 사용자 요청 의미 판단과 분리해야 한다.",
    sourceMarker: "nobie-critical-decision-audit: task-model.delivery_status_label",
  },
  {
    id: "ingress.external_identity_dedupe",
    file: "packages/core/src/runs/ingress.ts",
    symbols: ["buildIngressDedupeKey"],
    category: "critical-decision",
    decisionArea: "inbound channel event dedupe",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "채널 event id가 누락되면 중복 접수 방지가 약해질 수 있다.",
    currentRole: "자연어 내용이 아니라 source/session/chat/thread/message id로 inbound event 중복을 막는 권장 fast path.",
    sourceMarker: "nobie-critical-decision-audit: ingress.external_identity_dedupe",
  },
  {
    id: "store.reconnect_prompt_similarity",
    file: "packages/core/src/runs/store.ts",
    symbols: ["scoreReconnectCandidate", "looksLikeContinuationMessage", "tokenizeReconnectTerms"],
    category: "temporary-guard",
    decisionArea: "active run reconnect candidate scoring",
    signalKind: "user-natural-language-regex",
    languageSensitive: true,
    userFacingRisk: "새 요청과 기존 run prompt/summary를 문자열 겹침으로 비교하면 다른 언어와 표현에서 재연결 대상이 오판될 수 있다.",
    currentRole: "active run reconnect 후보 점수를 raw prompt token overlap과 continuation regex로 보정하는 제거 대상 경로.",
    migrationTask: "Task 006",
    migrationReason: "active run 재연결은 명시 ID, request group id, IntentContract 비교 결과로 대체해야 한다.",
  },
  {
    id: "start-plan.structured_contract_inspection_boundary",
    file: "packages/core/src/runs/start-plan.ts",
    symbols: ["buildStartPlan", "shouldInspectActiveRunCandidates"],
    category: "critical-decision",
    decisionArea: "start plan active run inspection trigger",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "structured contract 없이 active run 후보를 검사하면 새 요청이 이전 요청에 붙을 수 있다.",
    currentRole: "start-plan은 명시 id, request group id, force reuse, incoming IntentContract projection만 보고 active run 후보 검사 여부를 결정한다.",
  },
  {
    id: "request-isolation.contract_tool_intent_boundary",
    file: "packages/core/src/runs/request-isolation.ts",
    symbols: ["detectExplicitToolIntent", "hasExplicitContinuationReference"],
    category: "critical-decision",
    decisionArea: "run entry tool intent and continuation reference",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "IntentContract가 없을 때 도구 의도를 추정하면 새 요청 격리와 도구 preflight가 흔들릴 수 있다.",
    currentRole: "raw message는 사용하지 않고 IntentContract의 actionType, target, delivery, explicit resend 필드만 보고 도구 intent와 active run 검사 여부를 판단한다.",
  },
  {
    id: "preflight.local_execution_regex",
    file: "packages/core/src/runs/preflight.ts",
    symbols: ["requiresYeonjangRuntime", "resolveStartPreflightFailure", "resolveStartContextPlan"],
    category: "critical-decision",
    decisionArea: "local execution preflight and schedule memory scope",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "execution semantics 없이 로컬 실행 preflight를 계산하면 필요한 Yeonjang 경계가 누락될 수 있다.",
    currentRole: "raw message regex 없이 executionSemantics.privilegedOperation, approvalRequired, approvalTool, run scope, context mode만 보고 preflight 경계를 계산한다.",
  },
  {
    id: "execution-profile.artifact_delivery_regex",
    file: "packages/core/src/runs/execution-profile.ts",
    symbols: ["buildResolvedExecutionProfile", "normalizeDirectArtifactDeliverySemantics", "resolveExecutionSemantics"],
    category: "critical-decision",
    decisionArea: "direct artifact delivery semantics repair",
    signalKind: "structured-intake-action",
    languageSensitive: false,
    userFacingRisk: "execution semantics가 누락되면 direct artifact delivery와 일반 텍스트 응답 경계가 틀어질 수 있다.",
    currentRole: "raw request regex 없이 TaskExecutionSemantics와 TaskIntentEnvelope만 기준으로 execution profile과 direct artifact delivery semantics를 계산한다.",
  },
  {
    id: "delivery-postpass.plain_text_request_reuse",
    file: "packages/core/src/runs/delivery-postpass.ts",
    symbols: ["decideDirectArtifactDeliveryFlow", "buildDeliveryPostPassPreview"],
    category: "critical-decision",
    decisionArea: "delivery postpass artifact recovery bypass",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "delivery outcome 없이 raw request를 재해석하면 artifact recovery가 잘못 생략될 수 있다.",
    currentRole: "delivery postpass는 DeliveryOutcome, successful delivery receipts, seen recovery keys만 보고 direct artifact delivery completion/retry/stop을 결정한다.",
  },
  {
    id: "request-normalizer.phrase_replacement",
    file: "packages/core/src/agent/request-normalizer.ts",
    symbols: ["normalizeRequestForIntake", "detectSourceLanguage", "normalizeWhitespace"],
    category: "display-only",
    decisionArea: "intake request normalization",
    signalKind: "structured-id-or-key",
    languageSensitive: false,
    userFacingRisk: "normalizer가 다시 phrase replacement를 수행하면 사용자 원문과 literal delivery 의도가 훼손될 수 있다.",
    currentRole: "whitespace 정리와 display용 source-language hint만 계산한다. intake 전 의미 변환이나 phrase replacement는 하지 않는다.",
  },
]

export const criticalDecisionSourceScanRules: CriticalDecisionSourceScanRule[] = [
  {
    ruleId: "completion-followup-normalized-dedupe",
    entryId: "completion.followup_prompt_dedupe",
    file: "packages/core/src/runs/completion-application.ts",
    pattern: /followupPrompt\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.toLowerCase\(\)/u,
    migrationTask: "Task 006, Task 008",
    migrationReason: "후속 지시 반복 방지를 structured follow-up id, recovery key, work order id 기반으로 대체해야 한다.",
  },
  {
    ruleId: "store-reconnect-prompt-similarity",
    entryId: "store.reconnect_prompt_similarity",
    file: "packages/core/src/runs/store.ts",
    pattern: /const CONTINUATION_MESSAGE_PATTERNS[\s\S]*?function scoreReconnectCandidate[\s\S]*?overlap\.length/u,
    migrationTask: "Task 006",
    migrationReason: "active run 재연결 점수화를 명시 ID와 IntentContract 비교 기반으로 대체해야 한다.",
  },
]

export function getCriticalDecisionAuditEntry(id: string): CriticalDecisionAuditEntry | undefined {
  return criticalDecisionAuditEntries.find((entry) => entry.id === id)
}
