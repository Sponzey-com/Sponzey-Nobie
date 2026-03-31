# source.md

## 역할

- `packages/cli/src`는 CLI 구현 루트입니다.

## 주요 파일

- `index.ts`: commander 기반 명령 등록과 진입점
- `commands/*`: 개별 명령 구현

## 메모

- 대부분의 명령은 최소한의 인자 처리만 한 뒤 `@nobie/core`로 위임합니다.
