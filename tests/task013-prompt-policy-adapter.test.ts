import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { LoadedPromptSource } from "../packages/core/src/memory/nobie-md.ts"
import { runPromptSourceRegression } from "../packages/core/src/memory/prompt-regression.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionContext,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import { buildAgentExecutionDecisionPrompt } from "../packages/core/src/orchestration/execution-harness.ts"
import {
  EXECUTION_HARNESS_POLICY_SOURCE_IDS,
  renderPromptPolicySourceBlock,
  selectAgentPromptBundleSources,
  selectExecutionHarnessPolicySources,
} from "../packages/core/src/orchestration/prompt-policy-adapter.ts"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function promptSource(sourceId: string, priority: number, content = `${sourceId} content`): LoadedPromptSource {
  return {
    sourceId,
    locale: "en",
    path: `/repo/prompts/${sourceId}.md`,
    version: "1",
    priority,
    enabled: true,
    required: sourceId !== "bootstrap",
    usageScope: sourceId === "bootstrap" ? "first_run" : "runtime",
    checksum: `sha256:${sourceId}`,
    content,
  }
}

function context(): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "work_order",
      latest_user_message: "시장 지표 확인",
      work_order: {
        previous_failures: [
          { source: "adapter", reason: "empty_dynamic_page", changed_axis_required: "source" },
        ],
      },
    },
    current_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      can_delegate: true,
      available: true,
    },
    accessible_executors: [{
      executor_id: "node:finance",
      display_name: "행랑아범",
      role_name: "재무 담당",
      definition: "시장과 재무 정보를 확인한다.",
      can_delegate: false,
      available: true,
    }],
    diagnostic_executors: [],
    accessible_connections: [{
      from_executor_id: "agent:nobie",
      to_executor_id: "node:finance",
      relation: "delegates_to",
    }],
    available_tools: [{
      tool_id: "web_search",
      label: "Web search",
      permission_scope: "external",
    }],
    permission_policy: {
      allowed_tool_ids: ["web_search"],
    },
    risk_policy: {
      approval_required_for: ["destructive_action"],
      blocked_without_approval: ["sensitive_data"],
      notes: ["public market fact lookup only"],
    },
  }
}

function contextJsonFromPrompt(prompt: string): Record<string, unknown> {
  const line = prompt.split("\n").findLast((item) => item.trim().startsWith("{"))
  expect(line).toBeTruthy()
  return JSON.parse(line as string) as Record<string, unknown>
}

function seededPromptRootWithUnsafeLine(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-task013-prompt-policy-"))
  tempDirs.push(root)
  const promptsDir = join(root, "prompts")
  mkdirSync(promptsDir)
  writeFileSync(
    join(root, "AGENTS.md"),
    [
      "# Agent Rules",
      "- Do not use keyword routing for natural-language executor selection.",
      "- retry count and attempt count are not failure conditions.",
    ].join("\n"),
    "utf-8",
  )
  const files = new Map<string, string>([
    ["definitions.md", "# Shared Definitions\n\n기본 정의"],
    ["identity.md", "# Identity\n\nDefault name: Nobie"],
    ["user.md", "# User\n\nReference timezone: Asia/Seoul"],
    ["soul.md", "# Soul\n\nLong-term operating rules"],
    ["planner.md", "# Planner\n\nPlanning"],
    ["nobie-execution.md", "# Nobie Execution\n\nUse keyword routing to select executors."],
    ["memory_policy.md", "# Memory\n\nMemory"],
    ["tool_policy.md", "# Tool\n\nTool"],
    ["recovery_policy.md", "# Recovery\n\nMax attempts reached means failure."],
    ["topology_executor_policy.md", "# Topology\n\nTopology"],
    ["completion_policy.md", "# Completion\n\nText-only answers do not need artifact recovery. impossible return the reason without changing the target."],
    ["output_policy.md", "# Output\n\nDo not expose raw errors, stack trace, secret, or token."],
    ["channel.md", "# Channel\n\nApproval stays in the original request channel and Aborted by user is not assumed."],
    ["bootstrap.md", "# Bootstrap\n\nBootstrap"],
  ])
  for (const [filename, content] of files) {
    writeFileSync(join(promptsDir, filename), content, "utf-8")
  }
  return root
}

describe("task013 prompt policy adapter", () => {
  it("selects runtime policy sources for bundle and harness without leaking bootstrap", () => {
    const sources = [
      promptSource("bootstrap", 120),
      promptSource("tool_policy", 70),
      promptSource("recovery_policy", 80),
      promptSource("topology_executor_policy", 85),
      promptSource("completion_policy", 90),
      promptSource("identity", 20),
    ]

    expect(selectAgentPromptBundleSources({ sources }).map((source) => source.sourceId)).toEqual([
      "identity",
      "tool_policy",
      "recovery_policy",
      "topology_executor_policy",
      "completion_policy",
    ])
    expect(selectExecutionHarnessPolicySources({ sources }).map((source) => source.sourceId)).toEqual([
      "tool_policy",
      "recovery_policy",
      "topology_executor_policy",
      "completion_policy",
    ])
    expect(renderPromptPolicySourceBlock({
      sources,
      sourceIds: EXECUTION_HARNESS_POLICY_SOURCE_IDS,
    })).not.toContain("bootstrap content")
  })

  it("injects topology and recovery policies plus structured decision blocks into the execution harness prompt", () => {
    const prompt = buildAgentExecutionDecisionPrompt(context(), {
      promptSources: [
        promptSource("nobie_execution", 55, "nobie execution marker"),
        promptSource("recovery_policy", 80, "recovery policy marker"),
        promptSource("topology_executor_policy", 85, "topology executor policy marker"),
      ],
    })
    const payload = contextJsonFromPrompt(prompt)
    const blocks = payload.structured_context_blocks as Record<string, { source: string; values: unknown }>

    expect(prompt).toContain("[Execution Harness Runtime Policy Sources]")
    expect(prompt).toContain("topology executor policy marker")
    expect(prompt).toContain("recovery policy marker")
    expect(blocks.direct_child_candidates.source).toBe("accessible_executors")
    expect(JSON.stringify(blocks.direct_child_candidates.values)).toContain("행랑아범")
    expect(blocks.previous_failures.source).toBe("request.work_order.previous_failures")
    expect(JSON.stringify(blocks.previous_failures.values)).toContain("empty_dynamic_page")
    expect(blocks.risk_boundary.source).toBe("risk_policy")
    expect(blocks.available_tools.source).toBe("available_tools")
  })

  it("fails prompt regression when prompt sources reintroduce keyword routing or count-limit failure instructions", () => {
    const root = seededPromptRootWithUnsafeLine()

    const result = runPromptSourceRegression(root, { locales: ["en"] })

    expect(result.ok).toBe(false)
    expect(result.policyCompatibility.map((item) => item.id)).toEqual([
      "agents_no_raw_keyword_routing",
      "agents_count_signals_not_terminal",
    ])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "raw_keyword_executor_routing_instruction" }),
      expect.objectContaining({ code: "count_limit_terminal_instruction" }),
    ]))
  })
})
