# source.md

## 역할

- `Yeonjang/src`는 연장 런타임의 Rust 구현 루트입니다.

## 중요 단위

- `main.rs`: GUI, stdio, 로컬 실행 진입점 선택
- `mqtt.rs`: MQTT 런타임 루프, 상태 발행, 요청 처리, 청크 응답 전달
- `node.rs`: 요청 dispatch, 권한 게이트, 액션 기반 메서드 진입점
- `gui.rs`: 고정 크기 설정 다이얼로그
- `automation`, `features`, `platform`: 추상화 계층과 OS별 구현

## 메모

- 이 폴더는 전송 계층, UI, 실행 추상화를 비교적 명확히 분리하고 있습니다.
- `node.rs`는 transport와 feature 코드를 잇는 중심 계약 지점입니다.
- `gui.rs`는 MQTT 연결 상태를 보고, 끊김 뒤 `다시 연결` 동작을 바로 제공해야 합니다.
- Windows 실행 파일은 콘솔 창이 뜨지 않도록 GUI 서브시스템으로 빌드합니다.
- MQTT 상태와 capability는 시작 시 1회, 그리고 각 요청 처리 전후에 다시 발행해 현재 도구 상태를 갱신합니다.
- 마우스와 키보드는 세부 메서드와 함께 `mouse.action`, `keyboard.action`을 공통 진입점으로 받습니다.
- macOS backend는 `screen.capture`, `mouse.move`, `mouse.click`, `mouse.action`, `keyboard.type`, `keyboard.action`을 platform helper로 처리합니다.
- macOS `camera.capture`는 앱 번들 내부의 고정 helper executable을 사용하고, helper 소스는 `Yeonjang/helpers/macos/` 아래에 둡니다.
- Windows `camera.capture`도 이제 `Yeonjang --camera-capture-helper` 고정 진입점을 사용하고, `device_id`가 있으면 WinRT `MediaCapture` 경로로 분기합니다.
