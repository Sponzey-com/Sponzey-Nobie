# source.md

## 역할

- `db`는 SQLite 초기화, 마이그레이션, 타입 기반 헬퍼 쿼리를 담당합니다.

## 주요 파일

- `index.ts`: 연결 생명주기와 session, message, run, schedule, memory, channel ref, audit log 헬퍼
- `migrations.ts`: 스키마 변경 이력

## 메모

- run 상태, 메시지 이력, 스케줄 이력, Telegram 메시지 참조, 메모리가 모두 여기서 만납니다.
- `better-sqlite3`를 동기 방식으로 쓰므로 헬퍼 함수도 비교적 직접적인 형태입니다.
