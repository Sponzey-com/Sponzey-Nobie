import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
function getDefaultStateDir() {
    const nobieDir = join(homedir(), ".nobie");
    const wizbyDir = join(homedir(), ".wizby");
    const howieDir = join(homedir(), ".howie");
    const legacyDir = join(homedir(), ".nobie");
    if (existsSync(nobieDir))
        return nobieDir;
    if (existsSync(wizbyDir))
        return wizbyDir;
    if (existsSync(howieDir))
        return howieDir;
    if (existsSync(legacyDir))
        return legacyDir;
    return nobieDir;
}
function getStateDir() {
    if (process.env["NOBIE_STATE_DIR"]) {
        return process.env["NOBIE_STATE_DIR"];
    }
    if (process.env["WIZBY_STATE_DIR"]) {
        return process.env["WIZBY_STATE_DIR"];
    }
    if (process.env["HOWIE_STATE_DIR"]) {
        return process.env["HOWIE_STATE_DIR"];
    }
    if (process.env["NOBIE_STATE_DIR"]) {
        return process.env["NOBIE_STATE_DIR"];
    }
    return getDefaultStateDir();
}
export const PATHS = {
    get stateDir() {
        return getStateDir();
    },
    get configFile() {
        return process.env["NOBIE_CONFIG"] ?? process.env["WIZBY_CONFIG"] ?? process.env["HOWIE_CONFIG"] ?? process.env["NOBIE_CONFIG"] ?? join(getStateDir(), "config.json5");
    },
    get dbFile() {
        return join(getStateDir(), "data.db");
    },
    get setupStateFile() {
        return join(getStateDir(), "setup-state.json");
    },
    get lockFile() {
        return join(getStateDir(), "nobie.lock");
    },
    get logsDir() {
        return join(getStateDir(), "logs");
    },
    get sessionsDir() {
        return join(getStateDir(), "sessions");
    },
    get pluginsDir() {
        return join(getStateDir(), "plugins");
    },
};
//# sourceMappingURL=paths.js.map