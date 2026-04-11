# Yeonjang

`Yeonjang` is a Rust-based extension node for Nobie.

The node is intended to handle local-device and operating-system level work that is better separated from the main Nobie gateway process, including:

- camera management
- system control
- shell / command execution
- screen control
- keyboard control
- mouse control

## Current State

This initial scaffold provides:

- a native `iced` desktop settings window
- a newline-delimited JSON stdio protocol
- a request dispatcher
- implemented methods for:
  - `node.ping`
  - `node.capabilities`
  - `system.info`
  - `system.exec`
  - `application.launch` on macOS
  - `application.launch` on Windows
  - `application.launch` on Linux
  - `camera.list` on macOS
  - `camera.capture` on macOS
  - `camera.list` on Windows
  - `camera.capture` on Windows
  - `camera.list` on Linux
  - `camera.capture` on Linux
  - `screen.capture` on macOS
  - `screen.capture` on Windows
  - `screen.capture` on Linux
  - `mouse.move` on macOS
  - `mouse.click` on macOS
  - `mouse.action` move / click / double_click / button_down / button_up / scroll on macOS
  - `mouse.move` on Windows
  - `mouse.click` on Windows
  - `mouse.action` move / click / double_click / button_down / button_up / scroll on Windows
  - `mouse.move` on Linux
  - `mouse.click` on Linux
  - `mouse.action` move / click / double_click / button_down / button_up / scroll on Linux
  - `keyboard.type` on macOS
  - `keyboard.action` shortcut / key_press / key_down / key_up on macOS
  - `keyboard.type` on Windows
  - `keyboard.action` shortcut / key_press / key_down / key_up on Windows
  - `keyboard.type` on Linux
  - `keyboard.action` shortcut / key_press / key_down / key_up on Linux
  - `system.control` on macOS
  - `system.control` on Windows
  - `system.control` on Linux

## Priority

The current implementation priority is:

1. `camera.list`
2. `camera.capture`
3. `application.launch`
4. `screen.capture`
5. `mouse.move` / `mouse.click`
6. `keyboard.type`
7. `system.control`

## Run

```bash
cargo run --manifest-path Yeonjang/Cargo.toml
```

GUI 기본 실행 시 설정 화면이 열립니다.

stdio 노드 모드:

```bash
cargo run --manifest-path Yeonjang/Cargo.toml -- --stdio
```

로컬 셸 명령 실행 테스트:

```bash
cargo run --manifest-path Yeonjang/Cargo.toml -- --exec "pwd && whoami"
```

쉘 없이 프로그램 직접 실행:

```bash
cargo run --manifest-path Yeonjang/Cargo.toml -- --exec-bin /bin/echo hello
```

## Request Format

Each request is a single JSON object per line.

```json
{
  "id": "req-1",
  "method": "system.info",
  "params": {}
}
```

Each response is emitted as a single JSON object per line.

```json
{
  "id": "req-1",
  "ok": true,
  "result": {
    "node": "nobie-yeonjang"
  }
}
```

## Notes

- GUI는 네이티브 앱으로 열리며 Windows, Linux, macOS에서 작업 표시줄 또는 Dock에 나타나는 형태를 기본 전제로 합니다.
- 설정 화면에는 broker 접속 정보, 자동 접속, 시스템 시작 시 실행, node id, MQTT topic, 권한 토글이 포함됩니다.
- `system.exec` supports direct command execution and shell-based execution, and now receives environment variables and timeout hints from Nobie.
- `system.exec` now respects the Yeonjang permission toggle. If `명령 실행 / Command Execution` is off, request handling returns a permission error.
- `application.launch` now respects its own Yeonjang permission toggle.
- camera support is the first platform feature to implement on top of the abstraction layer.
- macOS camera capture uses a bundled AVFoundation helper executable placed next to `Yeonjang.app/Contents/MacOS/Yeonjang`.
- 그래서 macOS 카메라 캡처는 임시 `xcrun swift` 스크립트가 아니라, `scripts/build-yeonjang-macos.sh` 또는 `scripts/start-yeonjang-macos.sh`로 만든 앱 번들 실행 경로를 기준으로 동작합니다.
- macOS permission manifests live under `Yeonjang/manifests/macos/`.
- macOS screen capture uses a Swift helper backed by `screencapture`.
- macOS mouse actions use a CoreGraphics Swift helper and require Accessibility permission.
- macOS keyboard input uses `System Events` for text typing and CoreGraphics events for key press / down / up actions.
- macOS system control supports local lock, sleep, logout, restart, and shutdown requests.
- Windows screen capture currently uses PowerShell with `System.Windows.Forms` and `System.Drawing`.
- Windows camera capture now uses the fixed `Yeonjang --camera-capture-helper` path.
- When `device_id` is provided on Windows, Yeonjang uses WinRT `MediaCapture` for explicit device capture.
- When `device_id` is omitted on Windows, Yeonjang falls back to the built-in Windows camera UI.
- Windows mouse and keyboard actions currently use PowerShell with `user32.dll` calls.
- Windows system control supports local lock, sleep, hibernate, sign-out, restart, and shutdown requests.
- Linux camera list uses `v4l2-ctl --list-devices` when available and also scans `/dev/video*`.
- Linux camera capture requires either `ffmpeg` or `fswebcam` in `PATH`.
- Linux screen capture requires one of `grim`, `gnome-screenshot`, `scrot`, or ImageMagick `import` in `PATH`; display index selection is not implemented yet on Linux.
- Linux mouse and keyboard automation require `xdotool` in `PATH`.
- Linux system control supports local lock, sleep, hibernate, logout, restart, and shutdown through `loginctl`, `systemctl`, `xdg-screensaver`, `gnome-session-quit`, or `shutdown` depending on the installed desktop/systemd tooling.
