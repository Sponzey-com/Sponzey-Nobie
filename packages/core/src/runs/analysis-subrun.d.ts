import { buildFilesystemVerificationPrompt, verifyFilesystemTargets } from "./filesystem-verification.js";
import type { RunContextMode, RunScope, RunStatus, RunStepStatus, TaskProfile } from "./types.js";
export interface AnalysisOnlySubrunResult {
    ok: boolean;
    summary: string;
    reason?: string;
    remainingItems?: string[];
}
export interface AnalysisOnlySubrunDependencies {
    createRun: (params: {
        id: string;
        sessionId: string;
        requestGroupId: string;
        lineageRootRunId?: string;
        parentRunId?: string;
        runScope?: RunScope;
        handoffSummary?: string;
        prompt: string;
        source: "webui" | "cli" | "telegram" | "slack";
        taskProfile: TaskProfile;
        targetLabel?: string;
        contextMode: RunContextMode;
        maxDelegationTurns: number;
    }) => void;
    appendRunEvent: (runId: string, label: string) => void;
    setRunStepStatus: (runId: string, stepKey: string, status: RunStepStatus, summary: string) => unknown;
    updateRunStatus: (runId: string, status: RunStatus, summary: string, canCancel: boolean) => unknown;
    verifyFilesystemTargets: typeof verifyFilesystemTargets;
    buildFilesystemVerificationPrompt: typeof buildFilesystemVerificationPrompt;
    createId: () => string;
}
export declare function finalizeAnalysisOnlySubrun(runId: string, params: {
    executionSummary: string;
    relaySummary: string;
    eventLabel?: string;
}, dependencies: Pick<AnalysisOnlySubrunDependencies, "appendRunEvent" | "setRunStepStatus" | "updateRunStatus">): void;
export declare function runFilesystemVerificationSubtask(params: {
    parentRunId: string;
    requestGroupId: string;
    sessionId: string;
    source: "webui" | "cli" | "telegram" | "slack";
    originalRequest: string;
    mutationPaths: string[];
    workDir: string;
    dependencies?: Partial<AnalysisOnlySubrunDependencies>;
}): Promise<AnalysisOnlySubrunResult>;
//# sourceMappingURL=analysis-subrun.d.ts.map