export declare const TRUST_TAGS: readonly ["trusted", "user_input", "channel_input", "web_content", "file_content", "tool_result", "mcp_result", "capability_result", "yeonjang_result", "diagnostic"];
export type TrustTag = typeof TRUST_TAGS[number];
export interface TrustedContextBlock {
    id: string;
    tag: TrustTag;
    title: string;
    content: string;
    priority: "system" | "policy" | "context" | "evidence";
    sourceRef?: string;
}
export declare function isUntrustedTag(tag: TrustTag): boolean;
export declare function sourceToTrustTag(source: "webui" | "cli" | "telegram" | "slack"): TrustTag;
export declare function createContextBlock(params: {
    id: string;
    tag: TrustTag;
    title: string;
    content: string;
    priority?: TrustedContextBlock["priority"];
    sourceRef?: string;
}): TrustedContextBlock;
export declare function containsPromptInjectionDirective(content: string): boolean;
export declare function renderContextBlockForPrompt(block: TrustedContextBlock): string;
export declare function validatePromptAssemblyBlocks(blocks: TrustedContextBlock[]): {
    ok: boolean;
    violations: string[];
};
export declare function shouldBlockUntrustedMemoryWriteback(block: TrustedContextBlock): boolean;
//# sourceMappingURL=trust-boundary.d.ts.map