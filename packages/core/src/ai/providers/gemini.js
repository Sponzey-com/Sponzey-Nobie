import { randomUUID } from "node:crypto";
import { createLogger } from "../../logger/index.js";
import { markKeyFailure, nextApiKey } from "../types.js";
const log = createLogger("ai:gemini");
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const CONTEXT_LIMITS = {
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-flash": 1_048_576,
    "gemini-2.0-flash": 1_048_576,
    "gemini-1.5-pro": 2_000_000,
    "gemini-1.5-flash": 1_000_000,
};
function toGeminiTools(tools) {
    if (!tools || tools.length === 0)
        return undefined;
    return [{
            functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            })),
        }];
}
function toGeminiContents(messages) {
    const toolNames = new Map();
    const contents = [];
    for (const message of messages) {
        if (typeof message.content === "string") {
            const content = message.content.trim();
            if (!content)
                continue;
            contents.push({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: content }],
            });
            continue;
        }
        const parts = [];
        for (const block of message.content) {
            if (block.type === "text") {
                if (block.text.trim())
                    parts.push({ text: block.text });
                continue;
            }
            if (block.type === "tool_use") {
                toolNames.set(block.id, block.name);
                parts.push({ functionCall: { name: block.name, args: block.input ?? {} } });
                continue;
            }
            if (block.type === "tool_result") {
                parts.push({
                    functionResponse: {
                        name: toolNames.get(block.tool_use_id) ?? block.tool_use_id,
                        response: {
                            content: block.content,
                            ...(block.is_error ? { is_error: true } : {}),
                        },
                    },
                });
            }
        }
        if (parts.length === 0)
            continue;
        contents.push({
            role: message.role === "assistant" ? "model" : "user",
            parts,
        });
    }
    return contents;
}
function getErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== "object")
        return fallback;
    const root = payload;
    const error = root.error;
    if (!error || typeof error !== "object")
        return fallback;
    const message = error.message;
    return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
export class GeminiProvider {
    profile;
    baseUrl;
    id = "gemini";
    supportedModels = Object.keys(CONTEXT_LIMITS);
    constructor(profile, baseUrl) {
        this.profile = profile;
        this.baseUrl = baseUrl;
    }
    maxContextTokens(model) {
        return CONTEXT_LIMITS[model] ?? 1_048_576;
    }
    async *chat(params) {
        const apiKey = nextApiKey(this.profile);
        if (!apiKey) {
            throw new Error("No available Gemini API keys (all on cooldown)");
        }
        const baseUrl = (this.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
        const url = `${baseUrl}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`;
        const tools = toGeminiTools(params.tools);
        const body = {
            contents: toGeminiContents(params.messages),
            generationConfig: {
                ...(params.maxTokens !== undefined ? { maxOutputTokens: params.maxTokens } : {}),
            },
            ...(params.system?.trim() ? { system_instruction: { parts: [{ text: params.system }] } } : {}),
            ...(tools ? { tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
        };
        log.debug(`chat() model=${params.model} messages=${params.messages.length}`);
        try {
            const requestInit = {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                body: JSON.stringify(body),
                ...(params.signal ? { signal: params.signal } : {}),
            };
            const response = await fetch(url, requestInit);
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const message = getErrorMessage(payload, `Gemini API request failed (${response.status})`);
                if (response.status === 401 || response.status === 403) {
                    log.warn("Gemini API key authentication failed, marking for cooldown");
                    markKeyFailure(this.profile, apiKey);
                }
                throw new Error(message);
            }
            const candidates = payload && typeof payload === "object"
                ? payload.candidates
                : undefined;
            const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
            const content = candidate && typeof candidate === "object"
                ? candidate.content
                : undefined;
            const parts = content && typeof content === "object"
                ? content.parts ?? []
                : [];
            for (const part of parts) {
                const text = typeof part.text === "string" ? part.text : undefined;
                if (text) {
                    yield { type: "text_delta", delta: text };
                }
                const functionCall = part.functionCall;
                if (functionCall && typeof functionCall === "object") {
                    const call = functionCall;
                    const name = typeof call.name === "string" ? call.name : "unknown_tool";
                    yield {
                        type: "tool_use",
                        id: `gemini-tool-${randomUUID()}`,
                        name,
                        input: call.args ?? {},
                    };
                }
            }
            const usage = payload && typeof payload === "object"
                ? payload.usageMetadata
                : undefined;
            const usageObject = usage && typeof usage === "object" ? usage : {};
            yield {
                type: "message_stop",
                usage: {
                    input_tokens: typeof usageObject.promptTokenCount === "number" ? usageObject.promptTokenCount : 0,
                    output_tokens: typeof usageObject.candidatesTokenCount === "number" ? usageObject.candidatesTokenCount : 0,
                },
            };
        }
        catch (error) {
            if (error instanceof Error && /api key|permission|forbidden|unauthorized/i.test(error.message)) {
                markKeyFailure(this.profile, apiKey);
            }
            throw error;
        }
    }
}
//# sourceMappingURL=gemini.js.map