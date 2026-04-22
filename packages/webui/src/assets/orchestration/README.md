# Orchestration Visual Assets

이 디렉터리는 `.design/agent-map-design`에서 제품 코드로 승격되는 자산의 기준점을 담는다.

원칙:

- 제품 구현은 외부 CDN 폰트나 아이콘을 직접 참조하지 않는다.
- 시각 자산은 로컬 번들, deterministic CSS/vector token, 또는 repo 안의 정적 파일만 사용한다.
- avatar, badge, lane decoration은 가능한 한 seed 기반 CSS/vector token으로 해결한다.
- 실제 일러스트 파일이 필요한 경우에도 이 디렉터리 아래에 두고 import 경로를 명시한다.

1차 태스크 기준:

- 폰트는 네트워크 import 대신 local-first stack으로 정의한다.
- avatar는 deterministic seed와 토큰 팔레트로 렌더링한다.
- 배경 패턴은 CSS gradient와 border/shadow token을 우선 사용한다.
