export type PromptSourceUsageScope = "runtime" | "first_run" | "planner" | "diagnostic";
export interface PromptSourceMetadata {
    sourceId: string;
    locale: "ko" | "en";
    path: string;
    version: string;
    priority: number;
    enabled: boolean;
    required: boolean;
    usageScope: PromptSourceUsageScope;
    checksum: string;
}
export interface LoadedPromptSource extends PromptSourceMetadata {
    content: string;
}
export interface PromptSourceState {
    sourceId: string;
    locale: "ko" | "en";
    enabled: boolean;
}
export interface PromptSourceSnapshot {
    assemblyVersion: 1;
    createdAt: number;
    sources: PromptSourceMetadata[];
    diagnostics: PromptSourceDiagnostic[];
}
export interface PromptSourceAssembly {
    text: string;
    snapshot: PromptSourceSnapshot;
    sources: LoadedPromptSource[];
}
export interface PromptSourceDiffLine {
    kind: "unchanged" | "added" | "removed" | "changed";
    beforeLine?: number;
    afterLine?: number;
    before?: string;
    after?: string;
}
export interface PromptSourceDiffResult {
    beforeChecksum: string;
    afterChecksum: string;
    changed: boolean;
    lines: PromptSourceDiffLine[];
}
export interface PromptSourceBackupResult {
    backupId: string;
    sourceId: string;
    locale: "ko" | "en";
    sourcePath: string;
    backupPath: string;
    checksum: string;
    createdAt: number;
}
export interface PromptSourceWriteResult {
    backup: PromptSourceBackupResult | null;
    source: LoadedPromptSource;
    diff: PromptSourceDiffResult;
}
export interface PromptSourceRollbackResult {
    sourcePath: string;
    backupPath: string;
    restoredChecksum: string;
    previousChecksum: string;
}
export interface PromptSourceExportFile {
    kind: "nobie.prompt-sources.export";
    version: 1;
    createdAt: number;
    sources: LoadedPromptSource[];
}
export interface PromptSourceExportResult {
    exportPath: string;
    checksum: string;
    createdAt: number;
    sourceCount: number;
    sources: PromptSourceMetadata[];
}
export interface PromptSourceImportResult {
    exportPath: string;
    imported: string[];
    skipped: string[];
    backups: PromptSourceBackupResult[];
    registry: PromptSourceMetadata[];
}
export interface PromptSourceDryRunResult {
    assembly: PromptSourceAssembly | null;
    sourceOrder: Array<{
        sourceId: string;
        locale: "ko" | "en";
        checksum: string;
        version: string;
        path: string;
    }>;
    totalChars: number;
    diagnostics: PromptSourceDiagnostic[];
}
export interface PromptSourceLocaleParityIssue {
    sourceId: string;
    code: "missing_locale" | "section_mismatch";
    locale?: "ko" | "en";
    message: string;
}
export interface PromptSourceLocaleParityResult {
    ok: boolean;
    issues: PromptSourceLocaleParityIssue[];
}
export interface PromptSourceDiagnostic {
    severity: "error" | "warning";
    code: "required_prompt_source_missing";
    sourceId: string;
    locale: "ko" | "en";
    message: string;
}
export declare const REQUIRED_RUNTIME_PROMPT_SOURCE_IDS: string[];
export interface PromptSourceSeedResult {
    promptsDir: string;
    created: string[];
    existing: string[];
    registry: LoadedPromptSource[];
}
/**
 * Walk up from workDir (up to 3 parent levels) searching for NOBIE.md first,
 * then legacy WIZBY.md / HOWIE.md.
 * Returns the file contents (trimmed to 8KB) or null if not found.
 */
export declare function loadNobieMd(workDir: string): string | null;
export declare function detectPromptSourceSecretMarkers(content: string): string[];
export declare function isPromptSourceContentSafe(content: string): boolean;
export declare function ensurePromptSourceFiles(workDir: string): PromptSourceSeedResult;
export declare function loadPromptSourceRegistry(workDir: string): LoadedPromptSource[];
export declare function loadSystemPromptSourceAssembly(workDir: string, locale?: "ko" | "en", states?: PromptSourceState[]): PromptSourceAssembly | null;
export declare function loadFirstRunPromptSourceAssembly(workDir: string, locale?: "ko" | "en", states?: PromptSourceState[]): PromptSourceAssembly | null;
/**
 * Load canonical runtime prompt sources from prompts/.
 * Bootstrap prompts are intentionally excluded from the default runtime assembly.
 */
export declare function loadSystemPromptSources(workDir: string): string | null;
export declare function buildPromptSourceContentDiff(beforeContent: string, afterContent: string): PromptSourceDiffResult;
export declare function createPromptSourceBackup(workDir: string, sourceId: string, locale: "ko" | "en"): PromptSourceBackupResult;
export declare function exportPromptSourcesToFile(input: {
    workDir: string;
    outputPath: string;
}): PromptSourceExportResult;
export declare function importPromptSourcesFromFile(input: {
    workDir: string;
    exportPath: string;
    overwrite?: boolean;
}): PromptSourceImportResult;
export declare function writePromptSourceWithBackup(input: {
    workDir: string;
    sourceId: string;
    locale: "ko" | "en";
    content: string;
    createBackup?: boolean;
}): PromptSourceWriteResult;
export declare function rollbackPromptSourceBackup(input: {
    sourcePath: string;
    backupPath: string;
}): PromptSourceRollbackResult;
export declare function dryRunPromptSourceAssembly(workDir: string, locale?: "ko" | "en", states?: PromptSourceState[]): PromptSourceDryRunResult;
export declare function checkPromptSourceLocaleParity(workDir: string): PromptSourceLocaleParityResult;
/** Write a NOBIE.md template to the given directory. */
export declare function initNobieMd(dir: string): string;
export declare const loadWizbyMd: typeof loadNobieMd;
export declare const initWizbyMd: typeof initNobieMd;
export declare const loadHowieMd: typeof loadNobieMd;
export declare const initHowieMd: typeof initNobieMd;
//# sourceMappingURL=nobie-md.d.ts.map