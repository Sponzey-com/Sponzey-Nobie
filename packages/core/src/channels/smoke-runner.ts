import type { NobieConfig } from "../config/types.js"

export type ChannelSmokeChannel = "webui" | "telegram" | "slack"
export type ChannelSmokeScenarioKind =
  | "basic_query"
  | "approval_required_tool"
  | "artifact_delivery"
  | "failure_tool"
export type ChannelSmokeStatus = "passed" | "failed" | "skipped"
export type ChannelSmokeCorrelationKey = "webui_run_id" | "telegram_chat_thread" | "slack_thread"
export type ChannelSmokeArtifactMode =
  | "native_file"
  | "download_link"
  | "inline_preview"
  | "local_path_markdown"

export interface ChannelSmokeScenario {
  id: string
  channel: ChannelSmokeChannel
  kind: ChannelSmokeScenarioKind
  title: string
  request: string
  expectedTarget: ChannelSmokeChannel
  correlationKey: ChannelSmokeCorrelationKey
  requiresExternalCredential: boolean
  expectedTool?: string
  expectsApproval?: boolean
  expectsArtifact?: boolean
  expectsFailure?: boolean
}

export interface ChannelSmokeReadiness {
  ready: boolean
  skipReason?: string
}

export interface ChannelSmokeToolTrace {
  toolName: string
  sourceChannel: ChannelSmokeChannel
  deliveryChannel?: ChannelSmokeChannel
}

export interface ChannelSmokeArtifactTrace {
  channel: ChannelSmokeChannel
  mode: ChannelSmokeArtifactMode
  filePath?: string
  url?: string
}

export interface ChannelSmokeApprovalTrace {
  requested: boolean
  resolved?: "approve_once" | "approve_all" | "deny" | "timeout"
  targetChannel?: ChannelSmokeChannel
  correlationKey?: ChannelSmokeCorrelationKey
}

export interface ChannelSmokeTrace {
  sourceChannel: ChannelSmokeChannel
  responseChannel?: ChannelSmokeChannel
  correlationKey?: ChannelSmokeCorrelationKey
  toolCalls?: ChannelSmokeToolTrace[]
  approval?: ChannelSmokeApprovalTrace
  artifacts?: ChannelSmokeArtifactTrace[]
  finalText?: string
  auditLogId?: string
  skipped?: boolean
  skipReason?: string
}

export interface ChannelSmokeValidation {
  status: ChannelSmokeStatus
  reason?: string
  failures: string[]
}

export interface ChannelSmokeRunResult {
  scenario: ChannelSmokeScenario
  status: ChannelSmokeStatus
  reason?: string
  failures: string[]
  auditLogId?: string
}

export interface ChannelSmokeRunnerOptions {
  config: NobieConfig
  scenarios?: ChannelSmokeScenario[]
  executeScenario: (scenario: ChannelSmokeScenario) => Promise<ChannelSmokeTrace>
}

const LOCAL_PATH_MARKDOWN_PATTERN =
  /!?\[[^\]]*\]\((?:\/Users\/|\/tmp\/|[A-Za-z]:\\)[^)]+\)|(?:\/Users\/|\/tmp\/|[A-Za-z]:\\)[^\s)]+/u

export function getDefaultChannelSmokeScenarios(): ChannelSmokeScenario[] {
  return [
    buildScenario("webui", "basic_query", "기본 Web UI 질의", "오늘 상태를 한 줄로 알려줘"),
    buildScenario("webui", "approval_required_tool", "Web UI 승인 도구", "메인 화면 캡쳐해서 보여줘", {
      expectedTool: "screen_capture",
      expectsApproval: true,
      expectsArtifact: true,
    }),
    buildScenario("webui", "artifact_delivery", "Web UI artifact 전달", "메인 화면 캡쳐해서 다운로드 링크로 보여줘", {
      expectedTool: "screen_capture",
      expectsArtifact: true,
    }),
    buildScenario("webui", "failure_tool", "Web UI 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
      expectsFailure: true,
    }),
    buildScenario("telegram", "basic_query", "Telegram 기본 질의", "오늘 상태를 한 줄로 알려줘"),
    buildScenario("telegram", "approval_required_tool", "Telegram 승인 도구", "메인 화면 캡쳐해서 보여줘", {
      expectedTool: "screen_capture",
      expectsApproval: true,
      expectsArtifact: true,
    }),
    buildScenario("telegram", "artifact_delivery", "Telegram artifact 전달", "메인 화면 캡쳐해서 파일로 보내줘", {
      expectedTool: "screen_capture",
      expectsArtifact: true,
    }),
    buildScenario("telegram", "failure_tool", "Telegram 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
      expectsFailure: true,
    }),
    buildScenario("slack", "basic_query", "Slack 기본 질의", "오늘 상태를 한 줄로 알려줘"),
    buildScenario("slack", "approval_required_tool", "Slack 승인 도구", "메인 화면 캡쳐해서 보여줘", {
      expectedTool: "screen_capture",
      expectsApproval: true,
      expectsArtifact: true,
    }),
    buildScenario("slack", "artifact_delivery", "Slack artifact 전달", "메인 화면 캡쳐해서 파일로 보내줘", {
      expectedTool: "screen_capture",
      expectsArtifact: true,
    }),
    buildScenario("slack", "failure_tool", "Slack 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
      expectsFailure: true,
    }),
  ]
}

function buildScenario(
  channel: ChannelSmokeChannel,
  kind: ChannelSmokeScenarioKind,
  title: string,
  request: string,
  overrides: Partial<ChannelSmokeScenario> = {},
): ChannelSmokeScenario {
  return {
    id: `${channel}.${kind}`,
    channel,
    kind,
    title,
    request,
    expectedTarget: channel,
    correlationKey: defaultCorrelationKey(channel),
    requiresExternalCredential: channel !== "webui",
    ...overrides,
  }
}

function defaultCorrelationKey(channel: ChannelSmokeChannel): ChannelSmokeCorrelationKey {
  switch (channel) {
    case "telegram":
      return "telegram_chat_thread"
    case "slack":
      return "slack_thread"
    case "webui":
    default:
      return "webui_run_id"
  }
}

export function resolveChannelSmokeReadiness(
  config: NobieConfig,
  scenario: ChannelSmokeScenario,
): ChannelSmokeReadiness {
  switch (scenario.channel) {
    case "webui":
      return config.webui.enabled
        ? { ready: true }
        : { ready: false, skipReason: "webui_disabled" }
    case "telegram": {
      const telegram = config.telegram
      if (!telegram?.enabled) return { ready: false, skipReason: "telegram_disabled" }
      if (!telegram.botToken.trim()) return { ready: false, skipReason: "telegram_bot_token_missing" }
      if (telegram.allowedUserIds.length === 0 && telegram.allowedGroupIds.length === 0) {
        return { ready: false, skipReason: "telegram_target_id_missing" }
      }
      return { ready: true }
    }
    case "slack": {
      const slack = config.slack
      if (!slack?.enabled) return { ready: false, skipReason: "slack_disabled" }
      if (!slack.botToken.trim()) return { ready: false, skipReason: "slack_bot_token_missing" }
      if (!slack.appToken.trim()) return { ready: false, skipReason: "slack_app_token_missing" }
      if (slack.allowedChannelIds.length === 0) return { ready: false, skipReason: "slack_channel_id_missing" }
      return { ready: true }
    }
  }
}

export function validateChannelSmokeTrace(
  scenario: ChannelSmokeScenario,
  trace: ChannelSmokeTrace,
): ChannelSmokeValidation {
  if (trace.skipped) {
    return { status: "skipped", reason: trace.skipReason ?? "skipped", failures: [] }
  }

  const failures: string[] = []
  if (trace.sourceChannel !== scenario.channel) {
    failures.push(`source_channel_mismatch:${trace.sourceChannel}`)
  }
  if (trace.responseChannel && trace.responseChannel !== scenario.expectedTarget) {
    failures.push(`response_channel_mismatch:${trace.responseChannel}`)
  }
  if (trace.correlationKey && trace.correlationKey !== scenario.correlationKey) {
    failures.push(`correlation_key_mismatch:${trace.correlationKey}`)
  }

  for (const toolCall of trace.toolCalls ?? []) {
    if (toolCall.sourceChannel !== scenario.channel) {
      failures.push(`tool_source_mismatch:${toolCall.toolName}:${toolCall.sourceChannel}`)
    }
    if (toolCall.deliveryChannel && toolCall.deliveryChannel !== scenario.expectedTarget) {
      failures.push(`tool_delivery_channel_mismatch:${toolCall.toolName}:${toolCall.deliveryChannel}`)
    }
    if (scenario.channel !== "telegram" && toolCall.toolName === "telegram_send_file") {
      failures.push("telegram_delivery_tool_used_outside_telegram")
    }
  }

  if (scenario.expectedTool && !(trace.toolCalls ?? []).some((toolCall) => toolCall.toolName === scenario.expectedTool)) {
    failures.push(`expected_tool_missing:${scenario.expectedTool}`)
  }

  if (scenario.expectsApproval) {
    if (!trace.approval?.requested) {
      failures.push("approval_request_missing")
    } else if (trace.approval.targetChannel && trace.approval.targetChannel !== scenario.expectedTarget) {
      failures.push(`approval_target_mismatch:${trace.approval.targetChannel}`)
    } else if (trace.approval.correlationKey && trace.approval.correlationKey !== scenario.correlationKey) {
      failures.push(`approval_correlation_mismatch:${trace.approval.correlationKey}`)
    }
  }

  if (scenario.expectsArtifact) validateArtifactTrace(scenario, trace, failures)
  if (trace.finalText && LOCAL_PATH_MARKDOWN_PATTERN.test(trace.finalText)) {
    failures.push("local_path_exposed_in_final_text")
  }
  if (!trace.auditLogId) failures.push("audit_log_missing")

  if (failures.length > 0) {
    return { status: "failed", reason: failures[0] ?? "smoke_validation_failed", failures }
  }
  return { status: "passed", failures }
}

function validateArtifactTrace(
  scenario: ChannelSmokeScenario,
  trace: ChannelSmokeTrace,
  failures: string[],
): void {
  const artifacts = trace.artifacts ?? []
  if (artifacts.length === 0) {
    failures.push("artifact_missing")
    return
  }

  for (const artifact of artifacts) {
    if (artifact.channel !== scenario.expectedTarget) {
      failures.push(`artifact_channel_mismatch:${artifact.channel}`)
    }
    if (artifact.mode === "local_path_markdown") {
      failures.push("artifact_local_path_markdown")
    }
    if (scenario.channel === "webui" && artifact.mode !== "inline_preview" && artifact.mode !== "download_link") {
      failures.push(`webui_artifact_mode_invalid:${artifact.mode}`)
    }
    if ((scenario.channel === "telegram" || scenario.channel === "slack")
      && artifact.mode !== "native_file"
      && artifact.mode !== "download_link") {
      failures.push(`${scenario.channel}_artifact_mode_invalid:${artifact.mode}`)
    }
  }
}

export async function runChannelSmokeScenarios(options: ChannelSmokeRunnerOptions): Promise<ChannelSmokeRunResult[]> {
  const scenarios = options.scenarios ?? getDefaultChannelSmokeScenarios()
  const results: ChannelSmokeRunResult[] = []

  for (const scenario of scenarios) {
    const readiness = resolveChannelSmokeReadiness(options.config, scenario)
    if (!readiness.ready) {
      results.push({
        scenario,
        status: "skipped",
        failures: [],
        ...(readiness.skipReason ? { reason: readiness.skipReason } : {}),
      })
      continue
    }

    try {
      const trace = await options.executeScenario(scenario)
      const validation = validateChannelSmokeTrace(scenario, trace)
      results.push({
        scenario,
        status: validation.status,
        failures: validation.failures,
        ...(validation.reason ? { reason: validation.reason } : {}),
        ...(trace.auditLogId ? { auditLogId: trace.auditLogId } : {}),
      })
    } catch (error) {
      results.push({
        scenario,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        failures: ["scenario_execution_failed"],
      })
    }
  }

  return results
}
