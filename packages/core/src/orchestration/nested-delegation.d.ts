import type { CommandRequest, OrchestrationPlan, StructuredTaskScope, SubSessionContract } from "../contracts/sub-agent-orchestration.js";
import type { OrchestrationModeSnapshot } from "./mode.js";
import { type OrchestrationPlannerIntent } from "./planner.js";
import type { OrchestrationRegistrySnapshot } from "./registry.js";
export interface NestedCommandValidationResult {
    ok: boolean;
    reasonCodes: string[];
}
export interface NestedSpawnBudgetInput {
    taskScopes: StructuredTaskScope[];
    maxChildrenPerAgent?: number;
    nestedSpawnBudgetRemaining?: number;
}
export interface NestedSpawnBudgetDecision {
    status: "ok" | "shrunk" | "blocked";
    selectedTaskScopes: StructuredTaskScope[];
    skipped: Array<{
        index: number;
        reasonCode: string;
    }>;
    totals: {
        requestedChildren: number;
        selectedChildren: number;
        remainingBudget: number | null;
    };
    reasonCodes: string[];
}
export interface NestedDelegationPlannerInput {
    parentRunId: string;
    parentRequestId: string;
    parentAgentId: string;
    userRequest: string;
    modeSnapshot: OrchestrationModeSnapshot;
    registrySnapshot: OrchestrationRegistrySnapshot;
    parentSubSessionId?: string;
    parentSubSessionDepth?: number;
    taskScopes?: StructuredTaskScope[];
    intent?: OrchestrationPlannerIntent;
    maxDepth?: number;
    maxChildrenPerAgent?: number;
    nestedSpawnBudgetRemaining?: number;
    now?: () => number;
    idProvider?: () => string;
}
export interface NestedDelegationPlanResult {
    ok: boolean;
    status: "planned" | "shrunk" | "blocked";
    plan?: OrchestrationPlan;
    parentAgentId: string;
    parentSubSessionId?: string;
    parentSubSessionDepth: number;
    childDepth: number;
    budget: NestedSpawnBudgetDecision;
    reasonCodes: string[];
}
export declare function validateNestedCommandRequest(input: {
    command: CommandRequest;
    parentAgentId?: string;
    rootAgentId?: string;
    expectedParentSubSessionId?: string;
}): NestedCommandValidationResult;
export declare function calculateSubSessionDepth(subSessionId: string, subSessions: readonly SubSessionContract[]): number | undefined;
export declare function applyNestedSpawnBudget(input: NestedSpawnBudgetInput): NestedSpawnBudgetDecision;
export declare function buildNestedDelegationPlan(input: NestedDelegationPlannerInput): NestedDelegationPlanResult;
//# sourceMappingURL=nested-delegation.d.ts.map