# source.md

## 역할

- `platform`은 OS별 자동화 backend를 제공합니다.

## 주요 파일

- `macos.rs`: 화면/카메라/입력 자동화와 system control이 구현된 주 경로
- `windows.rs`: 명령 실행, 앱 실행, 카메라 list/capture, 화면 캡처, 마우스/키보드, 로컬 system control 구현
- `linux.rs`: 외부 도구 기반의 앱 실행, 카메라, 화면 캡처, 마우스/키보드, 로컬 system control 구현
- `shared.rs`: OS backend 사이에서 공통으로 쓰는 보조 함수
- `mod.rs`: backend 선택

## 메모

- capability 사용 가능 여부는 OS 지원 여부와 현재 권한 설정에 함께 의존합니다.
- 새 장치/시스템 기능은 추상화 정의 뒤에 보통 이 폴더 구현이 따라와야 합니다.
- macOS 카메라 캡처는 이제 임시 Swift 스크립트가 아니라 앱 번들 안의 고정 helper executable 경로를 사용합니다.
- macOS `system.control`은 로컬 lock, sleep, logout, restart, shutdown을 처리합니다.
- Windows 카메라 캡처도 이제 `Yeonjang --camera-capture-helper` 고정 경로를 사용합니다.
- Windows `camera.list`는 WinRT video capture device id를 우선 노출해서 `camera.capture(device_id=...)`와 같은 id 축을 씁니다.
- Windows `system.control`은 로컬 lock, sleep, hibernate, sign-out, restart, shutdown을 처리합니다.
- Linux backend는 OS API 직접 바인딩이 아니라 설치된 도구를 이용하는 best-effort 경로입니다.
- Linux `camera.list`는 `v4l2-ctl`과 `/dev/video*`를 사용하고, `camera.capture`는 `ffmpeg` 또는 `fswebcam`을 사용합니다.
- Linux `screen.capture`는 `grim`, `gnome-screenshot`, `scrot`, ImageMagick `import` 중 사용 가능한 도구를 사용합니다. display index 선택은 아직 명시적으로 지원하지 않고 전체 화면 캡처만 처리합니다.
- Linux 마우스/키보드 입력은 `xdotool`에 의존합니다.
- Linux `system.control`은 `loginctl`, `systemctl`, `xdg-screensaver`, `gnome-session-quit`, `shutdown` 중 사용 가능한 도구로 로컬 lock, sleep, hibernate, logout, restart, shutdown을 처리합니다.
