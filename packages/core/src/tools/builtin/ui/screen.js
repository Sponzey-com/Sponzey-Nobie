/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
const execFileAsync = promisify(execFile);
async function captureScreenToBase64() {
    const tmpPath = join(tmpdir(), `nobie-screen-${Date.now()}.png`);
    const platform = process.platform;
    if (platform === "darwin") {
        await execFileAsync("screencapture", ["-x", tmpPath]);
    }
    else if (platform === "linux") {
        await execFileAsync("import", ["-window", "root", tmpPath]);
    }
    else if (platform === "win32") {
        await execFileAsync("powershell", [
            "-Command",
            `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([System.Drawing.Point]::Empty, [System.Drawing.Point]::Empty, $bmp.Size); $bmp.Save('${tmpPath}')`,
        ]);
    }
    else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const data = readFileSync(tmpPath);
    try {
        unlinkSync(tmpPath);
    }
    catch { /* ignore */ }
    return data.toString("base64");
}
export const screenCaptureTool = {
    name: "screen_capture",
    description: "현재 화면을 캡처하여 base64 PNG 이미지로 반환합니다. 화면 내용을 분석할 때 사용하세요.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    riskLevel: "safe",
    requiresApproval: false,
    execute: async () => {
        try {
            const base64 = await captureScreenToBase64();
            return {
                success: true,
                output: `[스크린샷 캡처 완료 — base64 PNG, ${Math.round(base64.length / 1024)}KB]\ndata:image/png;base64,${base64.slice(0, 100)}…`,
                details: { base64, mimeType: "image/png" },
            };
        }
        catch (err) {
            return { success: false, output: `화면 캡처 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
export const screenFindTextTool = {
    name: "screen_find_text",
    description: "현재 화면에서 특정 텍스트의 위치를 찾습니다. OCR을 사용합니다 (tesseract 필요).",
    parameters: {
        type: "object",
        properties: {
            text: { type: "string", description: "찾을 텍스트" },
        },
        required: ["text"],
    },
    riskLevel: "safe",
    requiresApproval: false,
    execute: async (params) => {
        try {
            const tmpPng = join(tmpdir(), `nobie-screen-ocr-${Date.now()}.png`);
            const tmpTxt = join(tmpdir(), `nobie-ocr-${Date.now()}`);
            const base64 = await captureScreenToBase64();
            writeFileSync(tmpPng, Buffer.from(base64, "base64"));
            await execFileAsync("tesseract", [tmpPng, tmpTxt, "-l", "eng+kor"]);
            const ocrText = readFileSync(`${tmpTxt}.txt`, "utf8");
            try {
                unlinkSync(tmpPng);
            }
            catch { /* ignore */ }
            try {
                unlinkSync(`${tmpTxt}.txt`);
            }
            catch { /* ignore */ }
            const found = ocrText.toLowerCase().includes(params.text.toLowerCase());
            return {
                success: true,
                output: found
                    ? `"${params.text}" 텍스트를 화면에서 찾았습니다.`
                    : `"${params.text}" 텍스트를 화면에서 찾을 수 없습니다.`,
            };
        }
        catch (err) {
            return { success: false, output: `텍스트 검색 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
//# sourceMappingURL=screen.js.map