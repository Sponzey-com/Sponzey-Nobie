import { type NobieConfig } from "./types.js";
/**
 * Load .env files. Priority:
 *  1. 쉘 환경변수 (비어있지 않은 값에 한해)
 *  2. cwd()/.env
 *  3. ~/.wizby/.env (legacy ~/.howie/.env fallback via PATHS)
 * .env에서 KEY= (빈 값)으로 설정하면 쉘 환경변수도 무효화됨
 */
export declare function loadEnv(): void;
export declare function loadConfig(): NobieConfig;
export declare function getConfig(): NobieConfig;
export declare function reloadConfig(): NobieConfig;
export { PATHS } from "./paths.js";
export type { NobieConfig, WizbyConfig, HowieConfig, SecurityConfig, TelegramConfig, MqttConfig, OrchestrationConfig, McpConfig, McpServerConfig } from "./types.js";
//# sourceMappingURL=index.d.ts.map