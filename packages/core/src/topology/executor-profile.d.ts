import type { NodeContract } from "../contracts/enterprise-topology.js";
export declare const EXECUTOR_PROFILE_SCHEMA_VERSION: 1;
export declare const EXECUTOR_PROFILE_METADATA_KEY: "executorProfile";
export interface ExecutorProfile {
    schemaVersion: typeof EXECUTOR_PROFILE_SCHEMA_VERSION;
    executorId: string;
    displayName: string;
    roleName: string;
    definition: string;
    does: string[];
    delegationScope: string[];
    expectedOutputs: string[];
    handoffStyle: string;
    declineCriteria: string[];
    riskBoundary: string[];
}
export declare function normalizeExecutorProfile(value: unknown, fallback: {
    executorId: string;
    displayName: string;
    roleName?: string | undefined;
    definition?: string | undefined;
    does?: string[] | undefined;
    delegationScope?: string[] | undefined;
    expectedOutputs?: string[] | undefined;
    handoffStyle?: string | undefined;
    declineCriteria?: string[] | undefined;
    riskBoundary?: string[] | undefined;
}): ExecutorProfile;
export declare function buildExecutorProfileFromNode(node: NodeContract, overrides?: {
    executorId?: string;
    displayName?: string;
}): ExecutorProfile;
//# sourceMappingURL=executor-profile.d.ts.map