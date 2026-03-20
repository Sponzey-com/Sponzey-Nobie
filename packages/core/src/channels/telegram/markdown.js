const MARKDOWN_V2_ESCAPE_REGEX = /[_*[\]()~`>#+=|{}.!\\-]/g;
export function escapeMarkdownV2(text) {
    return text.replace(MARKDOWN_V2_ESCAPE_REGEX, (char) => `\\${char}`);
}
export function splitMessage(text, maxLen = 4096) {
    if (text.length <= maxLen) {
        return [text];
    }
    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            parts.push(remaining);
            break;
        }
        let splitAt = maxLen;
        const newlineIdx = remaining.lastIndexOf("\n", maxLen - 1);
        if (newlineIdx > 0) {
            splitAt = newlineIdx + 1;
        }
        parts.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
    }
    return parts;
}
//# sourceMappingURL=markdown.js.map