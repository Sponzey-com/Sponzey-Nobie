import type { IMessageConfig } from "../../config/types.js";
import { type LocalBridgeConfig, type LocalBridgeDoctor, type LocalBridgeTransport } from "../local-bridge/adapter.js";
export declare function buildIMessageLocalBridgeConfig(config?: IMessageConfig | undefined): LocalBridgeConfig;
export declare function buildIMessageCapabilityManifest(config?: IMessageConfig | undefined): import("../contracts.js").ChannelCapabilities;
export declare function buildIMessageLocalBridgeDoctor(config?: IMessageConfig | undefined): LocalBridgeDoctor;
export declare function createIMessageChannelAdapter(options?: {
    config?: IMessageConfig | undefined;
    transport?: LocalBridgeTransport;
    now?: () => number;
}): import("../contracts.js").ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map