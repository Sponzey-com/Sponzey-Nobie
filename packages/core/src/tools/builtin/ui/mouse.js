/**
 * Mouse control tools. Uses @nut-tree/nut-js when available.
 * Dynamic import allows graceful failure if package not installed.
 */
const MOVE_DELAY_MS = 500;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNutMouse() {
    // Try both common package names
    for (const pkg of ["@nut-tree-fork/nut-js", "@nut-tree/nut-js"]) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const mod = await import(pkg);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return mod;
        }
        catch { /* try next */ }
    }
    throw new Error("@nut-tree/nut-js not installed. Run: pnpm add @nut-tree-fork/nut-js");
}
export const mouseMoveTool = {
    name: "mouse_move",
    description: "마우스 커서를 지정한 화면 좌표로 이동합니다.",
    parameters: {
        type: "object",
        properties: {
            x: { type: "number", description: "X 좌표 (픽셀)" },
            y: { type: "number", description: "Y 좌표 (픽셀)" },
        },
        required: ["x", "y"],
    },
    riskLevel: "moderate",
    requiresApproval: true,
    execute: async (params) => {
        await new Promise((r) => setTimeout(r, MOVE_DELAY_MS));
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const { mouse, Point } = await getNutMouse();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            await mouse.move([new Point(params.x, params.y)]);
            return { success: true, output: `마우스를 (${params.x}, ${params.y})로 이동했습니다.` };
        }
        catch (err) {
            return { success: false, output: `마우스 이동 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
export const mouseClickTool = {
    name: "mouse_click",
    description: "지정한 좌표에서 마우스 클릭을 수행합니다.",
    parameters: {
        type: "object",
        properties: {
            x: { type: "number", description: "X 좌표 (픽셀)" },
            y: { type: "number", description: "Y 좌표 (픽셀)" },
            button: {
                type: "string",
                enum: ["left", "right", "middle"],
                description: "클릭할 마우스 버튼 (기본: left)",
            },
            double: { type: "boolean", description: "더블 클릭 여부 (기본: false)" },
        },
        required: ["x", "y"],
    },
    riskLevel: "moderate",
    requiresApproval: true,
    execute: async (params) => {
        await new Promise((r) => setTimeout(r, MOVE_DELAY_MS));
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const { mouse, Point, Button } = await getNutMouse();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            await mouse.move([new Point(params.x, params.y)]);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const btn = params.button === "right" ? Button.RIGHT : params.button === "middle" ? Button.MIDDLE : Button.LEFT;
            if (params.double) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                await mouse.doubleClick(btn);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                await mouse.click(btn);
            }
            const action = params.double ? "더블 클릭" : "클릭";
            return { success: true, output: `(${params.x}, ${params.y}) ${action} 완료` };
        }
        catch (err) {
            return { success: false, output: `마우스 클릭 실패: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
//# sourceMappingURL=mouse.js.map