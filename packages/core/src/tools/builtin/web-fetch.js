import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
const USER_AGENT = "Sponzey Nobie/0.1.0";
const BLOCKED_SCHEMES = ["file:", "data:", "javascript:"];
function isBlockedScheme(url) {
    return BLOCKED_SCHEMES.some((s) => url.toLowerCase().startsWith(s));
}
async function fetchHtml(url) {
    const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    return resp.text();
}
async function fetchWithPlaywright(url, waitForSelector) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => { });
        }
        return await page.content();
    }
    finally {
        await browser.close();
    }
}
async function screenshotWithPlaywright(url) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const buf = await page.screenshot({ fullPage: false, type: "png" });
        return buf.toString("base64");
    }
    finally {
        await browser.close();
    }
}
function extractText(html, url) {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.content) {
        const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        return `# ${article.title ?? "Page"}\n\n${td.turndown(article.content)}`;
    }
    // Fallback: strip all tags
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    return td.turndown(html);
}
export const webFetchTool = {
    name: "web_fetch",
    description: "URL의 웹 페이지 내용을 가져와 텍스트(마크다운)로 반환합니다. 뉴스, 문서, 공식 사이트 등 정보 수집에 사용하세요.",
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "가져올 URL" },
            mode: {
                type: "string",
                enum: ["text", "screenshot", "raw-html"],
                description: "반환 형식. 기본: text (마크다운 추출). screenshot: 이미지 base64. raw-html: 원본 HTML",
            },
            waitForSelector: {
                type: "string",
                description: "JS 렌더링 후 대기할 CSS 선택자 (지정 시 Playwright 사용)",
            },
            maxLength: {
                type: "number",
                description: "반환할 텍스트 최대 길이. 기본: 20000자",
            },
        },
        required: ["url"],
    },
    riskLevel: "safe",
    requiresApproval: false,
    async execute(params) {
        const { url, mode = "text", waitForSelector, maxLength = 20_000 } = params;
        if (isBlockedScheme(url)) {
            return { success: false, output: `차단된 URI 스킴입니다: ${url}` };
        }
        const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
        try {
            // Screenshot mode
            if (mode === "screenshot") {
                const b64 = await screenshotWithPlaywright(url);
                return {
                    success: true,
                    output: `[스크린샷 캡처 완료] base64 PNG (${Math.round(b64.length / 1024)}KB)\n[URL: ${url}]\n[캡처: ${now}]`,
                    details: { screenshot: b64 },
                };
            }
            // Fetch HTML — use Playwright if waitForSelector is specified
            let html;
            if (waitForSelector) {
                try {
                    html = await fetchWithPlaywright(url, waitForSelector);
                }
                catch {
                    html = await fetchHtml(url);
                }
            }
            else {
                html = await fetchHtml(url);
            }
            if (mode === "raw-html") {
                const truncated = html.length > maxLength;
                return {
                    success: true,
                    output: html.slice(0, maxLength) + (truncated ? `\n\n... (총 ${html.length}자 중 ${maxLength}자 반환)` : ""),
                };
            }
            // text mode — extract readable content
            let text = extractText(html, url);
            const truncated = text.length > maxLength;
            if (truncated) {
                text = text.slice(0, maxLength) + `\n\n... (총 ${text.length}자 중 앞 ${maxLength}자만 반환됨)`;
            }
            return {
                success: true,
                output: `${text}\n\n[출처: ${url}]\n[수집: ${now}]`,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `웹 페이지 가져오기 실패: ${msg}`, error: msg };
        }
    },
};
//# sourceMappingURL=web-fetch.js.map
