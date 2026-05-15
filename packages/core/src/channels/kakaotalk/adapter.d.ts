import { type ChannelCapabilities } from "../contracts.js";
import type { KakaoTalkConfig } from "../../config/types.js";
import { type LocalBridgeConfig, type LocalBridgeDoctor, type LocalBridgeTransport } from "../local-bridge/adapter.js";
export declare function buildKakaoTalkLocalBridgeConfig(config?: KakaoTalkConfig | undefined): LocalBridgeConfig;
export declare function buildKakaoTalkLocalBridgeCapabilityManifest(config?: KakaoTalkConfig | undefined): ChannelCapabilities;
export declare function buildKakaoTalkOfficialCapabilityManifest(): ChannelCapabilities;
export declare function buildKakaoTalkLocalBridgeDoctor(config?: KakaoTalkConfig | undefined): LocalBridgeDoctor;
export declare function buildKakaoTalkOfficialDoctor(config?: KakaoTalkConfig | undefined): {
    ok: boolean;
    issues: Array<{
        code: string;
        severity: "error" | "warning";
        message: string;
    }>;
    businessApiEnabled: boolean;
    channelIdConfigured: boolean;
};
export declare function createKakaoTalkLocalBridgeChannelAdapter(options?: {
    config?: KakaoTalkConfig | undefined;
    transport?: LocalBridgeTransport;
    now?: () => number;
}): import("../contracts.js").ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map