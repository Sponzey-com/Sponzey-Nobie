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
  sourceMarker?: string
}

export interface CriticalDecisionSourceScanRule {
  ruleId: string
  entryId: string
  file: string
  pattern: RegExp
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
    id: "request-semantics.legacy_reuse_and_cancellation",
    file: "packages/core/src/runs/request-semantics.js",
    symbols: ["shouldReuseConversationContext", "detectActiveQueueCancellationMode"],
    category: "temporary-guard",
    decisionArea: "legacy request continuation and cancellation",
    signalKind: "user-natural-language-regex",
    languageSensitive: true,
    userFacingRisk: "legacy compiled-only path가 언어별 키워드로 대화 재사용 또는 취소 의도를 판단할 수 있다.",
    currentRole: "현재 TypeScript 진입점에서는 entry-comparison AI 경로로 대체되었는지 확인해야 하는 legacy 위험 항목.",
    migrationTask: "Task 006",
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
    id: "scheduled.tool_disable_keyword_guard",
    file: "packages/core/src/runs/scheduled.ts",
    symbols: ["TOOL_REQUIRING_TASK_PATTERN", "shouldDisableToolsForScheduledTask"],
    category: "temporary-guard",
    decisionArea: "scheduled execution tool availability",
    signalKind: "user-natural-language-regex",
    languageSensitive: true,
    userFacingRisk: "예약 payload 언어가 바뀌면 도구 사용 여부가 잘못 꺼지거나 켜질 수 있다.",
    currentRole: "ScheduleContract가 없는 legacy schedule fallback에서만 도구 비활성 후보를 고른다. Contract schedule 실행의 최종 판단에는 사용하지 않는다.",
    migrationTask: "Task 005, Task 009",
    sourceMarker: "nobie-critical-decision-audit: scheduled.tool_disable_keyword_guard",
  },
  {
    id: "scheduled.direct_literal_extraction",
    file: "packages/core/src/runs/scheduled.ts",
    symbols: ["DIRECT_DELIVERY_PATTERNS", "extractDirectChannelDeliveryText"],
    category: "temporary-guard",
    decisionArea: "scheduled direct literal delivery",
    signalKind: "user-natural-language-regex",
    languageSensitive: true,
    userFacingRisk: "따옴표/힌트 표현이 언어별로 달라지면 literal delivery를 놓치거나 잘못 추출할 수 있다.",
    currentRole: "ScheduleContract가 없는 legacy schedule fallback에서만 literal 후보를 추출한다. Contract schedule은 저장된 payload.kind/literalText를 사용한다.",
    migrationTask: "Task 005, Task 009",
    sourceMarker: "nobie-critical-decision-audit: scheduled.direct_literal_extraction",
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
    migrationTask: "Task 005, Task 008",
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
]

export const criticalDecisionSourceScanRules: CriticalDecisionSourceScanRule[] = [
  {
    ruleId: "legacy-request-semantics-keyword-regex",
    entryId: "request-semantics.legacy_reuse_and_cancellation",
    file: "packages/core/src/runs/request-semantics.js",
    pattern: /function shouldReuseConversationContext[\s\S]*?koreanReferencePatterns[\s\S]*?englishReferencePatterns[\s\S]*?function detectActiveQueueCancellationMode/u,
  },
  {
    ruleId: "scheduled-tool-keyword-regex",
    entryId: "scheduled.tool_disable_keyword_guard",
    file: "packages/core/src/runs/scheduled.ts",
    pattern: /const TOOL_REQUIRING_TASK_PATTERN[\s\S]*?shouldDisableToolsForScheduledTask/u,
  },
  {
    ruleId: "scheduled-direct-literal-regex",
    entryId: "scheduled.direct_literal_extraction",
    file: "packages/core/src/runs/scheduled.ts",
    pattern: /const DIRECT_DELIVERY_PATTERNS[\s\S]*?extractDirectChannelDeliveryText/u,
  },
  {
    ruleId: "completion-followup-normalized-dedupe",
    entryId: "completion.followup_prompt_dedupe",
    file: "packages/core/src/runs/completion-application.ts",
    pattern: /followupPrompt\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.toLowerCase\(\)/u,
  },
]

export function getCriticalDecisionAuditEntry(id: string): CriticalDecisionAuditEntry | undefined {
  return criticalDecisionAuditEntries.find((entry) => entry.id === id)
}
