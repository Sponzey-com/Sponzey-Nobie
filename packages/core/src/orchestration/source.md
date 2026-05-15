# source.md

## 역할

- `orchestration`은 실행 판단, 프롬프트 번들 조립, 실행자 그래프 스냅샷, 서브세션, parent-child 결과 취합의 도메인 경계를 담당합니다.

## 주요 파일

- `prompt-policy-adapter.ts`: `prompts/` 원본을 runtime 사용처별 정책 블록으로 고르는 adapter입니다. prompt file loader와 prompt bundle assembler 사이에 위치하며, bootstrap source가 runtime prompt에 섞이지 않도록 막습니다.
- `prompt-bundle.ts`: agent profile, task scope, capability, memory, runtime prompt source를 하나의 `AgentPromptBundle`로 조립합니다. 파일 탐색이나 source 정책 선택 규칙을 직접 소유하지 않습니다.
- `execution-harness.ts`: 현재 에이전트의 구조화된 실행 컨텍스트와 runtime prompt policy block을 사용해 `AgentExecutionDecisionV2` JSON을 요청하고, 결과의 schema, direct-child, edge, risk boundary를 검증합니다.
- `execution-decision-contract.ts`: 실행 판단 계약, validator, V2 to V1 변환을 담당합니다.
- `execution-graph-snapshot.ts`: 현재 에이전트가 볼 수 있는 direct-child 후보, diagnostic 후보, edge, validation issue를 구조화합니다.
- `sub-session-runner.ts`: child 실행 세션 lifecycle과 prompt bundle preflight를 담당합니다.

## 프롬프트와 코드 책임 분리

- prompt file loader와 registry는 `memory/nobie-md.ts`가 담당합니다.
- runtime 사용처별 prompt source 선택과 policy block 렌더링은 `prompt-policy-adapter.ts`가 담당합니다.
- agent prompt bundle 조립은 `prompt-bundle.ts`가 담당합니다.
- execution harness는 자연어 의미를 코드로 검색하지 않고, adapter가 제공한 정책 블록과 구조화된 context block을 모델에 제공합니다.
- 코드가 검증하는 것은 `AgentExecutionDecisionV2` shape, direct-child 여부, 연결 경로, 권한, 위험 경계, 취소 상태입니다.

## 회귀 테스트 규칙

- prompt source 목록, priority, usage scope가 바뀌면 `tests/prompt-source-registry.test.ts`와 `tests/prompt-source-operations.test.ts`를 갱신합니다.
- prompt가 실제 assembled prompt나 execution harness prompt에 포함되어야 하면 `tests/task005-agent-prompt-bundle.test.ts`, `tests/task012-agent-prompt-bundle-preflight.test.ts`, `tests/task013-prompt-policy-adapter.test.ts` 중 관련 테스트를 갱신합니다.
- prompt 내용이 AGENTS.md 정책과 충돌할 수 있으면 `tests/prompt-source-regression.test.ts` 또는 `tests/task013-prompt-policy-adapter.test.ts`에 regression을 추가합니다.
- raw keyword executor routing, default entry fallback, retry limit, max attempts 같은 문구가 실행 정책으로 재도입되면 테스트가 실패해야 합니다.
