import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"

const MAX_NOBIE_MD_SIZE = 8000
const MAX_SYSTEM_PROMPT_SIZE = 60000
const MEMORY_FILENAMES = ["NOBIE.md", "WIZBY.md", "HOWIE.md"] as const
const PROMPTS_DIRNAME = "prompts"
const PROMPT_ASSEMBLY_POLICY_VERSION = 1
export type PromptSourceUsageScope = "runtime" | "first_run" | "planner" | "diagnostic"

export interface PromptSourceMetadata {
  sourceId: string
  locale: "ko" | "en"
  path: string
  version: string
  priority: number
  enabled: boolean
  required: boolean
  usageScope: PromptSourceUsageScope
  checksum: string
}

export interface LoadedPromptSource extends PromptSourceMetadata {
  content: string
}

export interface PromptSourceState {
  sourceId: string
  locale: "ko" | "en"
  enabled: boolean
}

export interface PromptSourceSnapshot {
  assemblyVersion: 1
  createdAt: number
  sources: PromptSourceMetadata[]
}

export interface PromptSourceAssembly {
  text: string
  snapshot: PromptSourceSnapshot
  sources: LoadedPromptSource[]
}

interface PromptSourceDefinition {
  sourceId: string
  filenames: { ko: string; en: string }
  priority: number
  required: boolean
  usageScope: PromptSourceUsageScope
  defaultRuntime: boolean
}

const PROMPT_SOURCE_DEFINITIONS: PromptSourceDefinition[] = [
  { sourceId: "identity", filenames: { ko: "identity.md", en: "identity.md.en" }, priority: 10, required: true, usageScope: "runtime", defaultRuntime: true },
  { sourceId: "user", filenames: { ko: "user.md", en: "user.md.en" }, priority: 20, required: true, usageScope: "runtime", defaultRuntime: true },
  { sourceId: "definitions", filenames: { ko: "definitions.md", en: "definitions.md.en" }, priority: 30, required: true, usageScope: "runtime", defaultRuntime: true },
  { sourceId: "soul", filenames: { ko: "soul.md", en: "soul.md.en" }, priority: 40, required: true, usageScope: "runtime", defaultRuntime: true },
  { sourceId: "planner", filenames: { ko: "planner.md", en: "planner.md.en" }, priority: 80, required: false, usageScope: "planner", defaultRuntime: false },
  { sourceId: "bootstrap", filenames: { ko: "bootstrap.md", en: "bootstrap.md.en" }, priority: 90, required: false, usageScope: "first_run", defaultRuntime: false },
]

export const REQUIRED_RUNTIME_PROMPT_SOURCE_IDS = PROMPT_SOURCE_DEFINITIONS
  .filter((definition) => definition.required && definition.defaultRuntime)
  .map((definition) => definition.sourceId)

export interface PromptSourceSeedResult {
  promptsDir: string
  created: string[]
  existing: string[]
  registry: LoadedPromptSource[]
}

const DEFAULT_PROMPT_SOURCE_CONTENT: Record<string, { ko: string; en: string }> = {
  identity: {
    ko: `# 정체성

## 이름

- 기본 이름: \`노비\`
- 영문 이름: \`Nobie\`
- 로컬 실행 확장 표시 이름: \`연장\` / \`Yeonjang\`

## 역할

- 사용자-facing 역할: 개인 작업 허브
- 실행 정책과 완료 기준: \`soul.md\`를 따른다.

## 말투

- 기본 말투: 간결한 존댓말
- 분위기: 차분하고 실용적인 작업 파트너
- 피할 것: 과한 친근함, 과장된 확신, 불필요한 사과, 장황한 설명

## 호칭

- 기본적으로 사용자 호칭 없이 직접 응답한다.
- 사용자가 호칭을 지정하면 \`user.md\`를 따른다.
`,
    en: `# Identity

## Name

- Default name: \`Nobie\`
- Local execution extension display name: \`Yeonjang\`

## Role

- User-facing role: personal work hub
- Execution policy and completion criteria follow \`soul.md\`.

## Voice

- Default voice: concise and respectful
- Mood: calm, pragmatic work partner
- Avoid: excessive friendliness, overstated certainty, unnecessary apologies, long explanations

## Address Style

- By default, respond without a special user title.
- If the user sets an address style, follow \`user.md\`.
`,
  },
  user: {
    ko: `# 사용자

## 식별

- 실명: 미확정
- 계정명/닉네임: 미확정
- 선호 이름: 없음

## 호칭

- 기본 호칭: 없음
- 지정된 호칭이 있으면 그 호칭을 따른다.

## 언어

- 기본 응답 언어: 한국어
- 요청 언어를 유지한다.

## 시간대

- 기준 시간대: \`Asia/Seoul\`
- 표시 시간대: \`KST\`, UTC+09:00
- 상대 날짜는 별도 지시가 없으면 \`Asia/Seoul\` 기준으로 해석한다.

## 확정 규칙

- 사용자 정보는 직접 진술 또는 신뢰 가능한 설정으로 확인된 경우에만 확정한다.
- 경로명, 계정명, 채널 표시명만 보고 사용자 이름을 추정하지 않는다.
`,
    en: `# User

## Identification

- Real name: unknown
- Account name / nickname: unknown
- Preferred name: none

## Address Style

- Default address style: none
- If a specific address style is configured, use it.

## Language

- Default response language: Korean
- Preserve the request language.

## Timezone

- Reference timezone: \`Asia/Seoul\`
- Display timezone: \`KST\`, UTC+09:00
- Unless otherwise specified, interpret relative dates in \`Asia/Seoul\`.

## Confirmation Rule

- Confirm user facts only from direct user statements or trusted settings.
- Do not infer the user name from paths, account names, or channel display names.
`,
  },
  definitions: {
    ko: `# 공통 정의

이 파일은 프롬프트와 런타임 문서가 같은 용어를 쓰도록 만드는 공통 정의다. 이름, 말투, 호칭은 \`identity.md\`와 \`user.md\`가 담당한다. 실행 원칙은 \`soul.md\`가 담당한다.

## 핵심 용어

- 에이전트: 사용자 요청을 해석하고 실행하는 주체다.
- 로컬 실행 확장: 화면, 카메라, 앱, 파일, 명령 같은 로컬 장치 작업을 수행하는 외부 실행 주체다.
- prompt source: \`prompts/\` 아래의 역할별 프롬프트 원본 파일이다.
- prompt source registry: source id, locale, path, version, priority, enabled, required, checksum을 관리하는 목록이다.
- bootstrap prompt: 최초 실행 또는 registry 복구 때만 쓰는 초기화 프롬프트다.
- identity prompt: 이름, 표시 이름, 사용자-facing 말투를 정의한다.
- user prompt: 사용자 이름, 호칭, 언어, 시간대, 선호를 정의한다.
- soul prompt: 장기 운영 원칙, 실행 기준, 복구 기준, 완료 기준을 정의한다.
- planner prompt: 요청 intake, 구조화, 실행 브리프, 예약, 완료 검토 기준을 정의한다.

## 실행 단위

- run: 하나의 실행 기록이다.
- root run: 사용자 요청에서 시작된 최상위 실행이다.
- child run: 같은 AI 연결을 쓰지만 별도 context, memory scope, 완료 조건을 가진 하위 실행이다.
- session key: WebUI session, Telegram chat/thread, Slack channel/thread처럼 대화 연속성을 식별하는 키다.
- request group id: 사용자가 하나의 목표로 인식하는 작업 묶음이다.
- lineage root run id: root run과 child run을 하나의 실행 계보로 묶는 기준이다.
- parent run id: child run을 만든 직전 run이다.

## 메모리 범위

- global memory: 세션을 넘어 유지되는 장기 기억이다.
- session memory: 같은 session key 안에서만 쓰는 대화 요약과 열린 작업 맥락이다.
- task memory: 같은 lineage 또는 명시 handoff 안에서만 쓰는 실행 기억이다.
- artifact memory: 파일, 이미지, 캡처, 전달 대상 같은 산출물 metadata다.
- diagnostic memory: 오류, 성능, 복구, 내부 진단 기록이다. 일반 요청에 기본 주입하지 않는다.

## 완료와 복구

- receipt: 실행, 승인, 전달, 실패를 증명하는 구조화된 기록이다.
- delivery receipt: 결과물이 실제 사용자 채널 또는 사용 가능한 경로로 전달되었음을 나타내는 기록이다.
- completion: 요청한 결과가 실제로 충족되었거나, 불가능한 이유를 결과로 반환해 종료된 상태다.
- pending approval: 사용자 승인을 기다리는 상태다.
- pending delivery: 실행 결과는 있으나 결과물 전달이 끝나지 않은 상태다.
- recovery key: 같은 실패 반복을 막기 위해 \`tool + target + normalized error kind + action\`으로 만든 키다.

## 경계 규칙

- prompt source는 정책과 정의를 담고, secret과 runtime token을 담지 않는다.
- 사용자 정보는 확인된 값만 확정한다.
- 로컬 실행 확장 연결 상태와 capability는 runtime preflight에서 판단한다.
- 완료는 텍스트 주장보다 receipt와 실제 결과를 우선한다.
- 불가능한 작업은 다른 대상으로 바꾸지 않고 불가능 사유로 완료한다.
`,
    en: `# Shared Definitions

This file keeps prompt and runtime documents aligned on the same terminology. Names, voice, and address style belong in \`identity.md\` and \`user.md\`. Operating policy belongs in \`soul.md\`.

## Core Terms

- Agent: the actor that interprets and executes user requests.
- Local execution extension: an external execution actor for local device work such as screen, camera, apps, files, and commands.
- Prompt source: a role-specific prompt source file under \`prompts/\`.
- Prompt source registry: the list that manages source id, locale, path, version, priority, enabled flag, required flag, and checksum.
- Bootstrap prompt: an initialization prompt used only for first run or registry repair.
- Identity prompt: defines the name, display name, and user-facing voice.
- User prompt: defines user name, address style, language, timezone, and preferences.
- Soul prompt: defines long-term operating policy, execution rules, recovery rules, and completion rules.
- Planner prompt: defines intake, structuring, execution brief, scheduling, and completion review rules.

## Execution Units

- Run: a single execution record.
- Root run: the top-level execution started from a user request.
- Child run: a sub-execution that uses the same AI connection but has separate context, memory scope, and completion criteria.
- Session key: a key that identifies conversation continuity, such as WebUI session, Telegram chat/thread, or Slack channel/thread.
- Request group id: a unit of work the user perceives as one goal.
- Lineage root run id: the root identifier that groups a root run and child runs into one execution lineage.
- Parent run id: the immediate run that created a child run.

## Memory Scopes

- Global memory: long-term memory that persists across sessions.
- Session memory: conversation summaries and open-task context visible only in the same session key.
- Task memory: execution memory visible only within the same lineage or explicit handoff.
- Artifact memory: metadata for files, images, captures, and delivery targets.
- Diagnostic memory: errors, performance, recovery, and internal diagnostic records. It is not injected into normal requests by default.

## Completion And Recovery

- Receipt: a structured record that proves execution, approval, delivery, or failure.
- Delivery receipt: a record proving that an artifact was delivered to the user channel or made available through a usable path.
- Completion: the requested result is actually satisfied, or the impossible reason has been returned and the task is closed.
- Pending approval: a state waiting for user approval.
- Pending delivery: execution produced a result, but artifact delivery is not complete.
- Recovery key: a key built from \`tool + target + normalized error kind + action\` to avoid repeating the same failure.

## Boundary Rules

- Prompt sources contain policy and definitions, not secrets or runtime tokens.
- User facts are confirmed only when directly stated or provided by trusted settings.
- Local execution extension connection state and capability are judged by runtime preflight.
- Completion prioritizes receipts and actual results over text claims.
- Impossible work is completed by returning the reason, not by changing the target.
`,
  },
  soul: {
    ko: `# 소울 프롬프트

이 파일은 장기 실행 원칙을 정의한다. 이름, 호칭, 역할 인식, 분위기, 말투처럼 사용자가 체감하는 정체성은 \`identity.md\`가 담당한다. run, session, memory scope, receipt 같은 공통 용어는 \`definitions.md\`가 담당한다.

## 핵심 원칙

- 사용자의 문장을 문자 그대로 먼저 이해한다.
- 명확히 드러나는 일반적인 상식적 목적만 추론한다.
- 실행 가능한 요청은 설명보다 실행을 우선한다.
- 로컬 장치/시스템 작업은 로컬 실행 확장을 먼저 사용한다.
- 물리적 또는 논리적으로 불가능한 요청은 다른 작업으로 바꾸지 않고 이유를 반환해 완료한다.
- 같은 실패를 반복하지 않는다.
- 완료에는 실제 결과 또는 명확한 불가능 사유가 필요하다.
`,
    en: `# Soul Prompt

This file defines long-term operating principles. User-facing identity belongs in \`identity.md\`. Shared terms belong in \`definitions.md\`.

## Core Principles

- Interpret the user's wording literally first.
- Infer only the normal common-sense purpose that is clearly present.
- Prefer execution over explanation for actionable requests.
- Use the local execution extension first for local device or system work.
- If a request is physically or logically impossible, do not convert it into a different task; return the reason and complete.
- Do not repeat the same failure path.
- Completion requires an actual result or a clear impossible-reason result.
`,
  },
  planner: {
    ko: `# 플래너 프롬프트

이 파일은 에이전트 내부의 태스크 intake 및 실행 계획 프롬프트를 문서화한다. 이름과 말투는 \`identity.md\`, 공통 용어는 \`definitions.md\`, 장기 운영 원칙은 \`soul.md\`를 따른다.

## 역할

- 최신 사용자 메시지와 대화 문맥을 읽는다.
- 실제로 원하는 작업을 구조화한다.
- 접수 응답과 실제 실행을 분리한다.
- 실행이 필요한 요청은 명확한 action item으로 남긴다.
- 예약, 리마인더, 반복 실행 요청은 일정 작업으로 구조화한다.
- 불명확한 요청은 추측하지 않고 필요한 정보만 묻는다.

## 완료 검토

- 원 요청이 실제로 충족되었을 때만 완료로 본다.
- 결과물 전달이 필요하면 전달 receipt가 있어야 한다.
- 불가능한 요청은 사유를 반환하고 완료한다.
`,
    en: `# Planner Prompt

This file documents the internal task intake and execution-planning prompt. Name and voice follow \`identity.md\`, shared terms follow \`definitions.md\`, and long-term policy follows \`soul.md\`.

## Role

- Read the latest user message and conversation context.
- Structure the actual requested work.
- Separate intake receipts from real execution.
- Leave clear action items for requests that require execution.
- Structure scheduling, reminders, and recurring requests as schedule work.
- Ask only for necessary information when a request is unclear.

## Completion Review

- Mark complete only when the original request is actually satisfied.
- If artifact delivery is required, a delivery receipt is required.
- Impossible requests complete by returning the reason.
`,
  },
  bootstrap: {
    ko: `# 최초 실행 부트스트랩 프롬프트

이 파일은 최초 실행 또는 prompt source registry 복구 시에만 사용한다. 일반 사용자 요청을 처리하는 run에는 자동 주입하지 않는다.

## 목적

- prompt source registry를 seed한다.
- 누락된 source와 metadata만 생성한다.
- 사용자가 수정한 prompt나 profile을 덮어쓰지 않는다.
- 민감 정보와 추정 정보를 prompt source에 기록하지 않는다.

## 완료 기준

- 필수 prompt source가 모두 존재한다.
- source metadata와 checksum이 기록된다.
- 사용자 정보는 확인되지 않은 값을 추정하지 않는다.
- bootstrap source는 일반 runtime assembly에서 제외된다.
`,
    en: `# First-Run Bootstrap Prompt

Use this file only during first-run initialization or prompt source registry repair. Do not inject it automatically into normal user-request runs.

## Purpose

- Seed the prompt source registry.
- Create only missing sources and metadata.
- Do not overwrite user-edited prompts or profiles.
- Do not store secrets or inferred personal facts in prompt sources.

## Completion Criteria

- All required prompt sources exist.
- Source metadata and checksums are recorded.
- Unconfirmed user facts are not inferred.
- The bootstrap source is excluded from normal runtime assembly.
`,
  },
}

const PROMPT_SOURCE_SECRET_PATTERNS: Array<{ marker: string; pattern: RegExp }> = [
  { marker: "api_key_assignment", pattern: /\b(?:api[_ -]?key|apikey)\b\s*[:=]\s*["']?(?!unknown|none|미확정|없음)[A-Za-z0-9_./+=-]{16,}/i },
  { marker: "oauth_token_assignment", pattern: /\b(?:oauth[_ -]?token|access[_ -]?token|refresh[_ -]?token)\b\s*[:=]\s*["']?(?!unknown|none|미확정|없음)[A-Za-z0-9_./+=-]{16,}/i },
  { marker: "bot_token_assignment", pattern: /\b(?:bot[_ -]?token|telegram[_ -]?token|slack[_ -]?token)\b\s*[:=]\s*["']?(?!unknown|none|미확정|없음)[A-Za-z0-9_./+=-]{16,}/i },
  { marker: "channel_secret_assignment", pattern: /\b(?:channel[_ -]?secret|client[_ -]?secret|signing[_ -]?secret)\b\s*[:=]\s*["']?(?!unknown|none|미확정|없음)[A-Za-z0-9_./+=-]{16,}/i },
  { marker: "openai_secret_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
]

const promptAssemblyCache = new Map<string, PromptSourceAssembly>()

/**
 * Walk up from workDir (up to 3 parent levels) searching for NOBIE.md first,
 * then legacy WIZBY.md / HOWIE.md.
 * Returns the file contents (trimmed to 8KB) or null if not found.
 */
export function loadNobieMd(workDir: string): string | null {
  let current = workDir
  for (let i = 0; i < 4; i++) {
    for (const filename of MEMORY_FILENAMES) {
      const candidate = join(current, filename)
      if (existsSync(candidate)) {
        try {
          return readFileSync(candidate, "utf-8").slice(0, MAX_NOBIE_MD_SIZE)
        } catch {
          return null
        }
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function findPromptsDirInAncestors(workDir: string): string | null {
  let current = workDir
  for (let i = 0; i < 4; i++) {
    const candidate = join(current, PROMPTS_DIRNAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function findPromptsDir(workDir: string): string | null {
  const ancestorCandidate = findPromptsDirInAncestors(workDir)
  if (ancestorCandidate) return ancestorCandidate

  const cwdCandidate = join(process.cwd(), PROMPTS_DIRNAME)
  if (existsSync(cwdCandidate)) return cwdCandidate

  return null
}

function resolvePromptsDirForSeed(workDir: string): string {
  return findPromptsDirInAncestors(workDir) ?? join(workDir, PROMPTS_DIRNAME)
}

function checksumContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export function detectPromptSourceSecretMarkers(content: string): string[] {
  return PROMPT_SOURCE_SECRET_PATTERNS
    .filter(({ pattern }) => pattern.test(content))
    .map(({ marker }) => marker)
}

export function isPromptSourceContentSafe(content: string): boolean {
  return detectPromptSourceSecretMarkers(content).length === 0
}

export function ensurePromptSourceFiles(workDir: string): PromptSourceSeedResult {
  const promptsDir = resolvePromptsDirForSeed(workDir)
  mkdirSync(promptsDir, { recursive: true })

  const created: string[] = []
  const existing: string[] = []
  for (const definition of PROMPT_SOURCE_DEFINITIONS) {
    const defaults = DEFAULT_PROMPT_SOURCE_CONTENT[definition.sourceId]
    if (!defaults) continue
    for (const locale of ["ko", "en"] as const) {
      const filename = definition.filenames[locale]
      const target = join(promptsDir, filename)
      if (existsSync(target)) {
        existing.push(filename)
        continue
      }
      writeFileSync(target, defaults[locale].trim() + "\n", "utf-8")
      created.push(filename)
    }
  }

  return {
    promptsDir,
    created,
    existing,
    registry: loadPromptSourceRegistry(promptsDir),
  }
}

export function loadPromptSourceRegistry(workDir: string): LoadedPromptSource[] {
  const promptsDir = findPromptsDir(workDir)
  if (!promptsDir) return []

  const sources: LoadedPromptSource[] = []
  for (const definition of PROMPT_SOURCE_DEFINITIONS) {
    for (const locale of ["ko", "en"] as const) {
      const filename = definition.filenames[locale]
      const candidate = join(promptsDir, filename)
      if (!existsSync(candidate)) continue
      try {
        const content = readFileSync(candidate, "utf-8").trim()
        if (!content) continue
        if (!isPromptSourceContentSafe(content)) continue
        const checksum = checksumContent(content)
        sources.push({
          sourceId: definition.sourceId,
          locale,
          path: candidate,
          version: checksum.slice(0, 12),
          priority: definition.priority,
          enabled: true,
          required: definition.required,
          usageScope: definition.usageScope,
          checksum,
          content,
        })
      } catch {
        // Ignore one unreadable prompt source. Required-source validation is handled by assembly.
      }
    }
  }

  return sources.sort((a, b) => (a.priority - b.priority) || a.sourceId.localeCompare(b.sourceId) || a.locale.localeCompare(b.locale))
}

function applyPromptSourceStates(sources: LoadedPromptSource[], states: PromptSourceState[]): LoadedPromptSource[] {
  if (states.length === 0) return sources
  const stateByKey = new Map(states.map((state) => [`${state.sourceId}:${state.locale}`, state]))
  return sources.map((source) => {
    const state = stateByKey.get(`${source.sourceId}:${source.locale}`)
    return state ? { ...source, enabled: state.enabled } : source
  })
}

function selectRuntimePromptSources(sources: LoadedPromptSource[], locale: "ko" | "en"): LoadedPromptSource[] {
  const bySourceId = new Map<string, LoadedPromptSource[]>()
  for (const source of sources) {
    if (source.usageScope !== "runtime") continue
    if (!source.enabled && !source.required) continue
    if (!PROMPT_SOURCE_DEFINITIONS.find((definition) => definition.sourceId === source.sourceId)?.defaultRuntime) continue
    const bucket = bySourceId.get(source.sourceId) ?? []
    bucket.push(source)
    bySourceId.set(source.sourceId, bucket)
  }

  const selected: LoadedPromptSource[] = []
  for (const definition of PROMPT_SOURCE_DEFINITIONS.filter((item) => item.defaultRuntime)) {
    const candidates = bySourceId.get(definition.sourceId) ?? []
    const preferred = candidates.find((source) => source.locale === locale)
      ?? candidates.find((source) => source.locale === "ko")
      ?? candidates[0]
    if (preferred) selected.push(preferred)
  }

  return selected.sort((a, b) => a.priority - b.priority)
}

function selectPromptSourcesByUsageScope(
  sources: LoadedPromptSource[],
  locale: "ko" | "en",
  usageScope: PromptSourceUsageScope,
): LoadedPromptSource[] {
  const bySourceId = new Map<string, LoadedPromptSource[]>()
  for (const source of sources) {
    if (source.usageScope !== usageScope) continue
    if (!source.enabled && !source.required) continue
    const bucket = bySourceId.get(source.sourceId) ?? []
    bucket.push(source)
    bySourceId.set(source.sourceId, bucket)
  }

  const selected: LoadedPromptSource[] = []
  for (const definition of PROMPT_SOURCE_DEFINITIONS.filter((item) => item.usageScope === usageScope)) {
    const candidates = bySourceId.get(definition.sourceId) ?? []
    const preferred = candidates.find((source) => source.locale === locale)
      ?? candidates.find((source) => source.locale === "ko")
      ?? candidates[0]
    if (preferred) selected.push(preferred)
  }

  return selected.sort((a, b) => a.priority - b.priority)
}

function buildPromptStateSignature(states: PromptSourceState[]): string {
  return states
    .map((state) => `${state.sourceId}:${state.locale}:${state.enabled ? "1" : "0"}`)
    .sort()
    .join("|")
}

function buildPromptRegistrySignature(sources: LoadedPromptSource[]): string {
  return sources
    .map((source) => [
      source.sourceId,
      source.locale,
      source.checksum,
      source.enabled ? "1" : "0",
      source.priority,
      source.usageScope,
    ].join(":"))
    .join("|")
}

export function loadSystemPromptSourceAssembly(workDir: string, locale: "ko" | "en" = "ko", states: PromptSourceState[] = []): PromptSourceAssembly | null {
  const registry = applyPromptSourceStates(loadPromptSourceRegistry(workDir), states)
  const runtimeSources = selectRuntimePromptSources(registry, locale)
  if (runtimeSources.length === 0) return null

  const cacheKey = [
    `policy=${PROMPT_ASSEMBLY_POLICY_VERSION}`,
    `workDir=${workDir}`,
    `locale=${locale}`,
    `states=${buildPromptStateSignature(states)}`,
    `sources=${buildPromptRegistrySignature(runtimeSources)}`,
  ].join("\n")
  const cached = promptAssemblyCache.get(cacheKey)
  if (cached) return cached

  const text = runtimeSources
    .map((source) => `[Prompt Source: ${source.sourceId}:${source.locale}@${source.version}]\n${source.content}`)
    .join("\n\n---\n\n")
    .slice(0, MAX_SYSTEM_PROMPT_SIZE)

  const assembly: PromptSourceAssembly = {
    text,
    snapshot: {
      assemblyVersion: 1,
      createdAt: Date.now(),
      sources: runtimeSources.map(({ content: _content, ...metadata }) => metadata),
    },
    sources: runtimeSources,
  }
  promptAssemblyCache.set(cacheKey, assembly)
  return assembly
}

export function loadFirstRunPromptSourceAssembly(workDir: string, locale: "ko" | "en" = "ko", states: PromptSourceState[] = []): PromptSourceAssembly | null {
  const registry = applyPromptSourceStates(loadPromptSourceRegistry(workDir), states)
  const firstRunSources = selectPromptSourcesByUsageScope(registry, locale, "first_run")
  if (firstRunSources.length === 0) return null

  const cacheKey = [
    `policy=${PROMPT_ASSEMBLY_POLICY_VERSION}`,
    "scope=first_run",
    `workDir=${workDir}`,
    `locale=${locale}`,
    `states=${buildPromptStateSignature(states)}`,
    `sources=${buildPromptRegistrySignature(firstRunSources)}`,
  ].join("\n")
  const cached = promptAssemblyCache.get(cacheKey)
  if (cached) return cached

  const text = firstRunSources
    .map((source) => `[Prompt Source: ${source.sourceId}:${source.locale}@${source.version}]\n${source.content}`)
    .join("\n\n---\n\n")
    .slice(0, MAX_SYSTEM_PROMPT_SIZE)

  const assembly: PromptSourceAssembly = {
    text,
    snapshot: {
      assemblyVersion: 1,
      createdAt: Date.now(),
      sources: firstRunSources.map(({ content: _content, ...metadata }) => metadata),
    },
    sources: firstRunSources,
  }
  promptAssemblyCache.set(cacheKey, assembly)
  return assembly
}

/**
 * Load canonical runtime prompt sources from prompts/.
 * Bootstrap/planner prompts are intentionally excluded from the default runtime assembly.
 */
export function loadSystemPromptSources(workDir: string): string | null {
  return loadSystemPromptSourceAssembly(workDir)?.text ?? null
}

const TEMPLATE = `# 프로젝트 메모리

## 기술 스택
- (사용하는 언어, 프레임워크, 런타임 등을 기술)

## 코드 규칙
- (코딩 컨벤션, 포맷터, 린터 설정 등)

## 중요 경로
- (설정 파일, DB, 로그 등 주요 경로)

## 금지사항
- (절대로 하면 안 되는 작업)

## 기타 메모
- (에이전트가 알아야 할 기타 사항)
`

/** Write a NOBIE.md template to the given directory. */
export function initNobieMd(dir: string): string {
  const target = join(dir, "NOBIE.md")
  if (!existsSync(target)) {
    writeFileSync(target, TEMPLATE, "utf-8")
  }
  return target
}

export const loadWizbyMd = loadNobieMd
export const initWizbyMd = initNobieMd
export const loadHowieMd = loadNobieMd
export const initHowieMd = initNobieMd
