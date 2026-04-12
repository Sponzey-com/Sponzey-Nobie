import type { FastifyInstance } from "fastify";
export declare function startLocalRun(params: {
    message: string;
    sessionId: string | undefined;
    model: string | undefined;
    source: "webui" | "cli" | "telegram" | "slack";
}): Promise<{
    requestId: string;
    runId: string;
    sessionId: string;
    source: "webui" | "cli" | "telegram" | "slack";
    status: "started";
    receipt: string;
}>;
export declare function registerRunsRoute(app: FastifyInstance): void;
//# sourceMappingURL=runs.d.ts.map