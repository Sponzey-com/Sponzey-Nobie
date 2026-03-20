import type { FastifyInstance } from "fastify";
export declare function startLocalRun(params: {
    message: string;
    sessionId: string | undefined;
    model: string | undefined;
    source: "webui" | "cli" | "telegram";
}): Promise<{
    runId: string;
    sessionId: string;
    status: "started";
}>;
export declare function registerRunsRoute(app: FastifyInstance): void;
//# sourceMappingURL=runs.d.ts.map