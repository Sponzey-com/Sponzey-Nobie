import { type NobieConfig } from "../config/index.js";
export type SetupCapabilityStatus = "ready" | "disabled" | "planned" | "error";
export interface SetupMcpServerDraft {
    id: string;
    name: string;
    transport: "stdio" | "http";
    command: string;
    argsText: string;
    cwd: string;
    url: string;
    required: boolean;
    enabled: boolean;
    status: SetupCapabilityStatus;
    reason?: string;
    tools: string[];
}
export interface SetupSkillDraftItem {
    id: string;
    label: string;
    description: string;
    source: "local" | "builtin";
    path: string;
    enabled: boolean;
    required: boolean;
    status: SetupCapabilityStatus;
    reason?: string;
}
export declare function buildMcpSetupDraft(config?: NobieConfig): {
    servers: SetupMcpServerDraft[];
};
export declare function persistMcpSetupDraft(raw: Record<string, unknown>, draft: {
    servers: SetupMcpServerDraft[];
}): void;
export declare function testMcpServerConnection(server: SetupMcpServerDraft): Promise<{
    ok: boolean;
    message: string;
    tools: string[];
}>;
export declare function buildSkillsSetupDraft(config?: NobieConfig): {
    items: SetupSkillDraftItem[];
};
export declare function persistSkillsSetupDraft(raw: Record<string, unknown>, draft: {
    items: SetupSkillDraftItem[];
}): void;
export declare function testSkillPath(path: string): {
    ok: boolean;
    message: string;
    resolvedPath?: string;
};
export declare function cloneMcpDraft(value: {
    servers: SetupMcpServerDraft[];
}): {
    servers: SetupMcpServerDraft[];
};
export declare function cloneSkillsDraft(value: {
    items: SetupSkillDraftItem[];
}): {
    items: SetupSkillDraftItem[];
};
//# sourceMappingURL=setup-extensions.d.ts.map