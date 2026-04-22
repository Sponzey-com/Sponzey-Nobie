import type { AgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration.js";
export declare function buildUserProfilePromptContext(): string;
export declare function buildAgentProfilePromptContext(input: {
    agent: AgentConfig;
    teams?: TeamConfig[];
}): string;
//# sourceMappingURL=profile-context.d.ts.map