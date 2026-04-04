# source.md

## 역할

- `platform`은 OS별 자동화 backend를 제공합니다.

## 주요 파일

- `macos.rs`: 현재 가장 많이 구현된 경로
- `windows.rs`: 명령 실행, 앱 실행, 카메라 list/capture, 화면 캡처, 마우스/키보드, system control 일부 구현
- `linux.rs`: 골격 또는 부분 구현
- `shared.rs`: OS backend 사이에서 공통으로 쓰는 보조 함수
- `mod.rs`: backend 선택

## 메모

- capability 사용 가능 여부는 OS 지원 여부와 현재 권한 설정에 함께 의존합니다.
- 새 장치/시스템 기능은 추상화 정의 뒤에 보통 이 폴더 구현이 따라와야 합니다.
- macOS 카메라 캡처는 이제 임시 Swift 스크립트가 아니라 앱 번들 안의 고정 helper executable 경로를 사용합니다.
- Windows 카메라 캡처도 이제 `Yeonjang --camera-capture-helper` 고정 경로를 사용합니다.
- Windows `camera.list`는 WinRT video capture device id를 우선 노출해서 `camera.capture(device_id=...)`와 같은 id 축을 씁니다.
