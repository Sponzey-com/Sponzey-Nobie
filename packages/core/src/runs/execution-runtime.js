import { runAgent } from "../agent/index.js";
const defaultExecutionRuntimeDependencies = {
    runAgent,
};
export function createExecutionChunkStream(params, dependencies = defaultExecutionRuntimeDependencies) {
    return dependencies.runAgent({
        userMessage: params.userMessage,
        memorySearchQuery: params.memorySearchQuery,
        sessionId: params.sessionId,
        runId: params.runId,
        ...(params.model ? { model: params.model } : {}),
        ...(params.providerId ? { providerId: params.providerId } : {}),
        ...(params.provider ? { provider: params.provider } : {}),
        workDir: params.workDir,
        source: params.source,
        signal: params.signal,
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        ...(params.isRootRequest ? {} : { requestGroupId: params.requestGroupId }),
        contextMode: params.contextMode,
    });
}
//# sourceMappingURL=execution-runtime.js.map