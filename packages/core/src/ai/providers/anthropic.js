import Anthropic from "@anthropic-ai/sdk";
import { nextApiKey, markKeyFailure } from "../types.js";
import { createLogger } from "../../logger/index.js";
const log = createLogger("ai:anthropic");
const CONTEXT_LIMITS = {
    "claude-opus-4-5": 200_000,
    "claude-sonnet-4-5": 200_000,
    "claude-haiku-4-5": 200_000,
    "claude-3-5-sonnet-20241022": 200_000,
    "claude-3-5-haiku-20241022": 200_000,
    "claude-3-opus-20240229": 200_000,
};
export class AnthropicProvider {
    profile;
    id = "anthropic";
    supportedModels = Object.keys(CONTEXT_LIMITS);
    constructor(profile) {
        this.profile = profile;
    }
    maxContextTokens(model) {
        return CONTEXT_LIMITS[model] ?? 200_000;
    }
    async *chat(params) {
        const apiKey = nextApiKey(this.profile);
        if (!apiKey) {
            throw new Error("No available Anthropic API keys (all on cooldown)");
        }
        const client = new Anthropic({ apiKey });
        const tools = params.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
        }));
        log.debug(`chat() model=${params.model} messages=${params.messages.length}`);
        const streamEvents = [];
        try {
            const createParams = {
                model: params.model,
                max_tokens: params.maxTokens ?? 8192,
                messages: params.messages,
                stream: true,
                ...(params.system != null ? { system: params.system } : {}),
                ...(tools && tools.length > 0 ? { tools: tools } : {}),
            };
            const response = await client.messages.create(createParams, { signal: params.signal });
            // First pass: collect events and stream text deltas
            for await (const event of response) {
                streamEvents.push(event);
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                    yield { type: "text_delta", delta: event.delta.text };
                }
            }
            // Second pass: reconstruct full tool_use blocks
            let toolInput = "";
            let currentTool = null;
            let inputTokens = 0;
            for (const event of streamEvents) {
                if (event.type === "message_start") {
                    inputTokens = event.message.usage.input_tokens;
                }
                else if (event.type === "content_block_start") {
                    if (event.content_block.type === "tool_use") {
                        currentTool = { id: event.content_block.id, name: event.content_block.name };
                        toolInput = "";
                    }
                }
                else if (event.type === "content_block_delta") {
                    if (event.delta.type === "input_json_delta") {
                        toolInput += event.delta.partial_json;
                    }
                }
                else if (event.type === "content_block_stop") {
                    if (currentTool) {
                        let parsedInput = {};
                        try {
                            parsedInput = JSON.parse(toolInput);
                        }
                        catch { /* leave as {} */ }
                        yield { type: "tool_use", id: currentTool.id, name: currentTool.name, input: parsedInput };
                        currentTool = null;
                        toolInput = "";
                    }
                }
                else if (event.type === "message_stop") {
                    // Find last message_delta for usage stats
                    let usageEvent;
                    for (let i = streamEvents.length - 1; i >= 0; i--) {
                        const e = streamEvents[i];
                        if (e?.type === "message_delta") {
                            usageEvent = e;
                            break;
                        }
                    }
                    yield {
                        type: "message_stop",
                        usage: {
                            input_tokens: inputTokens,
                            output_tokens: usageEvent?.usage?.output_tokens ?? 0,
                        },
                    };
                }
            }
        }
        catch (err) {
            if (err instanceof Anthropic.AuthenticationError) {
                log.warn("API key authentication failed, marking for cooldown");
                markKeyFailure(this.profile, apiKey);
            }
            throw err;
        }
    }
}
//# sourceMappingURL=anthropic.js.map