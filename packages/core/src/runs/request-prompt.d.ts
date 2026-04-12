import type { TaskExecutionSemantics, TaskStructuredRequest } from "../agent/intake.js";
export declare function buildStructuredExecutionBrief(params: {
    header: string;
    introLines?: string[];
    originalRequest?: string;
    structuredRequest: TaskStructuredRequest;
    executionSemantics: TaskExecutionSemantics;
    extraSections?: string[];
    closingLines?: string[];
}): string;
//# sourceMappingURL=request-prompt.d.ts.map