import { hasRequiredProviderCredentials } from "../contracts/ai"
import type { SetupDraft, SetupStepId } from "../contracts/setup"

export interface BackendCardErrors {
  enabled?: string
  credentials?: string
  endpoint?: string
  defaultModel?: string
}

export interface McpServerErrors {
  name?: string
  transport?: string
  command?: string
  url?: string
  status?: string
}

export interface SkillItemErrors {
  label?: string
  path?: string
  status?: string
}

export interface StepValidation {
  valid: boolean
  summary: string[]
  fieldErrors: Record<string, string>
  backendErrors: Record<string, BackendCardErrors>
  mcpErrors: Record<string, McpServerErrors>
  skillErrors: Record<string, SkillItemErrors>
}

export function hasEditableSetupStep(stepId: SetupStepId): boolean {
  return ["personal", "ai_backends", "ai_routing", "mcp", "skills", "security", "channels", "remote_access"].includes(stepId)
}

export function canSkipSetupStep(stepId: SetupStepId): boolean {
  return ["ai_routing", "mcp", "skills", "security", "remote_access"].includes(stepId)
}

export function isSetupStepDirty(savedDraft: SetupDraft, localDraft: SetupDraft, stepId: SetupStepId): boolean {
  return JSON.stringify(getSetupStepSlice(savedDraft, stepId)) !== JSON.stringify(getSetupStepSlice(localDraft, stepId))
}

export function mergeSetupStepDraft(savedDraft: SetupDraft, localDraft: SetupDraft, stepId: SetupStepId): SetupDraft {
  const nextDraft = cloneDraft(savedDraft)
  const localSlice = getSetupStepSlice(localDraft, stepId)

  switch (stepId) {
    case "personal":
      nextDraft.personal = cloneValue(localSlice.personal ?? savedDraft.personal)
      break
    case "ai_backends":
      nextDraft.aiBackends = cloneValue(localSlice.aiBackends ?? savedDraft.aiBackends)
      break
    case "ai_routing":
      nextDraft.routingProfiles = cloneValue(localSlice.routingProfiles ?? savedDraft.routingProfiles)
      break
    case "mcp":
      nextDraft.mcp = cloneValue(localSlice.mcp ?? savedDraft.mcp)
      break
    case "skills":
      nextDraft.skills = cloneValue(localSlice.skills ?? savedDraft.skills)
      break
    case "security":
      nextDraft.security = cloneValue(localSlice.security ?? savedDraft.security)
      break
    case "channels":
      nextDraft.channels = cloneValue(localSlice.channels ?? savedDraft.channels)
      break
    case "remote_access":
      nextDraft.remoteAccess = cloneValue(localSlice.remoteAccess ?? savedDraft.remoteAccess)
      break
    default:
      break
  }

  return nextDraft
}

export function revertSetupStepDraft(localDraft: SetupDraft, savedDraft: SetupDraft, stepId: SetupStepId): SetupDraft {
  const nextDraft = cloneDraft(localDraft)
  const savedSlice = getSetupStepSlice(savedDraft, stepId)

  switch (stepId) {
    case "personal":
      nextDraft.personal = cloneValue(savedSlice.personal ?? savedDraft.personal)
      break
    case "ai_backends":
      nextDraft.aiBackends = cloneValue(savedSlice.aiBackends ?? savedDraft.aiBackends)
      break
    case "ai_routing":
      nextDraft.routingProfiles = cloneValue(savedSlice.routingProfiles ?? savedDraft.routingProfiles)
      break
    case "mcp":
      nextDraft.mcp = cloneValue(savedSlice.mcp ?? savedDraft.mcp)
      break
    case "skills":
      nextDraft.skills = cloneValue(savedSlice.skills ?? savedDraft.skills)
      break
    case "security":
      nextDraft.security = cloneValue(savedSlice.security ?? savedDraft.security)
      break
    case "channels":
      nextDraft.channels = cloneValue(savedSlice.channels ?? savedDraft.channels)
      break
    case "remote_access":
      nextDraft.remoteAccess = cloneValue(savedSlice.remoteAccess ?? savedDraft.remoteAccess)
      break
    default:
      break
  }

  return nextDraft
}

export function validateSetupStep(stepId: SetupStepId, draft: SetupDraft): StepValidation {
  switch (stepId) {
    case "personal":
      return validatePersonal(draft)
    case "ai_backends":
      return validateAiBackends(draft)
    case "mcp":
      return validateMcp(draft)
    case "skills":
      return validateSkills(draft)
    case "security":
      return validateSecurity(draft)
    case "channels":
      return validateChannels(draft)
    case "remote_access":
      return validateRemoteAccess(draft)
    case "review":
      return validateReview(draft)
    case "welcome":
    case "ai_routing":
    case "done":
    default:
      return { valid: true, summary: [], fieldErrors: {}, backendErrors: {}, mcpErrors: {}, skillErrors: {} }
  }
}

function validatePersonal(draft: SetupDraft): StepValidation {
  const fieldErrors: Record<string, string> = {}
  const summary: string[] = []

  if (!draft.personal.profileName.trim()) {
    fieldErrors.profileName = "이름을 입력해야 합니다."
    summary.push(fieldErrors.profileName)
  }

  if (!draft.personal.displayName.trim()) {
    fieldErrors.displayName = "표시 이름을 입력해야 합니다."
    summary.push(fieldErrors.displayName)
  }

  if (!draft.personal.language.trim()) {
    fieldErrors.language = "기본 언어를 선택해야 합니다."
    summary.push(fieldErrors.language)
  }

  if (!draft.personal.timezone.trim()) {
    fieldErrors.timezone = "시간대를 선택해야 합니다."
    summary.push(fieldErrors.timezone)
  }

  if (!draft.personal.workspace.trim()) {
    fieldErrors.workspace = "기본 작업 폴더를 입력해야 합니다."
    summary.push(fieldErrors.workspace)
  } else if (!isAbsoluteWorkspace(draft.personal.workspace.trim())) {
    fieldErrors.workspace = "작업 폴더는 전체 경로로 입력해야 합니다."
    summary.push(fieldErrors.workspace)
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors,
    backendErrors: {},
    mcpErrors: {},
    skillErrors: {},
  }
}

function validateAiBackends(draft: SetupDraft): StepValidation {
  const enabledBackends = draft.aiBackends.filter((backend) => backend.enabled)
  const backendErrors: Record<string, BackendCardErrors> = {}
  const summary: string[] = []

  if (enabledBackends.length === 0) {
    summary.push("사용할 AI를 하나 이상 켜야 합니다.")
  }

  for (const backend of enabledBackends) {
    const errors: BackendCardErrors = {}

    if (!backend.endpoint?.trim()) {
      errors.endpoint = "연결 주소를 입력해야 합니다."
    }

    if (!hasRequiredProviderCredentials(backend.providerType, backend.credentials)) {
      errors.credentials = "필수 인증 정보를 입력해야 합니다."
    }

    if (!backend.defaultModel.trim()) {
      errors.defaultModel = "기본 모델을 선택해야 합니다."
    }

    if (Object.keys(errors).length > 0) {
      backendErrors[backend.id] = errors
      summary.push(`'${backend.label}' 카드의 필수 정보를 채워야 합니다.`)
    }
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors: {},
    backendErrors,
    mcpErrors: {},
    skillErrors: {},
  }
}

function validateMcp(draft: SetupDraft): StepValidation {
  const mcpErrors: Record<string, McpServerErrors> = {}
  const summary: string[] = []

  for (const server of draft.mcp.servers) {
    const errors: McpServerErrors = {}

    if (server.required && !server.enabled) {
      errors.status = "필수 MCP 서버는 꺼둘 수 없습니다."
    }

    if (server.enabled) {
      if (!server.name.trim()) {
        errors.name = "서버 이름을 입력해야 합니다."
      }

      if (server.transport === "stdio") {
        if (!server.command.trim()) {
          errors.command = "실행 명령(Command)을 입력해야 합니다."
        }
      } else {
        if (!server.url.trim()) {
          errors.url = "HTTP 주소(URL)를 입력해야 합니다."
        }
        errors.status = errors.status ?? "현재는 stdio 방식만 지원합니다."
      }

      if (server.status !== "ready") {
        errors.status = errors.status ?? "연결 확인을 먼저 진행해야 합니다."
      }
    }

    if (Object.keys(errors).length > 0) {
      mcpErrors[server.id] = errors
      summary.push(`'${server.name || "새 MCP 서버"}' 설정을 다시 확인해야 합니다.`)
    }
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors: {},
    backendErrors: {},
    mcpErrors,
    skillErrors: {},
  }
}

function validateSkills(draft: SetupDraft): StepValidation {
  const skillErrors: Record<string, SkillItemErrors> = {}
  const summary: string[] = []

  for (const item of draft.skills.items) {
    const errors: SkillItemErrors = {}

    if (item.required && !item.enabled) {
      errors.status = "필수 Skill은 꺼둘 수 없습니다."
    }

    if (item.enabled) {
      if (!item.label.trim()) {
        errors.label = "Skill 이름을 입력해야 합니다."
      }

      if (item.source === "local" && !item.path.trim()) {
        errors.path = "로컬 Skill 경로를 입력해야 합니다."
      }

      if (item.status !== "ready") {
        errors.status = errors.status ?? "경로 확인 또는 상태 점검이 필요합니다."
      }
    }

    if (Object.keys(errors).length > 0) {
      skillErrors[item.id] = errors
      summary.push(`'${item.label || "새 Skill"}' 설정을 다시 확인해야 합니다.`)
    }
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors: {},
    backendErrors: {},
    mcpErrors: {},
    skillErrors,
  }
}

function validateSecurity(draft: SetupDraft): StepValidation {
  const fieldErrors: Record<string, string> = {}
  const summary: string[] = []

  if (!Number.isFinite(draft.security.approvalTimeout) || draft.security.approvalTimeout < 5 || draft.security.approvalTimeout > 300) {
    fieldErrors.approvalTimeout = "승인 대기 시간은 5초에서 300초 사이여야 합니다."
    summary.push(fieldErrors.approvalTimeout)
  }

  if (!Number.isFinite(draft.security.maxDelegationTurns) || draft.security.maxDelegationTurns < 0) {
    fieldErrors.maxDelegationTurns = "자동 후속 처리 최대 횟수는 0 이상이어야 합니다."
    summary.push(fieldErrors.maxDelegationTurns)
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors,
    backendErrors: {},
    mcpErrors: {},
    skillErrors: {},
  }
}

function validateChannels(draft: SetupDraft): StepValidation {
  const fieldErrors: Record<string, string> = {}
  const summary: string[] = []

  if (!draft.channels.telegramEnabled) {
    fieldErrors.telegramEnabled = "Telegram 입력 채널을 켜야 합니다."
    summary.push(fieldErrors.telegramEnabled)
  }

  if (draft.channels.telegramEnabled && !draft.channels.botToken.trim()) {
    fieldErrors.botToken = "Bot Token을 입력해야 합니다."
    summary.push(fieldErrors.botToken)
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors,
    backendErrors: {},
    mcpErrors: {},
    skillErrors: {},
  }
}

function validateRemoteAccess(draft: SetupDraft): StepValidation {
  const fieldErrors: Record<string, string> = {}
  const summary: string[] = []

  if (!draft.remoteAccess.host.trim()) {
    fieldErrors.host = "접속 주소를 입력해야 합니다."
    summary.push(fieldErrors.host)
  }

  if (!Number.isFinite(draft.remoteAccess.port) || draft.remoteAccess.port < 1 || draft.remoteAccess.port > 65535) {
    fieldErrors.port = "포트는 1에서 65535 사이여야 합니다."
    summary.push(fieldErrors.port)
  }

  if (draft.remoteAccess.authEnabled && !draft.remoteAccess.authToken.trim()) {
    fieldErrors.authToken = "인증 토큰을 입력해야 합니다."
    summary.push(fieldErrors.authToken)
  }

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors,
    backendErrors: {},
    mcpErrors: {},
    skillErrors: {},
  }
}

function validateReview(draft: SetupDraft): StepValidation {
  const requiredChecks = [
    { label: "개인 정보", result: validatePersonal(draft) },
    { label: "AI 연결", result: validateAiBackends(draft) },
    { label: "외부 기능 연결", result: validateMcp(draft) },
    { label: "작업 능력 확장", result: validateSkills(draft) },
    { label: "보안", result: validateSecurity(draft) },
    { label: "대화 채널", result: validateChannels(draft) },
  ]

  const summary = requiredChecks
    .filter((item) => !item.result.valid)
    .map((item) => `${item.label} 단계의 필수 입력을 먼저 완료해야 합니다.`)

  return {
    valid: summary.length === 0,
    summary: unique(summary),
    fieldErrors: {},
    backendErrors: {},
    mcpErrors: {},
    skillErrors: {},
  }
}

function getSetupStepSlice(draft: SetupDraft, stepId: SetupStepId) {
  switch (stepId) {
    case "personal":
      return { personal: draft.personal }
    case "ai_backends":
      return { aiBackends: draft.aiBackends }
    case "ai_routing":
      return { routingProfiles: draft.routingProfiles }
    case "mcp":
      return { mcp: draft.mcp }
    case "skills":
      return { skills: draft.skills }
    case "security":
      return { security: draft.security }
    case "channels":
      return { channels: draft.channels }
    case "remote_access":
      return { remoteAccess: draft.remoteAccess }
    default:
      return {}
  }
}

function isAbsoluteWorkspace(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:\\/.test(value)
}

function cloneDraft(draft: SetupDraft): SetupDraft {
  return JSON.parse(JSON.stringify(draft)) as SetupDraft
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}
