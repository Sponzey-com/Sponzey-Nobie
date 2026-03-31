# source.md

## 역할

- `automation`은 Yeonjang feature 핸들러가 사용하는 백엔드 추상화를 정의합니다.

## 책임

- capability 플래그와 공통 작업 계약을 정의합니다.
- OS별 backend가 달라도 feature 코드가 안정적으로 유지되게 합니다.
- `mouse.action`, `keyboard.action` 같은 액션 기반 입력 계약을 공통 request/result로 정의합니다.

## 메모

- 이 폴더는 OS 비의존적으로 유지하는 것이 맞습니다.
- 플랫폼 전용 동작은 여기보다 `platform`에 두어야 합니다.
- 액션 기반 메서드는 먼저 이 추상화에서 정의하고, OS별 backend는 필요한 액션만 순차적으로 구현하는 구조입니다.
