import type { AgentTool, ToolContext, ToolResult } from "../types.js"
import { storeMemory, searchMemory } from "../../memory/store.js"
import { fileIndexer } from "../../memory/file-indexer.js"

// ── memory_store ─────────────────────────────────────────────────────────

interface MemoryStoreParams {
  content: string
  tags?: string[]
  importance?: "low" | "medium" | "high"
}

export const memoryStoreTool: AgentTool<MemoryStoreParams> = {
  name: "memory_store",
  description: "중요한 정보를 장기 메모리에 저장합니다. 사용자가 기억해달라고 요청하거나 나중에 유용할 정보를 발견했을 때 사용하세요.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "기억할 내용 (구체적이고 명확하게)" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "분류 태그 (예: [\"사용자\", \"선호\", \"프로젝트\"])",
      },
      importance: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "중요도 (기본: medium)",
      },
    },
    required: ["content"],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params: MemoryStoreParams, ctx: ToolContext): Promise<ToolResult> => {
    const id = await storeMemory({
      content: params.content,
      ...(params.tags !== undefined && { tags: params.tags }),
      importance: params.importance ?? "medium",
      scope: "global",
      type: "user_fact",
    })
    return { success: true, output: `메모리에 저장됨 (id: ${id.slice(0, 8)}…)` }
  },
}

// ── memory_search ─────────────────────────────────────────────────────────

interface MemorySearchParams {
  query: string
  limit?: number
}

export const memorySearchTool: AgentTool<MemorySearchParams> = {
  name: "memory_search",
  description: "장기 메모리에서 관련 내용을 검색합니다. 사용자가 이전에 말한 내용이나 저장된 사실이 필요할 때 사용하세요.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색어 (자연어 또는 키워드)" },
      limit: { type: "number", description: "최대 결과 수 (기본: 5, 최대: 20)" },
    },
    required: ["query"],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params: MemorySearchParams, ctx: ToolContext): Promise<ToolResult> => {
    const limit = Math.min(params.limit ?? 5, 20)
    const results = await searchMemory(params.query, limit, {
      sessionId: ctx.sessionId,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      ...(ctx.requestGroupId ? { requestGroupId: ctx.requestGroupId } : {}),
    })
    if (results.length === 0) {
      return { success: true, output: "관련 메모리를 찾을 수 없습니다." }
    }
    const text = results
      .map((r, i) => {
        const date = new Date(r.created_at).toLocaleDateString("ko-KR")
        const tags = r.tags ? (JSON.parse(r.tags) as string[]).join(", ") : ""
        return `${i + 1}. [${date}${tags ? ` | ${tags}` : ""}] ${r.content}`
      })
      .join("\n")
    return { success: true, output: text }
  },
}

// ── file_semantic_search ──────────────────────────────────────────────────

interface FileSearchParams {
  query: string
  limit?: number
  mode?: "text" | "vector" | "hybrid"
}

export const fileSemanticSearchTool: AgentTool<FileSearchParams> = {
  name: "file_semantic_search",
  description: "인덱싱된 로컬 파일에서 의미적/키워드 검색을 수행합니다. `nobie index` 명령으로 파일을 먼저 인덱싱해야 합니다.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색어 (자연어 또는 키워드)" },
      limit: { type: "number", description: "최대 결과 수 (기본: 5, 최대: 20)" },
      mode: {
        type: "string",
        enum: ["text", "vector", "hybrid"],
        description: "검색 모드: text(FTS), vector(의미 검색), hybrid(혼합, 기본값)",
      },
    },
    required: ["query"],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params: FileSearchParams): Promise<ToolResult> => {
    const limit = Math.min(params.limit ?? 5, 20)
    const mode = params.mode ?? "hybrid"

    let results: Array<{ file_path: string; chunk_index: number; content: string; score: number }>

    if (mode === "text") {
      results = fileIndexer.searchByText(params.query, limit)
    } else if (mode === "vector") {
      results = await fileIndexer.searchByVector(params.query, limit)
    } else {
      // hybrid: merge text + vector results
      const [textRes, vecRes] = await Promise.all([
        Promise.resolve(fileIndexer.searchByText(params.query, limit)),
        fileIndexer.searchByVector(params.query, limit),
      ])
      const seen = new Set<string>()
      results = []
      for (const r of [...textRes, ...vecRes]) {
        const key = `${r.file_path}:${r.chunk_index}`
        if (!seen.has(key)) { seen.add(key); results.push(r) }
      }
      results = results.slice(0, limit)
    }

    if (!results.length) {
      return { success: true, output: "검색 결과가 없습니다. `nobie index <경로>` 명령으로 파일을 먼저 인덱싱하세요." }
    }

    const text = results
      .map((r, i) => `${i + 1}. [${r.file_path}:${r.chunk_index}]\n${r.content.slice(0, 400)}…`)
      .join("\n\n")
    return { success: true, output: text }
  },
}
