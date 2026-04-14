/**
 * Window management tools - platform-specific.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function listWindows() {
    const platform = process.platform;
    if (platform === "darwin") {
        const script = `
      tell application "System Events"
        set output to {}
        repeat with p in (processes whose background only is false)
          set pName to name of p
          repeat with w in windows of p
            set end of output to pName & "|" & (name of w)
          end repeat
        end repeat
        return output
      end tell
    `;
        const { stdout } = await execFileAsync("osascript", ["-e", script]);
        const lines = stdout.trim().split(", ").filter(Boolean);
        return lines.map((line, i) => {
            const sepIdx = line.indexOf("|");
            const app = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
            const title = sepIdx >= 0 ? line.slice(sepIdx + 1) : "";
            return { id: String(i), title, app };
        });
    }
    else if (platform === "linux") {
        const { stdout } = await execFileAsync("wmctrl", ["-l"]);
        return stdout.trim().split("\n").filter(Boolean).map((line) => {
            const parts = line.split(/\s+/);
            const id = parts[0] ?? "";
            const title = parts.slice(3).join(" ");
            return { id, title, app: title };
        });
    }
    else if (platform === "win32") {
        const { stdout } = await execFileAsync("powershell", [
            "-Command",
            `Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Id, MainWindowTitle, ProcessName | ConvertTo-Json`,
        ]);
        const procs = JSON.parse(stdout);
        return procs.map((p) => ({ id: String(p.Id), title: p.MainWindowTitle, app: p.ProcessName }));
    }
    return [];
}
function yeonjangRequiredFailure() {
    return {
        success: false,
        output: "이 작업은 Yeonjang 연장을 통해서만 실행할 수 있습니다. 창 포커스 제어는 현재 코어 로컬 경로에서 금지되어 있습니다.",
        error: "YEONJANG_REQUIRED",
        details: {
            requiredExecutor: "yeonjang",
        },
    };
}
// ── window_list ───────────────────────────────────────────────────────────
export const windowListTool = {
    name: "window_list",
    description: "현재 열려 있는 모든 창(윈도우) 목록을 가져옵니다.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    riskLevel: "safe",
    requiresApproval: false,
    execute: async () => {
        try {
            const windows = await listWindows();
            if (!windows.length)
                return { success: true, output: "열려 있는 창이 없습니다." };
            const text = windows
                .map((w, i) => `${i + 1}. [${w.app}] ${w.title}`)
                .join("\n");
            return { success: true, output: text };
        }
        catch (err) {
            return { success: false, output: `창 목록 조회 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
export const windowFocusTool = {
    name: "window_focus",
    description: "지정한 앱/창 이름을 포커스(앞으로 가져오기) 합니다.",
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "포커스할 앱 또는 창 이름 (부분 일치)" },
        },
        required: ["title"],
    },
    riskLevel: "moderate",
    requiresApproval: true,
    execute: async (params) => {
        void params;
        return yeonjangRequiredFailure();
    },
};
//# sourceMappingURL=window.js.map