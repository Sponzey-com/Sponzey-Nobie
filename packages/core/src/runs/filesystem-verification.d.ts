export interface FilesystemVerificationResult {
    ok: boolean;
    summary: string;
    message: string;
    reason?: string;
    remainingItems?: string[];
}
export declare function buildFilesystemVerificationPrompt(originalRequest: string, mutationPaths: string[]): string;
export declare function verifyFilesystemTargets(params: {
    originalRequest: string;
    mutationPaths: string[];
    workDir: string;
}): FilesystemVerificationResult;
//# sourceMappingURL=filesystem-verification.d.ts.map