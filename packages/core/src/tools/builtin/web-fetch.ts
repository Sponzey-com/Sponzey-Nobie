import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import {
  buildWebRetrievalPolicyDecision,
  evaluateSourceReliabilityGuard,
  extractSourceTimestampFromHtml,
  recordBrowserSearchEvidence,
  type BrowserSearchEvidenceArtifact,
  type SourceEvidence,
} from "../../runs/web-retrieval-policy.js"
import { sanitizeUserFacingError } from "../../runs/error-sanitizer.js"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"

const USER_AGENT = "Sponzey Nobie/0.1.0"
const BLOCKED_SCHEMES = ["file:", "data:", "javascript:"]

interface WebFetchParams {
  url: string
  mode?: "text" | "screenshot" | "raw-html"
  waitForSelector?: string
  maxLength?: number
  freshnessPolicy?: "normal" | "latest_approximate" | "strict_timestamp"
}

function isBlockedScheme(url: string): boolean {
  return BLOCKED_SCHEMES.some((s) => url.toLowerCase().startsWith(s))
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
  return resp.text()
}

async function fetchWithPlaywright(url: string, waitForSelector?: string): Promise<string> {
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT })
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => {})
    }
    return await page.content()
  } finally {
    await browser.close()
  }
}

async function screenshotWithPlaywright(url: string): Promise<string> {
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT })
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
    const buf = await page.screenshot({ fullPage: false, type: "png" })
    return buf.toString("base64")
  } finally {
    await browser.close()
  }
}

function extractText(html: string, url: string): string {
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (article?.content) {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
    return `# ${article.title ?? "Page"}\n\n${td.turndown(article.content)}`
  }

  // Fallback: strip all tags
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
  return td.turndown(html)
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function buildSourceEvidence(input: {
  url: string
  sourceTimestamp: string | null
  policy: ReturnType<typeof buildWebRetrievalPolicyDecision>
}): SourceEvidence {
  return {
    method: input.policy?.method ?? "direct_fetch",
    sourceKind: input.policy?.sourceKind ?? "third_party",
    reliability: input.policy?.reliability ?? "medium",
    sourceUrl: input.url,
    sourceDomain: domainFromUrl(input.url),
    sourceTimestamp: input.sourceTimestamp,
    fetchTimestamp: input.policy?.fetchTimestamp ?? new Date().toISOString(),
    freshnessPolicy: input.policy?.freshnessPolicy ?? "normal",
  }
}

function buildPolicyFooter(input: {
  url: string
  sourceTimestamp: string | null
  policy: ReturnType<typeof buildWebRetrievalPolicyDecision>
  guard: ReturnType<typeof evaluateSourceReliabilityGuard>
}): string {
  const lines = [
    `[출처: ${input.url}]`,
    `[수집: ${input.policy?.fetchTimestamp ?? new Date().toISOString()}]`,
    `[출처 시각: ${input.sourceTimestamp ?? "확인 불가"}]`,
    `[수집 방식: ${input.policy?.method ?? "direct_fetch"}]`,
    `[최신성 정책: ${input.policy?.freshnessPolicy ?? "normal"}]`,
    `[출처 성격: ${input.policy?.sourceKind ?? "third_party"}/${input.policy?.reliability ?? "medium"}]`,
  ]
  if (input.policy) lines.push(`[응답 지침: ${input.policy.answerDirective}]`)
  if (input.guard.status !== "ready") lines.push(`[확정성: ${input.guard.status} - ${input.guard.userMessage}]`)
  return lines.join("\n")
}

export const webFetchTool: AgentTool<WebFetchParams> = {
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
      freshnessPolicy: {
        type: "string",
        enum: ["normal", "latest_approximate", "strict_timestamp"],
        description: "출처 기준 시각 처리 정책. 기본: 소스 계약 기반 자동 결정. latest_approximate: 수집 시각 기준 근사값 허용. strict_timestamp: 기준 시각 없으면 수치 확정 금지.",
      },
    },
    required: ["url"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params: WebFetchParams, ctx: ToolContext): Promise<ToolResult> {
    const { url, mode = "text", waitForSelector, maxLength = 20_000 } = params
    const webRetrievalPolicy = buildWebRetrievalPolicyDecision({
      toolName: "web_fetch",
      params: params as unknown as Record<string, unknown>,
      userMessage: ctx.userMessage,
    })

    if (isBlockedScheme(url)) {
      return { success: false, output: `차단된 URI 스킴입니다: ${url}` }
    }

    try {
      // Screenshot mode
      if (mode === "screenshot") {
        let b64: string
        try {
          b64 = await screenshotWithPlaywright(url)
        } catch (error) {
          const browserEvidence = recordBrowserSearchEvidence({
            query: url,
            url,
            timeoutReason: "playwright_screenshot_failed",
            error,
            runId: ctx.runId,
            requestGroupId: ctx.requestGroupId ?? null,
          })
          const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error))
          return {
            success: false,
            output: `웹 페이지 스크린샷 실패: ${sanitized.userMessage}`,
            error: sanitized.userMessage,
            details: { browserEvidence, ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}) },
          }
        }
        const sourceEvidence = buildSourceEvidence({ url, sourceTimestamp: null, policy: webRetrievalPolicy })
        const sourceGuard = evaluateSourceReliabilityGuard(sourceEvidence)
        return {
          success: true,
          output: `[스크린샷 캡처 완료] base64 PNG (${Math.round(b64.length / 1024)}KB)\n${buildPolicyFooter({ url, sourceTimestamp: null, policy: webRetrievalPolicy, guard: sourceGuard })}`,
          details: { screenshot: b64, sourceEvidence, sourceGuard, ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}) },
        }
      }

      // Fetch HTML — use Playwright if waitForSelector is specified
      let html: string
      let browserEvidence: BrowserSearchEvidenceArtifact | null = null
      if (waitForSelector) {
        try {
          html = await fetchWithPlaywright(url, waitForSelector)
        } catch (error) {
          browserEvidence = recordBrowserSearchEvidence({
            query: url,
            url,
            timeoutReason: "playwright_fetch_failed_fallback_to_direct_fetch",
            error,
            runId: ctx.runId,
            requestGroupId: ctx.requestGroupId ?? null,
          })
          html = await fetchHtml(url)
        }
      } else {
        html = await fetchHtml(url)
      }

      const sourceTimestamp = extractSourceTimestampFromHtml(html)
      const sourceEvidence = buildSourceEvidence({ url, sourceTimestamp, policy: webRetrievalPolicy })
      const sourceGuard = evaluateSourceReliabilityGuard(sourceEvidence)

      if (mode === "raw-html") {
        const truncated = html.length > maxLength
        return {
          success: true,
          output: html.slice(0, maxLength) + (truncated ? `\n\n... (총 ${html.length}자 중 ${maxLength}자 반환)` : ""),
          details: { sourceEvidence, sourceGuard, browserEvidence, ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}) },
        }
      }

      // text mode — extract readable content
      let text = extractText(html, url)
      const truncated = text.length > maxLength
      if (truncated) {
        text = text.slice(0, maxLength) + `\n\n... (총 ${text.length}자 중 앞 ${maxLength}자만 반환됨)`
      }

      return {
        success: true,
        output: `${text}\n\n${buildPolicyFooter({ url, sourceTimestamp, policy: webRetrievalPolicy, guard: sourceGuard })}`,
        details: { sourceEvidence, sourceGuard, browserEvidence, ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}) },
      }
    } catch (err) {
      const msg = sanitizeUserFacingError(err instanceof Error ? err.message : String(err)).userMessage
      return { success: false, output: `웹 페이지 가져오기 실패: ${msg}`, error: msg }
    }
  },
}
