import OpenAI from "openai";
import { nextApiKey, markKeyFailure } from "../types.js";
import { createLogger } from "../../logger/index.js";
const log = createLogger("llm:openai");
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const TOKEN_ESTIMATE_DIVISOR = 4;
const TOKEN_SAFETY_HEADROOM = 1_024;
const CONTEXT_LIMITS = {
    "gpt-5": 400_000,
    "gpt-5.1": 400_000,
    "gpt-4.1": 1_047_576,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-4": 8_192,
    "gpt-3.5-turbo": 16_385,
    "o1": 200_000,
    "o1-mini": 128_000,
    "o3": 200_000,
    "o3-mini": 200_000,
};
// ─── Message format conversion ───────────────────────────────────────────────
function toOpenAIMessages(messages) {
    const result = [];
    for (const msg of messages) {
        if (typeof msg.content === "string") {
            result.push({ role: msg.role, content: msg.content });
            continue;
        }
        // Array content — split out tool_result into separate "tool" role messages
        const toolResults = [];
        const textParts = [];
        const toolCalls = [];
        for (const block of msg.content) {
            if (block.type === "text") {
                textParts.push(block.text);
            }
            else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    type: "function",
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    },
                });
            }
            else if (block.type === "tool_result") {
                toolResults.push({
                    role: "tool",
                    tool_call_id: block.tool_use_id,
                    content: block.content,
                });
            }
        }
        if (msg.role === "assistant") {
            const assistantMsg = {
                role: "assistant",
                ...(textParts.length > 0 ? { content: textParts.join("\n") } : { content: null }),
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            };
            result.push(assistantMsg);
        }
        else {
            // user role — push text first, then tool results
            if (textParts.length > 0) {
                result.push({ role: "user", content: textParts.join("\n") });
            }
            for (const tr of toolResults) {
                result.push(tr);
            }
        }
    }
    return result;
}
function toOpenAITools(tools) {
    return tools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
        },
    }));
}
function estimateTokens(value) {
    if (value == null)
        return 0;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return Math.ceil(serialized.length / TOKEN_ESTIMATE_DIVISOR);
}
export function resolveOpenAIChatMaxTokens(input) {
    const requested = input.maxTokens ?? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, input.contextLimit);
    const estimatedPromptTokens = estimateTokens(input.messages) + estimateTokens(input.tools ?? []);
    const remaining = input.contextLimit - estimatedPromptTokens - TOKEN_SAFETY_HEADROOM;
    return Math.max(1, Math.min(requested, remaining));
}
function modelUsesMaxCompletionTokens(model) {
    return /^(?:o\d|gpt-5)/i.test(model.trim());
}
function buildTokenLimitParams(model, maxTokens, forceLegacyMaxTokens = false) {
    if (!forceLegacyMaxTokens && modelUsesMaxCompletionTokens(model)) {
        return { max_completion_tokens: maxTokens };
    }
    return { max_tokens: maxTokens };
}
function shouldRetryWithSwappedTokenParam(error) {
    if (!(error instanceof Error))
        return false;
    const message = error.message.toLowerCase();
    return message.includes("unsupported parameter")
        && (message.includes("max_tokens") || message.includes("max_completion_tokens"));
}
function isOfficialOpenAIBaseUrl(baseUrl) {
    if (!baseUrl?.trim())
        return false;
    try {
        const normalized = new URL(baseUrl).hostname.toLowerCase();
        return normalized === "api.openai.com" || normalized.endsWith(".openai.com");
    }
    catch {
        return false;
    }
}
// ─── Provider ────────────────────────────────────────────────────────────────
export class OpenAIProvider {
    profile;
    baseUrl;
    id = "openai";
    supportedModels = Object.keys(CONTEXT_LIMITS);
    constructor(profile, baseUrl) {
        this.profile = profile;
        this.baseUrl = baseUrl;
    }
    maxContextTokens(model) {
        return CONTEXT_LIMITS[model] ?? 128_000;
    }
    async *chat(params) {
        const apiKey = nextApiKey(this.profile);
        if (!apiKey)
            throw new Error("No available OpenAI API keys (all on cooldown)");
        const client = new OpenAI({
            apiKey,
            ...(this.baseUrl != null ? { baseURL: this.baseUrl } : {}),
        });
        log.debug(`chat() model=${params.model} messages=${params.messages.length}`);
        const oaiMessages = toOpenAIMessages(params.messages);
        if (params.system) {
            oaiMessages.unshift({ role: "system", content: params.system });
        }
        const tools = params.tools && params.tools.length > 0
            ? toOpenAITools(params.tools)
            : undefined;
        const compatibilityBaseUrl = Boolean(this.baseUrl) && !isOfficialOpenAIBaseUrl(this.baseUrl);
        try {
            const maxTokens = resolveOpenAIChatMaxTokens({
                contextLimit: this.maxContextTokens(params.model),
                messages: oaiMessages,
                ...(tools ? { tools } : {}),
                ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
            });
            const createChatCompletionNonStream = async () => {
                const execute = async (forceLegacyMaxTokens) => client.chat.completions.create({
                    model: params.model,
                    messages: oaiMessages,
                    stream: false,
                    ...buildTokenLimitParams(params.model, maxTokens, forceLegacyMaxTokens),
                    ...(tools ? { tools, tool_choice: "auto" } : {}),
                }, { signal: params.signal });
                try {
                    return await execute(compatibilityBaseUrl);
                }
                catch (error) {
                    if (shouldRetryWithSwappedTokenParam(error)) {
                        log.info("retrying openai chat completion with swapped token limit parameter", {
                            model: params.model,
                            originalMessage: error.message,
                        });
                        return execute(!modelUsesMaxCompletionTokens(params.model));
                    }
                    throw error;
                }
            };
            const createChatCompletionStream = async () => {
                const execute = async (forceLegacyMaxTokens) => client.chat.completions.create({
                    model: params.model,
                    messages: oaiMessages,
                    stream: true,
                    ...buildTokenLimitParams(params.model, maxTokens, forceLegacyMaxTokens),
                    ...(tools ? { tools, tool_choice: "auto" } : {}),
                }, { signal: params.signal });
                try {
                    return await execute(compatibilityBaseUrl);
                }
                catch (error) {
                    if (shouldRetryWithSwappedTokenParam(error)) {
                        log.info("retrying openai chat completion stream with swapped token limit parameter", {
                            model: params.model,
                            originalMessage: error.message,
                        });
                        return execute(!modelUsesMaxCompletionTokens(params.model));
                    }
                    throw error;
                }
            };
            if (tools && compatibilityBaseUrl) {
                const completion = await createChatCompletionNonStream();
                const choice = completion.choices[0];
                if (choice?.message?.content) {
                    yield { type: "text_delta", delta: choice.message.content };
                }
                for (const toolCall of choice?.message?.tool_calls ?? []) {
                    if (!("function" in toolCall) || !toolCall.function)
                        continue;
                    let parsedInput = {};
                    try {
                        parsedInput = JSON.parse(toolCall.function.arguments || "{}");
                    }
                    catch {
                        parsedInput = {};
                    }
                    yield {
                        type: "tool_use",
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: parsedInput,
                    };
                }
                yield {
                    type: "message_stop",
                    usage: {
                        input_tokens: completion.usage?.prompt_tokens ?? 0,
                        output_tokens: completion.usage?.completion_tokens ?? 0,
                    },
                };
                return;
            }
            const stream = await createChatCompletionStream();
            // Accumulate streamed tool call chunks
            const toolCallBuffers = new Map();
            let inputTokens = 0;
            let outputTokens = 0;
            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice)
                    continue;
                const delta = choice.delta;
                // Text content
                if (delta.content) {
                    yield { type: "text_delta", delta: delta.content };
                }
                // Tool call chunks
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallBuffers.has(idx)) {
                            toolCallBuffers.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" });
                        }
                        const buf = toolCallBuffers.get(idx);
                        if (tc.id)
                            buf.id = tc.id;
                        if (tc.function?.name)
                            buf.name = tc.function.name;
                        if (tc.function?.arguments)
                            buf.args += tc.function.arguments;
                    }
                }
                // Usage (may appear in last chunk)
                if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens ?? 0;
                    outputTokens = chunk.usage.completion_tokens ?? 0;
                }
                if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
                    // Emit completed tool calls
                    for (const [, buf] of toolCallBuffers) {
                        let parsedInput = {};
                        try {
                            parsedInput = JSON.parse(buf.args);
                        }
                        catch { /* leave as {} */ }
                        yield { type: "tool_use", id: buf.id, name: buf.name, input: parsedInput };
                    }
                    toolCallBuffers.clear();
                    yield { type: "message_stop", usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
                }
            }
        }
        catch (err) {
            if (err instanceof OpenAI.AuthenticationError) {
                log.warn("API key authentication failed, marking for cooldown");
                markKeyFailure(this.profile, apiKey);
            }
            throw err;
        }
    }
}
//# sourceMappingURL=openai.js.map