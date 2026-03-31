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

- a native `egui/eframe` desktop settings window
- a newline-delimited JSON stdio protocol
- a request dispatcher
- implemented methods for:
  - `node.ping`
  - `node.capabilities`
  - `system.info`
  - `system.exec`
  - `camera.list` on macOS
  - `camera.capture` on macOS
- planned method stubs for:
  - `system.control`
  - `application.launch`
  - `screen.capture`
  - `mouse.move`
  - `mouse.click`
  - `keyboard.type`

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
- `system.exec` supports direct command execution and shell-based execution.
- `system.exec` now respects the Yeonjang permission toggle. If `명령 실행 / Command Execution` is off, request handling returns a permission error.
- camera support is the first platform feature to implement on top of the abstraction layer.
- macOS camera capture uses an AVFoundation-based Swift helper and expects the bundled app manifest to contain camera usage descriptions.
- macOS permission manifests live under `Yeonjang/manifests/macos/`.
- screen / keyboard / mouse methods remain scaffolded and can be connected to platform-specific crates next.
