import type { NodeDefinitionSuggestionRequest, NodeDefinitionSuggestionWarning } from "./node-definition-suggestion.js";
export type NodeDefinitionRedactionMode = "workspace_default" | "strict" | "disabled_for_local_model";
export interface NodeDefinitionRedactionReport {
    mode: NodeDefinitionRedactionMode;
    redactedFields: string[];
    reasonCodes: string[];
    warnings: NodeDefinitionSuggestionWarning[];
}
export interface NodeDefinitionRedactionResult {
    request: NodeDefinitionSuggestionRequest;
    report: NodeDefinitionRedactionReport;
}
export declare function redactNodeDefinitionSuggestionRequest(input: {
    request: NodeDefinitionSuggestionRequest;
    mode?: NodeDefinitionRedactionMode;
    isLocalModel?: boolean;
    workspaceStrict?: boolean;
}): NodeDefinitionRedactionResult;
export declare function redactNodeDefinitionText(value: string): {
    value: string;
    reasonCodes: string[];
};
//# sourceMappingURL=node-definition-redaction.d.ts.map