export type PlanDriftSeverity = "info" | "warning" | "blocked";
export type PlanDriftWarningCode = "phase_plan_missing" | "missing_required_section" | "completed_without_evidence" | "missing_referenced_path" | "plan_outdated_claim";
export interface TaskEvidenceMetadata {
    path: string;
    title: string;
    status: string;
    completed: boolean;
    checkedItems: number;
    totalItems: number;
    sections: string[];
    missingSections: string[];
    evidenceCommands: string[];
    hasAutomatedEvidence: boolean;
    hasManualSmokeEvidence: boolean;
    manualOnly: boolean;
    hasEvidence: boolean;
}
export interface PlanDriftWarning {
    code: PlanDriftWarningCode;
    severity: PlanDriftSeverity;
    path: string;
    message: string;
    detail: Record<string, unknown>;
}
export interface PhasePlanStatus {
    phase: "phase001" | "phase002";
    path: string;
    exists: boolean;
}
export interface PlanDriftReleaseNoteEvidence {
    verifiedTasks: Array<{
        path: string;
        title: string;
        status: string;
        evidenceCommands: string[];
    }>;
    manualOnlyTasks: Array<{
        path: string;
        title: string;
        status: string;
    }>;
    unverifiedTasks: Array<{
        path: string;
        title: string;
        status: string;
        reason: string;
    }>;
    pendingTasks: Array<{
        path: string;
        title: string;
        status: string;
    }>;
    warningsByCode: Record<PlanDriftWarningCode, number>;
}
export interface PlanDriftReport {
    kind: "nobie.plan-drift.report";
    version: 1;
    rootDir: string;
    createdAt: string;
    phasePlans: PhasePlanStatus[];
    tasks: TaskEvidenceMetadata[];
    warnings: PlanDriftWarning[];
    summary: {
        taskCount: number;
        completedTaskCount: number;
        warningCount: number;
        blockedCount: number;
        missingEvidenceCount: number;
    };
    releaseNoteEvidence: PlanDriftReleaseNoteEvidence;
}
export interface PlanDriftCheckOptions {
    rootDir?: string;
    now?: Date;
    requiredTaskSections?: string[];
}
export declare function parseTaskMetadata(filePath: string, content: string, requiredTaskSections?: string[]): TaskEvidenceMetadata;
export declare function runPlanDriftCheck(options?: PlanDriftCheckOptions): PlanDriftReport;
export declare function buildReleaseNoteEvidenceSummary(tasks: TaskEvidenceMetadata[], warnings: PlanDriftWarning[]): PlanDriftReleaseNoteEvidence;
//# sourceMappingURL=plan-drift.d.ts.map