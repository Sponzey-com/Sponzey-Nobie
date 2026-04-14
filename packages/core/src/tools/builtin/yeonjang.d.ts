import type { AgentTool } from "../types.js";
interface YeonjangCameraListParams {
    extensionId?: string;
    timeoutSec?: number;
}
interface YeonjangCameraCaptureParams {
    extensionId?: string;
    deviceId?: string;
    outputPath?: string;
    inlineBase64?: boolean;
    timeoutSec?: number;
}
export declare const yeonjangCameraListTool: AgentTool<YeonjangCameraListParams>;
export declare const yeonjangCameraCaptureTool: AgentTool<YeonjangCameraCaptureParams>;
export {};
//# sourceMappingURL=yeonjang.d.ts.map