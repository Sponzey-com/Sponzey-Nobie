import { type AgentExecutionContext, type AgentExecutionDecision, type AgentExecutionDecisionTraceSnapshot, type DelegationValidationResult, type SelfSolveAttempt, validateAgentExecutionDecisionShape } from "./execution-decision-contract.js";
export type AgentExecutionHarnessReasonCode = "accepted" | "model_unavailable" | "model_timeout" | "model_call_failed" | "non_json_output" | "schema_invalid" | DelegationValidationResult["status"];
export interface AgentExecutionModelCallInput {
    prompt: string;
    context: AgentExecutionContext;
    signal: AbortSignal;
}
export type AgentExecutionModelCaller = (input: AgentExecutionModelCallInput) => Promise<string>;
export interface AgentExecutionHarnessTraceEvent {
    phase: "prompt_built" | "model_call" | "json_parse" | "schema_validation" | "context_validation" | "fallback";
    status: "ok" | "failed" | "fallback";
    reasonCode: AgentExecutionHarnessReasonCode;
    detail?: string;
}
export interface AgentExecutionHarnessValidation {
    shape: ReturnType<typeof validateAgentExecutionDecisionShape>;
    delegation: DelegationValidationResult;
}
export type AgentExecutionHarnessResult = {
    ok: true;
    decision: AgentExecutionDecision;
    decisionTrace: AgentExecutionDecisionTraceSnapshot;
    validation: AgentExecutionHarnessValidation;
    trace: AgentExecutionHarnessTraceEvent[];
    rawModelOutput: string;
} | {
    ok: false;
    decision: AgentExecutionDecision;
    decisionTrace: AgentExecutionDecisionTraceSnapshot;
    validation?: AgentExecutionHarnessValidation;
    fallbackReason: AgentExecutionHarnessReasonCode;
    selfSolveAttempt?: SelfSolveAttempt;
    trace: AgentExecutionHarnessTraceEvent[];
    rawModelOutput?: string;
};
export interface RunAgentExecutionHarnessInput {
    context: AgentExecutionContext;
    callModel?: AgentExecutionModelCaller;
    timeoutMs?: number;
    allowExplicitTarget?: boolean;
    now?: () => number;
    idProvider?: () => string;
}
export declare function createAgentExecutionDecision(input: RunAgentExecutionHarnessInput): Promise<AgentExecutionDecision>;
export declare function runAgentExecutionHarness(input: RunAgentExecutionHarnessInput): Promise<AgentExecutionHarnessResult>;
export declare function buildAgentExecutionDecisionPrompt(context: AgentExecutionContext): string;
export declare function parseAgentExecutionDecisionModelOutput(output: string): {
    ok: true;
    value: unknown;
} | {
    ok: false;
    issue: string;
};
export declare function validateAgentExecutionDecisionAgainstContext(input: {
    context: AgentExecutionContext;
    decision: AgentExecutionDecision;
    allowExplicitTarget?: boolean;
}): DelegationValidationResult;
export declare function buildAgentExecutionDecisionTraceSnapshot(input: {
    context: AgentExecutionContext;
    decision: AgentExecutionDecision;
    validation?: DelegationValidationResult | undefined;
    decisionSource?: string | undefined;
    fallbackReason?: string | undefined;
    resolvedDecision?: AgentExecutionDecision | undefined;
}): AgentExecutionDecisionTraceSnapshot;
export declare function formatAgentExecutionDecisionTraceRunEvent(trace: AgentExecutionDecisionTraceSnapshot): string;
//# sourceMappingURL=execution-harness.d.ts.map