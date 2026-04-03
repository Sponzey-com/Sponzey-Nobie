# source.md

## 역할

- `tools`는 LLM과 runs 계층이 사용할 실행 가능 능력 표면을 정의합니다.

## 주요 파일

- `index.ts`: 내장 도구 등록
- `dispatcher.ts`: 도구 조회, 승인 강제, 실행 dispatch, audit 연동
- `types.ts`: 도구 계약
- `builtin/*`: 파일, shell, 검색, 앱, 프로세스, 메모리, UI, Telegram 전송, Yeonjang 브리지 도구

## 메모

- 이 폴더는 승인, 위험도, fallback 정책이 시작되는 곳이라 정책 민감도가 높습니다.
- 승인 거부는 `user`, `timeout`, `system` 사유를 분리해서 처리하고, 타임아웃을 사용자 취소로 오인하지 않도록 `runs` 취소 요약에도 그 사유를 전달합니다.
- 전달형 도구는 성공 여부를 출력 문자열에 숨기지 않고, 가능한 한 구조화된 `details`를 함께 반환해서 채널/실행 루프가 액션 결과를 직접 해석할 수 있어야 합니다.
- `telegram_send_file`은 이제 `.txt/.md/.json/.csv/.pdf` 같은 문서형 결과를 무조건 허용하지 않고, 사용자가 파일/문서 첨부를 명시적으로 요청한 경우에만 허용합니다. 단순 확인/요약/상태 결과는 일반 메시지 전달이 기본입니다.
- `keyboard_shortcut`은 Yeonjang이 `keyboard.action`을 지원하면 그 경로를 먼저 사용하고, 전달 계약은 `action=shortcut`, `key`, `modifiers`로 정리합니다.
- `mouse_action`, `keyboard_action`은 Yeonjang의 action 기반 capability를 직접 노출하는 공통 진입점입니다.
- `shell_exec`, `app_launch`, `process_kill`, `screen_capture`, `mouse_*`, `keyboard_*`, `window_focus`는 이제 Yeonjang 전용 실행 경계입니다. 연결된 연장이나 capability가 없으면 코어 로컬 fallback 대신 명시적 실패로 끝납니다.
- AI가 어떤 능력을 “알고는 있는데” 실제 실행이 잘 안 되면 보통 `agent` 다음으로 이 폴더를 봐야 합니다.
