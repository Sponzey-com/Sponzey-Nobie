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
- LLM이 어떤 능력을 “알고는 있는데” 실제 실행이 잘 안 되면 보통 `agent` 다음으로 이 폴더를 봐야 합니다.
