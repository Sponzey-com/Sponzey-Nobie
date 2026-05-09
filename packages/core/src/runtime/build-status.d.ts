export type RuntimeBuildPackageKey = "core" | "cli";
export interface RuntimeBuildPackageInput {
    package: RuntimeBuildPackageKey;
    sourceDir: string;
    distDir: string;
}
export interface RuntimeBuildFileMtime {
    path: string;
    mtimeMs: number;
    mtimeIso: string;
}
export interface RuntimeBuildPackageStatus {
    package: RuntimeBuildPackageKey;
    sourceDir: string;
    distDir: string;
    sourceNewest: RuntimeBuildFileMtime | null;
    distNewest: RuntimeBuildFileMtime | null;
    missingOutputs: string[];
    staleOutputs: Array<{
        sourcePath: string;
        outputPath: string;
        sourceMtimeIso: string;
        outputMtimeIso: string | null;
    }>;
    buildRequired: boolean;
    restartRequired: boolean;
}
export interface RuntimeBuildStatus {
    checkedAt: string;
    processStartedAt: string;
    processStartTimeMs: number;
    workspaceRoot: string;
    gitCommit: string | null;
    gitDescribe: string | null;
    buildId: string;
    buildRequired: boolean;
    restartRequired: boolean;
    packages: RuntimeBuildPackageStatus[];
    warnings: string[];
}
export interface RuntimeBuildStatusInput {
    workspaceRoot?: string;
    processStartTimeMs?: number;
    now?: Date;
    packages?: RuntimeBuildPackageInput[];
    commandRunner?: (command: string, args: string[], cwd: string) => string | null;
}
export declare function getGatewayProcessStartTimeMs(): number;
export declare function buildRuntimeBuildStatus(input?: RuntimeBuildStatusInput): RuntimeBuildStatus;
export declare function getRuntimeBuildStatus(now?: Date): RuntimeBuildStatus;
