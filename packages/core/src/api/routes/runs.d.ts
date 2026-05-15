import type { FastifyInstance } from "fastify";
import type { ChannelSource } from "../../channels/contracts.js";
import { type FocusResolveSuccess } from "../../orchestration/command-workspace.js";
export declare function startLocalRun(params: {
    message: string;
    sessionId: string | undefined;
    model: string | undefined;
    source: ChannelSource;
    focusResolution?: FocusResolveSuccess | undefined;
}): Promise<{
    focus?: {
        binding: import("../../orchestration/command-workspace.js").FocusBinding;
        plannerTarget: {
            kind: "explicit_agent" | "explicit_team";
            id: string;
            sourceTarget: import("../../orchestration/command-workspace.js").FocusTarget;
        };
        enforcement: {
            directChildVisibility: "checked";
            permissionVisibility: "checked";
            finalAnswerOwnerUnchanged: true;
            memoryIsolationUnchanged: true;
            reasonCodes: string[];
        };
    };
    requestId: string;
    runId: string;
    sessionId: string;
    source: ChannelSource;
    status: "started";
    receipt: string;
}>;
export declare function registerRunsRoute(app: FastifyInstance): void;
//# sourceMappingURL=runs.d.ts.map