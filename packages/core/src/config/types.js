import { homedir } from "node:os";
export const DEFAULT_CONFIG = {
    profile: {
        profileName: "",
        displayName: "",
        language: "ko",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        workspace: homedir(),
    },
    ai: {
        connection: {
            provider: "",
            model: "",
        },
    },
    security: {
        allowedPaths: [],
        approvalMode: "on-miss",
        approvalTimeout: 60,
        approvalTimeoutFallback: "deny",
        allowedCommands: [],
    },
    webui: {
        enabled: true,
        port: 18888,
        host: "127.0.0.1",
        auth: {
            enabled: false,
        },
    },
    scheduler: {
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    mqtt: {
        enabled: false,
        host: "0.0.0.0",
        port: 1883,
        username: "",
        password: "",
        allowAnonymous: false,
    },
    search: {
        web: {
            provider: "duckduckgo",
            maxResults: 5,
        },
    },
    memory: {
        sessionRetentionDays: 30,
    },
    orchestration: {
        maxDelegationTurns: 5,
    },
    mcp: {
        servers: {},
    },
    skills: {
        items: [],
    },
};
//# sourceMappingURL=types.js.map
