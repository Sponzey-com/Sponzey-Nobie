# source.md

## 역할

- `packages`는 런타임에서 함께 동작하는 JavaScript/TypeScript 패키지 모음입니다.

## 패키지 구성

- `core`: 메인 백엔드이자 오케스트레이션 런타임
- `webui`: 설정, 채팅, 모니터링, 승인을 위한 브라우저 UI
- `cli`: `core`를 감싼 명령줄 인터페이스와 서비스 관리 도구

## 의존 관계

- `cli`는 `@nobie/core`에 의존합니다.
- `webui`는 HTTP와 WebSocket API로 `core`와 통신합니다.
- `core`는 AI, 도구, 메모리, 스케줄링, Telegram, MQTT, Yeonjang을 통합하는 중심점입니다.