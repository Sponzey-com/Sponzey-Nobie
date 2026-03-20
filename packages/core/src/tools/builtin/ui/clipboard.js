/**
 * Clipboard tools - platform-specific implementation.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function readClipboard() {
    const platform = process.platform;
    if (platform === "darwin") {
        const { stdout } = await execFileAsync("pbpaste");
        return stdout;
    }
    else if (platform === "linux") {
        try {
            const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-o"]);
            return stdout;
        }
        catch {
            const { stdout } = await execFileAsync("xsel", ["--clipboard", "--output"]);
            return stdout;
        }
    }
    else if (platform === "win32") {
        const { stdout } = await execFileAsync("powershell", ["-Command", "Get-Clipboard"]);
        return stdout.trimEnd();
    }
    throw new Error(`Unsupported platform: ${platform}`);
}
async function writeClipboard(text) {
    const platform = process.platform;
    if (platform === "darwin") {
        await new Promise((resolve, reject) => {
            const proc = execFile("pbcopy", (err) => { err ? reject(err) : resolve(); });
            proc.stdin.write(text);
            proc.stdin.end();
        });
    }
    else if (platform === "linux") {
        await new Promise((resolve, reject) => {
            const proc = execFile("xclip", ["-selection", "clipboard"], (err) => { err ? reject(err) : resolve(); });
            proc.stdin.write(text);
            proc.stdin.end();
        });
    }
    else if (platform === "win32") {
        await execFileAsync("powershell", ["-Command", `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`]);
    }
    else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
}
// ── clipboard_read ────────────────────────────────────────────────────────
export const clipboardReadTool = {
    name: "clipboard_read",
    description: "시스템 클립보드의 현재 내용을 읽습니다.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    riskLevel: "safe",
    requiresApproval: false,
    execute: async () => {
        try {
            const text = await readClipboard();
            if (!text.trim())
                return { success: true, output: "(클립보드가 비어 있습니다)" };
            return { success: true, output: text };
        }
        catch (err) {
            return { success: false, output: `클립보드 읽기 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
export const clipboardWriteTool = {
    name: "clipboard_write",
    description: "지정한 텍스트를 시스템 클립보드에 복사합니다.",
    parameters: {
        type: "object",
        properties: {
            text: { type: "string", description: "클립보드에 복사할 텍스트" },
        },
        required: ["text"],
    },
    riskLevel: "safe",
    requiresApproval: false,
    execute: async (params) => {
        try {
            await writeClipboard(params.text);
            return { success: true, output: `클립보드에 복사됨 (${params.text.length}자)` };
        }
        catch (err) {
            return { success: false, output: `클립보드 쓰기 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
//# sourceMappingURL=clipboard.js.map