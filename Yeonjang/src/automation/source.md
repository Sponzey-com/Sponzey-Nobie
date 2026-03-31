# source.md

## 역할

- `automation`은 Yeonjang feature 핸들러가 사용하는 백엔드 추상화를 정의합니다.

## 책임

- capability 플래그와 공통 작업 계약을 정의합니다.
- OS별 backend가 달라도 feature 코드가 안정적으로 유지되게 합니다.

## 메모

- 이 폴더는 OS 비의존적으로 유지하는 것이 맞습니다.
- 플랫폼 전용 동작은 여기보다 `platform`에 두어야 합니다.
