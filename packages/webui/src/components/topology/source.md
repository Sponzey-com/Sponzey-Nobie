# source.md

## 역할

- `packages/webui/src/components/topology`는 사용자가 실행자 노드를 그리고, 연결하고, 선택한 노드를 정의하는 UI 컴포넌트 영역이다.

## 기본 topology UX 기준

- 기본 topology 화면은 실행자 노드와 위임 연결선이 중심이다.
- 사용자가 항상 볼 기본 조작은 노드 추가, 노드 삭제, 저장, 화면 맞춤 또는 자동 배치 정도로 제한한다.
- 선택한 실행자 카드에는 이름, 역할명, 성격과 하는 일, AI 제안, 저장 흐름을 우선 둔다.
- 실행 흐름은 사용자가 붙인 실행자 이름과 연결 경로로 표시한다.
- raw executor id, request group uuid, 내부 route code는 기본 UI가 아니라 diagnostic UI에서만 보여준다.

## 고급/레거시 컴포넌트 경계

- `EnterpriseTopologyPalette`, `EnterpriseTopologyInspector`, `EnterpriseTopologyCanvas`는 EnterpriseTopology V1 compatibility 또는 legacy/admin/diagnostic 경로로 격리해야 한다.
- 이 컴포넌트들은 `LegacyEnterpriseTopologyPage` 계열에서만 조합하고 기본 `TopologyWorkspacePage` import graph로 끌어오지 않는다.
- 기본 route인 `TopologyWorkspacePage`는 V1 palette/inspector/page를 직접 import하지 않아야 한다.
- WorkOrder Template, Context, compile preview, manual run launcher는 기본 topology UX에 노출하지 않는다.

## 컴포넌트 책임

- React 컴포넌트는 view model을 표시하고 사용자 action을 dispatch한다.
- 실행자 선택, 후보 판단, 위험 경계 판단은 WebUI에서 구현하지 않는다.
- API response를 화면용 view model로 바꾸는 작업은 `packages/webui/src/lib`에 둔다.
- canvas와 inspector는 DB/runtime source-of-truth를 임의로 재해석하지 않는다.

## 정리 예정

- 기본 UI와 diagnostic UI를 컴포넌트 계층에서 분리한다.
- EnterpriseTopology V1 타입과 컴포넌트 의존을 기본 bundle에서 제거한다.
- Runtime Inspector와 task monitor는 사용자 이름/역할명 중심 view model로 정리한다.

## 검증 게이트

- 기본 topology 컴포넌트 변경은 `pnpm run test:architecture:webui`를 기준으로 검증한다.
- `EnterpriseTopologyPalette`, `EnterpriseTopologyInspector`, `EnterpriseTopologyCanvas`, WorkOrder/manual run, compile preview가 기본 route로 다시 들어오면 architecture static/webui gate가 실패해야 한다.
- 실행자 선택, 자연어 의미 판단, 위험 경계 판단을 React 컴포넌트 안에 넣는 변경은 금지한다. 필요한 판단은 core API/use case와 prompt/harness 계약으로 이동한다.
