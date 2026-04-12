/**
 * Walk up from workDir (up to 3 parent levels) searching for NOBIE.md first,
 * then legacy WIZBY.md / HOWIE.md / SIDEKICK.md.
 * Returns the file contents (trimmed to 8KB) or null if not found.
 */
export declare function loadNobieMd(workDir: string): string | null;
/** Write a NOBIE.md template to the given directory. */
export declare function initNobieMd(dir: string): string;
export declare const loadWizbyMd: typeof loadNobieMd;
export declare const initWizbyMd: typeof initNobieMd;
export declare const loadHowieMd: typeof loadNobieMd;
export declare const initHowieMd: typeof initNobieMd;
export declare const loadSidekickMd: typeof loadNobieMd;
export declare const initSidekickMd: typeof initNobieMd;
//# sourceMappingURL=sidekick-md.d.ts.map