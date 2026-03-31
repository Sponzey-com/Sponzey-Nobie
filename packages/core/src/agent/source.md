# source.md

## 역할

- `agent`는 실제 시스템 프롬프트를 구성하고 메인 LLM 루프를 실행합니다.

## 주요 파일

- `index.ts`: `runAgent()` 구현, 시스템 프롬프트 로딩, 도구 라운드, 복구 신호 처리
- `intake.ts`: 본 실행 전 요청 분류와 intake 분석
- `intake-prompt.ts`: intake 프롬프트 구조와 정책
- `completion-review.ts`: 작업이 실제로 끝났는지 판정
- `request-group-context.ts`: request-group 범위에 맞는 문맥만 추림
- `profile-context.ts`: 사용자 기본정보를 프롬프트 문맥에 주입

## 메모

- 이 폴더는 프롬프트 정책과 실제 실행을 잇는 경계입니다.
- 너무 빨리 완료되거나, 쓸데없이 묻거나, 잘못 라우팅되는 문제는 여기서 시작되는 경우가 많습니다.
- intake heuristic은 단순 지연 실행뿐 아니라 현재 세션의 활성 예약 알림 목록 조회와 예약 취소도 먼저 잡아, run 취소와 예약 취소를 헷갈리지 않게 합니다.
- 예약/알림 관리 문장은 한국어뿐 아니라 `schedule`, `reminder`, `notification`, `alarm` 같은 영어 표현도 같은 경로로 해석합니다.
