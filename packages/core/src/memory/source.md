# source.md

## 역할

- `memory`는 현재 대화 턴을 넘어서는 지속 컨텍스트를 관리합니다.

## 주요 파일

- `store.ts`: 메모리 저장/검색 API와 프롬프트 문맥 조립
- `journal.ts`: `memory.db3` 실행 저널, FTS 검색, 성공/실패 요약 기록
- `nobie-md.ts`: 워크스페이스 프롬프트 파일과 시스템 프롬프트 파일 로딩
- `compressor.ts`: 문맥 압축 로직
- `embedding.ts`, `search.ts`, `file-indexer.ts`: 시맨틱 검색과 파일 기반 검색 지원

## 메모

- 이 폴더는 사용자/프로젝트 메모리와 실행 참고용 메모리를 함께 다룹니다.
- 메모리 스코프는 `global/session/task`로 분리됩니다. `global`은 장기 기억, `session`은 세션 수준 요약/진행 맥락, `task`는 특정 run의 handoff/실행 메모리입니다.
- 검색 시에는 항상 `global + 현재 session + 현재 run(task)`만 보이게 하여, 다른 child run의 임시 메모리가 자동 누수되지 않도록 합니다.
- 저널 기록은 단순 이력 표시가 아니라 재시도와 후속 판단에 활용되는 것이 목적입니다.
- 실행 저널 FTS 검색은 예약 실행 프롬프트나 경로/시각 문자열이 들어와도 죽지 않도록, 구두점을 제거한 안전 토큰 기반 MATCH 쿼리만 사용하고 실패 시 빈 결과로 폴백합니다.
