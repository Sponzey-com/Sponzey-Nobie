# source.md

## 역할

- `api`는 WebUI에서 백엔드 HTTP와 WebSocket 엔드포인트로 연결되는 브리지입니다.

## 주요 파일

- `client.ts`: 타입 기반 HTTP 호출
- `ws.ts`: WebSocket 연결 생명주기
- `adapters/*`: 응답 형태 보정과 로컬 API 매핑
- `modelDiscovery.ts`: backend/model 탐색 보조 로직

## 메모

- 이 폴더는 전송 계층 역할에 집중하는 것이 좋습니다.
- store는 직접 fetch를 만들기보다 이 계층을 통해 백엔드와 통신해야 합니다.
