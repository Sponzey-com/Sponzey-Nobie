# source.md

## 역할

- `packages/core/src/topology`는 토폴로지 저장, 변환, 검증, 실행자 그래프 projection을 다루는 영역이다.

## 현재 source-of-truth 기준

- 기본 제품 모델은 실행자 노드와 위임 연결선이다.
- `ExecutorGraph`와 `ExecutorTopologyV2` 계열은 신규 source-of-truth 후보이다.
- 노드의 핵심 저장 필드는 id, 표시 이름, 역할명, 성격과 하는 일, 위치, 상태이다.
- 연결선의 핵심 저장 필드는 source node, target node, `delegates_to` 관계, 상태이다.
- `children` 캐시는 저장 기준이 아니라 edge에서 계산되는 projection이어야 한다.

## EnterpriseTopology V1 경계

- `EnterpriseTopology V1`은 구버전 데이터, fixture, import/export, migration compatibility를 위해 남아 있다.
- V1의 조직, 팀, 직책, 사람, 권한, 도구, 시스템 모델은 기본 runtime source-of-truth가 아니다.
- 신규 저장과 실행 결정은 V2 실행자 그래프를 기준으로 해야 한다.
- V1이 필요하면 `legacy-enterprise-topology-adapter.ts` 같은 compatibility adapter 또는 diagnostic 경로로 격리한다.
- 런타임 실행 그래프가 V1 envelope를 읽어야 할 때도 먼저 V2 executor-only read model로 투영한 뒤 사용한다.
- compatibility adapter는 기존 row/fixture의 endpoint 오류나 `children` 불일치 같은 이관 진단만 보존하고, V1 조직/도구/권한 모델을 실행 판단 기준으로 되살리지 않는다.

## 자연어 판단 경계

- topology 코드가 사용자 원문이나 노드 설명을 키워드/regex로 읽어 실행자를 선택하면 안 된다.
- 의미 판단은 prompt/harness가 구조화된 direct child 후보와 노드 정의를 보고 수행한다.
- topology 코드의 책임은 후보 구조화, edge 검증, persistence repair, migration, projection이다.

## 정리 예정

- `executor-graph.ts`에 남아 있는 EnterpriseTopology 변환 책임은 compatibility adapter로 낮춘다.
- `advancedMapping`, `inferredTools`, `inferredOutputs`, `inferredSuccessCriteria`는 projection-only 또는 AI suggestion metadata로 제한한다.
- 기본 runtime 경로에서 V1 compiler/validator가 source-of-truth로 사용되지 않도록 한다.

## 검증 게이트

- 토폴로지 source-of-truth, V1 compatibility, default-entry metadata, stale metadata 정리는 `pnpm run test:architecture:static`과 `pnpm run test:phase026:db`로 확인한다.
- 실행자 그래프 런타임 경로는 `pnpm run test:architecture:runtime`으로 확인한다.
- WebUI 기본 topology route 노출 여부는 `pnpm run test:architecture:webui`로 확인한다.
