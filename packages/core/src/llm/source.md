# source.md

## 역할

- `llm`은 provider 선택과 모델 실행을 추상화합니다.

## 주요 파일

- `index.ts`: provider 등록, 기본 모델 선택, provider 추론, OAuth/API-key 모드 선택
- `types.ts`: 공통 provider와 메시지 계약
- `providers/*`: Anthropic, OpenAI, Gemini 구현

## 메모

- provider 선택은 설정과 실제 사용 가능한 인증 정보에 따라 결정됩니다.
- 이 폴더는 provider 자체 구현에 집중하고, 오케스트레이션은 `agent`와 `runs`에 두는 것이 좋습니다.
