import OpenAI from "openai";
import { nextApiKey, markKeyFailure } from "../types.js";
import { createLogger } from "../../logger/index.js";
import { OPENAI_CODEX_RESPONSES_PATH, OPENAI_CODEX_USER_AGENT, readOpenAICodexAccessToken, resolveOpenAICodexBaseUrl, } from "../../auth/openai-codex-oauth.js";
const log = createLogger("ai:openai");
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const TOKEN_ESTIMATE_DIVISOR = 4;
const TOKEN_SAFETY_HEADROOM = 1_024;
const CONTEXT_LIMITS = {
    "gpt-5": 400_000,
    "gpt-5.4": 400_000,
    "gpt-5.4-mini": 400_000,
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
function makeSchemaNullable(schema) {
    const next = { ...schema };
    if (Array.isArray(next.type)) {
        if (!next.type.includes("null"))
            next.type = [...next.type, "null"];
    }
    else if (typeof next.type === "string") {
        next.type = [next.type, "null"];
    }
    if (Array.isArray(next.enum) && !next.enum.includes(null)) {
        next.enum = [...next.enum, null];
    }
    return next;
}
function normalizeCodexSchema(schema) {
    const normalized = { ...schema };
    if (schema.type === "object" && schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
        const properties = Object.entries(schema.properties).reduce((acc, [key, value]) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                acc[key] = normalizeCodexSchema(value);
            }
            else {
                acc[key] = value;
            }
            return acc;
        }, {});
        const originalRequired = new Set(Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : []);
        for (const key of Object.keys(properties)) {
            if (!originalRequired.has(key)) {
                const value = properties[key];
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    properties[key] = makeSchemaNullable(value);
                }
            }
        }
        normalized.properties = properties;
        normalized.required = Object.keys(properties);
        normalized.additionalProperties = false;
        return normalized;
    }
    if (schema.type === "array" && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
        normalized.items = normalizeCodexSchema(schema.items);
        return normalized;
    }
    return normalized;
}
function stripNullishValues(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stripNullishValues(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== null && item !== undefined)
            .map(([key, item]) => [key, stripNullishValues(item)]));
    }
    return value;
}
function toCodexInput(messages) {
    const result = [];
    for (const msg of messages) {
        if (typeof msg.content === "string") {
            result.push({
                role: msg.role,
                content: [{
                        type: msg.role === "assistant" ? "output_text" : "input_text",
                        text: msg.content,
                    }],
            });
            continue;
        }
        const textParts = [];
        const toolBlocks = [];
        for (const block of msg.content) {
            if (block.type === "text") {
                textParts.push(block.text);
                continue;
            }
            if (block.type === "tool_use" && msg.role === "assistant") {
                toolBlocks.push({
                    type: "function_call",
                    call_id: block.id,
                    name: block.name,
                    arguments: JSON.stringify(block.input ?? {}),
                });
                continue;
            }
            if (block.type === "tool_result" && msg.role === "user") {
                toolBlocks.push({
                    type: "function_call_output",
                    call_id: block.tool_use_id,
                    output: block.content,
                });
            }
        }
        if (textParts.length > 0) {
            result.push({
                role: msg.role,
                content: [{
                        type: msg.role === "assistant" ? "output_text" : "input_text",
                        text: textParts.join("\n"),
                    }],
            });
        }
        result.push(...toolBlocks);
    }
    return result;
}
function toCodexTools(tools) {
    return tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: normalizeCodexSchema(tool.input_schema),
        strict: true,
    }));
}
function parseSseFrame(frame) {
    const lines = frame.split(/\r?\n/);
    let event;
    const dataLines = [];
    for (const line of lines) {
        if (line.startsWith("event:")) {
            event = line.slice("event:".length).trim();
            continue;
        }
        if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trim());
        }
    }
    if (dataLines.length === 0)
        return null;
    return event ? { event, data: dataLines.join("\n") } : { data: dataLines.join("\n") };
}
function renderFallbackMessageContent(message) {
    if (typeof message.content === "string") {
        return message.content.trim();
    }
    const parts = [];
    for (const block of message.content) {
        if (block.type === "text") {
            const text = block.text.trim();
            if (text)
                parts.push(text);
            continue;
        }
        if (block.type === "tool_use") {
            const input = JSON.stringify(block.input ?? {});
            parts.push('[tool request] ' + block.name + ' ' + input);
            continue;
        }
        if (block.type === "tool_result") {
            const content = block.content.trim();
            if (content)
                parts.push('[tool result] ' + content);
        }
    }
    return parts.join("\n").trim();
}
export function buildCodexOAuthFallbackPrompt(messages) {
    const relevantMessages = messages.slice(-8);
    const lines = [];
    for (const message of relevantMessages) {
        const content = renderFallbackMessageContent(message);
        if (!content)
            continue;
        const label = message.role === "assistant" ? "Assistant" : "User";
        lines.push(label + ': ' + content);
    }
    return lines.join("\n\n").trim() || "Continue the conversation.";
}
function isLikelyHtmlError(detail) {
    const normalized = detail.trim().toLowerCase();
    return normalized.startsWith("<!doctype html")
        || normalized.startsWith("<html")
        || normalized.includes("</html>")
        || normalized.includes("<body");
}
export function shouldRetryCodexOAuthWithSimplePayload(input) {
    const hasComplexPayload = input.hasTools
        || input.hasMaxOutputTokens
        || input.messageCount > 1
        || input.hasStructuredConversation;
    if (!hasComplexPayload)
        return false;
    if (input.status === 401 || input.status === 403)
        return true;
    if (input.status === 400 || input.status === 422)
        return true;
    return isLikelyHtmlError(input.detail);
}
// ─── Provider ────────────────────────────────────────────────────────────────
export class OpenAIProvider {
    profile;
    baseUrl;
    oauthConfig;
    id = "openai";
    supportedModels = Object.keys(CONTEXT_LIMITS);
    constructor(profile, baseUrl, oauthConfig) {
        this.profile = profile;
        this.baseUrl = baseUrl;
        this.oauthConfig = oauthConfig;
    }
    maxContextTokens(model) {
        return CONTEXT_LIMITS[model] ?? 128_000;
    }
    async *chatWithCodexOAuth(params) {
        const { accessToken } = await readOpenAICodexAccessToken(this.oauthConfig);
        const url = `${resolveOpenAICodexBaseUrl(this.baseUrl)}${OPENAI_CODEX_RESPONSES_PATH}`;
        const input = toCodexInput(params.messages);
        const tools = params.tools && params.tools.length > 0
            ? toCodexTools(params.tools)
            : undefined;
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": OPENAI_CODEX_USER_AGENT,
        };
        const baseBody = {
            model: params.model,
            instructions: params.system?.trim() || "You are Codex.",
            store: false,
            stream: true,
        };
        const primaryBody = {
            ...baseBody,
            input,
            ...(params.maxTokens !== undefined ? { max_output_tokens: params.maxTokens } : {}),
            ...(tools ? { tools, tool_choice: "auto" } : {}),
        };
        let response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(primaryBody),
            ...(params.signal ? { signal: params.signal } : {}),
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => "")).trim();
            const shouldRetry = shouldRetryCodexOAuthWithSimplePayload({
                status: response.status,
                detail,
                hasTools: Boolean(tools),
                hasMaxOutputTokens: params.maxTokens !== undefined,
                messageCount: params.messages.length,
                hasStructuredConversation: params.messages.some((message) => typeof message.content !== "string"),
            });
            if (!shouldRetry) {
                throw new Error(detail || `${response.status} ${response.statusText}`);
            }
            log.warn("chatgpt_oauth rich payload rejected; retrying with simplified prompt payload", {
                status: response.status,
                hasTools: Boolean(tools),
                hasMaxOutputTokens: params.maxTokens !== undefined,
                messageCount: params.messages.length,
            });
            const fallbackBody = {
                ...baseBody,
                input: [{
                        role: "user",
                        content: [{
                                type: "input_text",
                                text: buildCodexOAuthFallbackPrompt(params.messages),
                            }],
                    }],
            };
            response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(fallbackBody),
                ...(params.signal ? { signal: params.signal } : {}),
            });
            if (!response.ok) {
                const retryDetail = (await response.text().catch(() => "")).trim();
                throw new Error(retryDetail || detail || `${response.status} ${response.statusText}`);
            }
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("ChatGPT Codex 응답 스트림을 열지 못했습니다.");
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let inputTokens = 0;
        let outputTokens = 0;
        const functionCalls = new Map();
        const emitFrame = async (frame) => {
            const parsed = parseSseFrame(frame);
            if (!parsed?.data || parsed.data === "[DONE]")
                return [];
            const payload = JSON.parse(parsed.data);
            const type = typeof payload.type === "string" ? payload.type : parsed.event;
            if (!type)
                return [];
            switch (type) {
                case "response.output_text.delta": {
                    const delta = typeof payload.delta === "string" ? payload.delta : "";
                    return delta ? [{ type: "text_delta", delta }] : [];
                }
                case "response.output_item.added": {
                    const item = payload.item;
                    if (!item || item.type !== "function_call")
                        return [];
                    const itemId = typeof item.id === "string" ? item.id : "";
                    functionCalls.set(itemId, {
                        itemId,
                        callId: typeof item.call_id === "string" ? item.call_id : itemId,
                        name: typeof item.name === "string" ? item.name : "",
                        args: typeof item.arguments === "string" ? item.arguments : "",
                    });
                    return [];
                }
                case "response.function_call_arguments.delta": {
                    const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
                    const delta = typeof payload.delta === "string" ? payload.delta : "";
                    if (!itemId || !delta)
                        return [];
                    const current = functionCalls.get(itemId) ?? { itemId, callId: itemId, name: "", args: "" };
                    current.args += delta;
                    functionCalls.set(itemId, current);
                    return [];
                }
                case "response.output_item.done": {
                    const item = payload.item;
                    if (!item || item.type !== "function_call")
                        return [];
                    const itemId = typeof item.id === "string" ? item.id : "";
                    const current = functionCalls.get(itemId) ?? {
                        itemId,
                        callId: typeof item.call_id === "string" ? item.call_id : itemId,
                        name: typeof item.name === "string" ? item.name : "",
                        args: "",
                    };
                    if (typeof item.arguments === "string" && item.arguments.trim()) {
                        current.args = item.arguments;
                    }
                    if (typeof item.call_id === "string" && item.call_id.trim()) {
                        current.callId = item.call_id;
                    }
                    if (typeof item.name === "string" && item.name.trim()) {
                        current.name = item.name;
                    }
                    functionCalls.delete(itemId);
                    let parsedInput = {};
                    try {
                        parsedInput = stripNullishValues(current.args ? JSON.parse(current.args) : {});
                    }
                    catch {
                        parsedInput = {};
                    }
                    return [{
                            type: "tool_use",
                            id: current.callId || current.itemId,
                            name: current.name,
                            input: parsedInput,
                        }];
                }
                case "response.completed": {
                    const responseObject = payload.response;
                    const usage = responseObject?.usage;
                    inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : inputTokens;
                    outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : outputTokens;
                    return [];
                }
                case "response.failed":
                case "response.incomplete": {
                    const responseObject = payload.response;
                    const error = responseObject?.error;
                    const detail = typeof error?.message === "string"
                        ? error.message
                        : JSON.stringify(payload);
                    throw new Error(detail);
                }
                default:
                    return [];
            }
        };
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const chunks = await emitFrame(frame);
                for (const chunk of chunks)
                    yield chunk;
                boundary = buffer.indexOf("\n\n");
            }
        }
        if (buffer.trim()) {
            const chunks = await emitFrame(buffer);
            for (const chunk of chunks)
                yield chunk;
        }
        yield {
            type: "message_stop",
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
            },
        };
    }
    async *chat(params) {
        if (this.oauthConfig) {
            yield* this.chatWithCodexOAuth(params);
            return;
        }
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