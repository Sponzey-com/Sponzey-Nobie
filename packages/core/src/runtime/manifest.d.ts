import { type ProviderCapabilityMatrix } from "../ai/capabilities.js";
import { type RolloutSafetySnapshot } from "./rollout-safety.js";
export interface RuntimeManifestEnvironment {
    node: string;
    pnpm: string | null;
    rustc: string | null;
    cargo: string | null;
    platform: NodeJS.Platform;
    arch: string;
}
export interface RuntimeManifestDatabase {
    path: string;
    exists: boolean;
    currentVersion: number;
    latestVersion: number;
    pendingVersions: number[];
    unknownAppliedVersions: number[];
    upToDate: boolean;
}
export interface RuntimeManifestPromptSources {
    workDir: string;
    count: number;
    checksum: string | null;
    requiredCount: number;
    enabledCount: number;
    localeParityOk: boolean;
    diagnostics: Array<{
        severity: "warning" | "error";
        code: string;
        message: string;
    }>;
}
export interface RuntimeManifestProviderProfile {
    profileId: string;
    runtimeProfileId: string;
    provider: string;
    model: string;
    endpointConfigured: boolean;
    authMode: string | null;
    credentialConfigured: boolean;
    chatConfigured: boolean;
    capabilityMatrix: ProviderCapabilityMatrix;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddingConfigured: boolean;
    resolverPath: string;
}
export interface RuntimeManifestChannelSummary {
    webui: {
        enabled: boolean;
        host: string;
        port: number;
        authEnabled: boolean;
    };
    telegram: {
        enabled: boolean;
        credentialConfigured: boolean;
        targetConfigured: boolean;
    };
    slack: {
        enabled: boolean;
        credentialConfigured: boolean;
        targetConfigured: boolean;
    };
    mqtt: {
        enabled: boolean;
        running: boolean;
        host: string;
        port: number;
        authEnabled: boolean;
        allowAnonymous: boolean;
        reason: string | null;
    };
}
export interface RuntimeManifestYeonjangNode {
    extensionId: string;
    state: string | null;
    version: string | null;
    protocolVersion: string | null;
    capabilityHash: string | null;
    methodCount: number;
    lastSeenAt: number;
}
export interface RuntimeManifestMemory {
    dbPath: string;
    dbExists: boolean;
    searchMode: string | null;
    ftsAvailable: boolean | null;
    vectorTableAvailable: boolean | null;
    embeddingRows: number | null;
    embeddingProvider: string | null;
    embeddingModel: string | null;
}
export interface RuntimeManifestReleasePackage {
    manifestId: string | null;
    releaseVersion: string | null;
    requiredMissingCount: number | null;
}
export interface RuntimeManifest {
    kind: "nobie.runtime.manifest";
    version: 1;
    id: string;
    createdAt: string;
    app: {
        appVersion: string;
        displayVersion: string;
        workspaceRoot: string;
        gitDescribe: string | null;
        gitCommit: string | null;
    };
    process: {
        pid: number;
        cwd: string;
        startedAt: string | null;
    };
    environment: RuntimeManifestEnvironment;
    database: RuntimeManifestDatabase;
    promptSources: RuntimeManifestPromptSources;
    provider: RuntimeManifestProviderProfile;
    channels: RuntimeManifestChannelSummary;
    yeonjang: {
        nodeCount: number;
        capabilityHash: string | null;
        nodes: RuntimeManifestYeonjangNode[];
    };
    memory: RuntimeManifestMemory;
    releasePackage: RuntimeManifestReleasePackage;
    rollout: RolloutSafetySnapshot;
    paths: {
        stateDir: string;
        configFile: string;
        dbFile: string;
        memoryDbFile: string;
    };
}
export interface RuntimeManifestOptions {
    now?: Date;
    includeEnvironment?: boolean;
    includeReleasePackage?: boolean;
}
export declare function buildRuntimeManifest(options?: RuntimeManifestOptions): RuntimeManifest;
export declare function getLastRuntimeManifest(): RuntimeManifest | null;
export declare function refreshRuntimeManifest(options?: RuntimeManifestOptions): RuntimeManifest;
//# sourceMappingURL=manifest.d.ts.map