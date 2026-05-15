import type { ExecutorConnectionDraft, ExecutorDraft } from "./executor-graph.js";
import type { AgentExecutionRiskBoundary } from "../orchestration/execution-decision-contract.js";
export type NodeTaskAnalysisSource = "rule_based" | "llm_assisted" | "user_confirmed" | "runtime_refined";
export interface RecoveryAlternative {
    alternativeId: string;
    title: string;
    changedDimension: "target" | "tool" | "input_shape" | "path" | "permission" | "execution_order" | "task_split" | "verification" | "fallback_route";
    description: string;
}
export interface NodeTaskUnit {
    taskUnitId: string;
    title: string;
    description: string;
    expectedOutput: string;
    requiredCapabilities: string[];
    requiredTools: string[];
    canDelegate: boolean;
    dependencyTaskUnitIds: string[];
}
export interface NodeTaskAnalysis {
    analysisId: string;
    executorId: string;
    source: NodeTaskAnalysisSource;
    purpose: string;
    goals: string[];
    taskUnits: NodeTaskUnit[];
    requiredCapabilities: string[];
    requiredTools: string[];
    inputNeeds: string[];
    outputShape: string;
    completionCondition: string;
    successSignals: string[];
    failureBoundaries: string[];
    safeAlternatives: RecoveryAlternative[];
    confidence: number;
    needsUserConfirmation: boolean;
    createdAt: string;
    updatedAt: string;
}
export declare function buildNodeTaskAnalysis(input: {
    executor: ExecutorDraft;
    incomingConnections?: ExecutorConnectionDraft[];
    outgoingConnections?: ExecutorConnectionDraft[];
    now?: string;
    source?: NodeTaskAnalysisSource;
    riskBoundary?: AgentExecutionRiskBoundary;
}): NodeTaskAnalysis;
//# sourceMappingURL=executor-task-analysis.d.ts.map