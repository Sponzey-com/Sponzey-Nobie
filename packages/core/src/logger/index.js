const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
    debug: "\x1b[90m", // gray
    info: "\x1b[36m", // cyan
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
function getMinLevel() {
    const env = process.env["NOBIE_LOG_LEVEL"];
    if (env && env in LEVELS)
        return env;
    return "info";
}
function shouldColor() {
    return process.env["NOBIE_NO_COLOR"] == null && process.stdout.isTTY === true;
}
function serializeArg(value) {
    if (value instanceof Error) {
        return JSON.stringify({
            name: value.name,
            message: value.message,
            ...(value.stack ? { stack: value.stack } : {}),
        });
    }
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function format(level, namespace, message, ...args) {
    const ts = new Date().toISOString().slice(11, 23);
    const color = shouldColor();
    const extra = args.length > 0 ? " " + args.map((arg) => serializeArg(arg)).join(" ") : "";
    if (color) {
        return `${DIM}${ts}${RESET} ${COLORS[level]}${level.padEnd(5)}${RESET} ${DIM}[${namespace}]${RESET} ${message}${extra}`;
    }
    return `${ts} ${level.padEnd(5)} [${namespace}] ${message}${extra}`;
}
export function createLogger(namespace) {
    const minLevel = LEVELS[getMinLevel()];
    function log(level, message, ...args) {
        if (LEVELS[level] < minLevel)
            return;
        const line = format(level, namespace, message, ...args);
        if (level === "error") {
            process.stderr.write(line + "\n");
        }
        else {
            process.stdout.write(line + "\n");
        }
    }
    return {
        debug: (msg, ...args) => log("debug", msg, ...args),
        info: (msg, ...args) => log("info", msg, ...args),
        warn: (msg, ...args) => log("warn", msg, ...args),
        error: (msg, ...args) => log("error", msg, ...args),
        child: (sub) => createLogger(`${namespace}:${sub}`),
    };
}
export const logger = createLogger("nobie");
//# sourceMappingURL=index.js.map