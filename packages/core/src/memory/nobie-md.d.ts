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
}
export interface PromptSourceAssembly {
    text: string;
    snapshot: PromptSourceSnapshot;
    sources: LoadedPromptSource[];
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
 * Bootstrap/planner prompts are intentionally excluded from the default runtime assembly.
 */
export declare function loadSystemPromptSources(workDir: string): string | null;
/** Write a NOBIE.md template to the given directory. */
export declare function initNobieMd(dir: string): string;
export declare const loadWizbyMd: typeof loadNobieMd;
export declare const initWizbyMd: typeof initNobieMd;
export declare const loadHowieMd: typeof loadNobieMd;
export declare const initHowieMd: typeof initNobieMd;
//# sourceMappingURL=nobie-md.d.ts.map