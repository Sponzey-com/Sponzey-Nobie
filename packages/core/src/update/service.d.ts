type UpdateStatus = "idle" | "latest" | "update_available" | "unsupported" | "error";
export interface UpdateSnapshot {
    currentVersion: string;
    latestVersion: string | null;
    checkedAt: number | null;
    updateAvailable: boolean;
    status: UpdateStatus;
    message: string;
    source: string | null;
    repositoryUrl: string | null;
    releaseUrl: string | null;
}
export declare function getCurrentAppVersion(): string;
export declare function getUpdateSnapshot(): UpdateSnapshot;
export declare function checkForUpdates(): Promise<UpdateSnapshot>;
export {};
//# sourceMappingURL=service.d.ts.map