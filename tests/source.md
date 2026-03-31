# source.md

## 역할

- `tests`는 오케스트레이션 로직과 프롬프트/라우팅 동작에 대한 회귀 테스트를 담습니다.

## 주된 검증 범위

- intake 휴리스틱과 intake 프롬프트 동작
- run 라우팅과 scheduled-run 정책
- completion review와 instruction merge 동작
- MCP와 provider 관련 예외 케이스

## 메모

- 테스트는 전반적으로 백엔드 중심입니다.
- 요청 해석, 복구 루프, 완료 판정 로직을 바꿀 때 특히 중요합니다.
