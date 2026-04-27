# source.md

## 역할

- `memory`는 현재 대화 턴을 넘어서는 지속 컨텍스트를 관리합니다.

## 주요 파일

- `store.ts`: 메모리 저장/검색 API와 프롬프트 문맥 조립
- `journal.ts`: `memory.db3` 실행 저널, FTS 검색, 성공/실패 요약 기록
- `nobie-md.ts`: 워크스페이스 메모리 파일과 `prompts/` 기반 시스템 프롬프트 source 로딩
- `compressor.ts`: 문맥 압축 로직
- `embedding.ts`, `search.ts`, `file-indexer.ts`: 시맨틱 검색과 파일 기반 검색 지원

## 메모

- 이 폴더는 사용자/프로젝트 메모리와 실행 참고용 메모리를 함께 다룹니다.
- 메모리 스코프는 `global/session/task/artifact/diagnostic`로 분리됩니다. `global`은 장기 기억, `session`은 세션 수준 요약/진행 맥락, `task`는 request group 또는 run 단위 handoff/실행 메모리입니다.
- 메모리는 `memory_documents`와 `memory_chunks`로 저장하고, `memory_chunks_fts`로 빠른 FTS 검색을 수행합니다. document checksum은 원문 기준 중복 저장 방지에 사용하고, chunk checksum은 embedding cache의 입력 식별에 사용합니다.
- 검색 시에는 항상 `global + 현재 session + 현재 request group/run(task)`만 보이게 하여, 다른 세션이나 child run의 임시 메모리가 자동 누수되지 않도록 합니다. `artifact/diagnostic`은 명시적으로 포함할 때만 검색 대상이 됩니다.
- prompt에 주입되는 검색 결과는 `buildMemoryInjectionContext`의 budget을 통과해야 합니다. 기본적으로 chunk 수, 전체 글자 수, chunk별 글자 수를 제한하고, 원문 전체가 아니라 source id, score, 날짜, 제한된 snippet만 넣습니다.
- 일반 요청에서는 diagnostic memory가 prompt에 들어가지 않습니다. 사용자가 오류, 로그, 진단, 실패 원인처럼 명시적 진단 의도를 표현한 경우에만 `includeDiagnostic` 경로가 열립니다.
- request group context는 sibling child run의 raw tool result와 내부 메시지를 자동 주입하지 않습니다. handoff가 필요한 내용은 task memory나 task continuity로 요약된 값만 사용합니다.
- 검색 결과에는 chunk id, source(`fts/vector/hybrid/like`), score, latency가 포함되어 후속 run이 어떤 기억을 참조했는지 `memory_access_log`로 추적할 수 있습니다.
- vector 검색은 optional입니다. embedding provider가 없거나 실패하면 `fts`/`like` 검색으로 degrade되어 사용자 요청 자체를 중단하지 않습니다.
- hybrid 검색의 vector 경로는 timeout이 발생하면 빈 결과로 degrade하고, FTS 결과만으로 계속 진행합니다. vector timeout은 run failure로 취급하지 않습니다.
- run id가 있는 검색에서는 source별 최대 검색 latency를 `memory_fts_ms`, `memory_vector_ms`, `memory_hybrid_ms`, `memory_like_ms` 형태의 run event로 남깁니다. event 기록 실패는 검색 결과를 막지 않습니다.
- `nobie-md.ts`의 runtime prompt assembly는 prompt source checksum, locale, source state, policy version을 cache key로 사용합니다. prompt source가 바뀌지 않으면 같은 assembly를 재사용합니다.
- `nobie-md.ts`의 first-run fallback prompt seed는 `prompts/` source가 없을 때도 서브 에이전트 hierarchy, `CommandRequest`/`DataExchangePackage`/`ResultReport`/`FeedbackRequest`, nickname attribution, team expansion 기본 규칙을 포함해야 합니다.
- 실행 종료 경로는 `memory_writeback_queue`, `session_snapshots`, `task_continuity`에 instruction/success/failure 후보를 조용히 기록합니다. writeback 실패는 사용자 채널에 노출하지 않고 실행 완료 판정도 직접 막지 않습니다.
- session snapshot은 후속 run이 열린 task id와 마지막 성공 요약을 회수할 수 있게 유지합니다. task continuity는 같은 request group의 handoff summary와 실패 복구 근거를 남기는 경계입니다.
- 저널 기록은 단순 이력 표시가 아니라 재시도와 후속 판단에 활용되는 것이 목적입니다.
- 실행 저널 FTS 검색은 예약 실행 프롬프트나 경로/시각 문자열이 들어와도 죽지 않도록, 구두점을 제거한 안전 토큰 기반 MATCH 쿼리만 사용하고 실패 시 빈 결과로 폴백합니다.
