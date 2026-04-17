import { type RuntimeManifest, type RuntimeManifestOptions } from "../runtime/manifest.js";
export type DoctorStatus = "ok" | "warning" | "blocked" | "unknown";
export type DoctorMode = "quick" | "full";
export type DoctorCheckName = "runtime.manifest" | "provider.chat" | "provider.resolver" | "provider.embedding" | "gateway.exposure" | "credential.redaction" | "channel.telegram" | "channel.slack" | "channel.webui" | "yeonjang.mqtt" | "yeonjang.protocol" | "db.migration" | "db.migration.lock" | "prompt.registry" | "memory.fts" | "memory.vector" | "queue.backpressure" | "extension.registry" | "feature.flags" | "rollout.evidence" | "plan.drift" | "artifact.storage" | "schedule.queue" | "release.package";
export interface DoctorCheckResult {
    name: DoctorCheckName;
    status: DoctorStatus;
    message: string;
    detail: Record<string, unknown>;
    guide: string | null;
}
export interface DoctorReport {
    kind: "nobie.doctor.report";
    version: 1;
    id: string;
    mode: DoctorMode;
    createdAt: string;
    overallStatus: DoctorStatus;
    runtimeManifestId: string;
    checks: DoctorCheckResult[];
    summary: {
        ok: number;
        warning: number;
        blocked: number;
        unknown: number;
    };
    manifest: RuntimeManifest;
}
export interface RunDoctorOptions extends RuntimeManifestOptions {
    mode?: DoctorMode;
}
export declare function runDoctor(options?: RunDoctorOptions): DoctorReport;
export declare function writeDoctorReportArtifact(report: DoctorReport): string;
export declare function lastDoctorReportExists(): boolean;
//# sourceMappingURL=doctor.d.ts.map