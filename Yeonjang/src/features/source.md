# source.md

## 역할

- `features`는 Yeonjang 프로토콜로 노출되는 사용자 가시 실행 기능을 담습니다.

## 주요 파일

- `camera.rs`
- `screen.rs`
- `system.rs`
- `mouse.rs`
- `keyboard.rs`

## 메모

- feature 핸들러는 파라미터를 해석하고 automation backend를 호출합니다.
- 권한 체크는 `node.rs`에서 수행하므로, 이 파일들은 실제 동작에 집중합니다.
- 마우스와 키보드는 세부 메서드 외에도 `mouse.action`, `keyboard.action` 공통 진입점을 제공합니다.
- `keyboard.action`은 단축키 같은 액션 기반 입력을 `action`, `key`, `modifiers`로 전달받고, backend가 지원하는 경우 `shortcut` 경로로 실행합니다.
