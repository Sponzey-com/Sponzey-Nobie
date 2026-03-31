# source.md

## 역할

- `Yeonjang/src`는 연장 런타임의 Rust 구현 루트입니다.

## 중요 단위

- `main.rs`: GUI, stdio, 로컬 실행 진입점 선택
- `mqtt.rs`: MQTT 런타임 루프, 상태 발행, 요청 처리, 청크 응답 전달
- `node.rs`: 요청 dispatch와 권한 게이트
- `gui.rs`: 고정 크기 설정 다이얼로그
- `automation`, `features`, `platform`: 추상화 계층과 OS별 구현

## 메모

- 이 폴더는 전송 계층, UI, 실행 추상화를 비교적 명확히 분리하고 있습니다.
- `node.rs`는 transport와 feature 코드를 잇는 중심 계약 지점입니다.
