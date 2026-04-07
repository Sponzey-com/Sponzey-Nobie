# source.md

## 역할

- `ai`는 설정에서 연결한 AI backend 선택과 모델 실행을 추상화합니다.

## 주요 파일

- `index.ts`: 활성 AI 연결 해석, provider 인스턴스 생성, OAuth/API-key 모드 선택
- `types.ts`: 공통 provider와 메시지 계약
- `providers/*`: Anthropic, OpenAI, Gemini 구현

## 메모

- provider 선택은 `ai.connection` 하나와 실제 사용 가능한 인증 정보에 따라 결정됩니다.
- 기본 provider/model fallback은 더 이상 없습니다. intake, execution, review, recovery는 모두 같은 활성 AI 연결만 사용합니다.
- 환경변수만으로 외부 AI backend를 암묵 활성화하지 않습니다.
- 따라서 Anthropic/OpenAI/Gemini 이름이나 기본 모델 문자열이 남아 있어도, 설정에서 연결하지 않았다면 Nobie가 그 backend를 암묵 호출하지 않습니다.
- provider 획득 실패는 더 이상 기본 모델 문자열로 숨기지 않고, 연결된 AI가 없다는 명시적 설정 오류로 드러냅니다.
- 이 폴더는 OpenAI, Anthropic, Gemini 같은 backend adapter 구현에 집중합니다.
- Anthropic 계열 backend도 설정 기반 `provider:anthropic` 경로로만 사용하고, worker runtime 명령을 다른 AI/CLI로 치환하는 환경변수 override도 두지 않습니다.
- 자연어 해석, 재시도, 복구, 완료 판정 같은 오케스트레이션은 `agent`와 `runs`가 맡습니다.
- 즉 이 폴더는 별도 외부 자연어 엔진 행위자가 아니라, Nobie가 사용하는 내부 AI backend 구현 계층입니다.
