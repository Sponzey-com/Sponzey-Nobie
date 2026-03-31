# source.md

## 역할

- `commands`는 실제 CLI 서브커맨드 구현을 담습니다.

## 중요 명령

- `run.ts`: 에이전트에 직접 메시지 전송
- `serve.ts`: 데몬 시작과 PID/로그 상태 기록
- `schedule.ts`: 저장된 스케줄 1회 실행, system scheduler에서 호출하는 진입점
- `config.ts`: 설정 초기화와 인증 토큰 보조 기능
- `service/*`: OS 서비스 래퍼
- `memory.ts`, `index-cmd.ts`, `plugin.ts`: 유지보수용 유틸리티

## 메모

- `serve.ts`는 CLI 시작을 백엔드 런타임 부트스트랩으로 이어주는 중요한 연결점입니다.
