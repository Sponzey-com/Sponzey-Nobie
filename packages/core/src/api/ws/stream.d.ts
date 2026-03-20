import type { FastifyInstance } from "fastify";
import type { ApprovalDecision } from "../../events/index.js";
export declare function registerApprovalFromWs(runId: string, resolve: (d: ApprovalDecision) => void): void;
export declare function registerWsRoute(app: FastifyInstance): void;
//# sourceMappingURL=stream.d.ts.map