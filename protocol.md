# Nobie-Yeonjang MQTT Protocol

이 문서는 `Nobie`와 `Yeonjang`이 통신할 때 사용하는 MQTT 기반 프로토콜만 정의합니다.

핵심 원칙:

- `Nobie`와 `Yeonjang`의 통신은 오직 `MQTT topic`을 통해서만 이루어집니다.
- 메시지 본문은 모두 `JSON`입니다.
- 이미지나 기타 바이너리 데이터는 `base64` 문자열로 JSON 안에 포함해 전송할 수 있습니다.
- 요청과 응답은 항상 `id`로 연결합니다.
- 파일이나 바이너리 데이터를 전달할 때는 수신자가 검증할 수 있도록 메타데이터를 함께 포함해야 합니다.
- 각 연장은 반드시 `유일한 extensionId`를 가져야 합니다.
- 같은 MQTT broker 안에서 `extensionId`가 충돌하면 안 됩니다.
- `extensionId`가 충돌하면 topic 경로와 응답 상관관계가 섞이므로 잘못된 연장으로 요청이 전달될 수 있습니다.

## 1. 기본 구조

모든 요청과 응답은 아래 3종 topic을 중심으로 처리합니다.

- `request`
- `response`
- `event`

상태와 기능 목록은 별도 topic으로 제공합니다.

- `status`
- `capabilities`

## 2. Topic 규칙

`extensionId` 규칙:

- `extensionId`는 연장을 식별하는 고유 ID입니다.
- 하나의 Nobie MQTT broker에 연결되는 모든 연장은 서로 다른 `extensionId`를 사용해야 합니다.
- 이미 사용 중인 `extensionId`를 다른 연장이 다시 사용해서는 안 됩니다.
- `extensionId` 충돌은 설정 오류로 간주합니다.
- 같은 `extensionId`로 뒤늦게 접속한 연장은 broker가 강제로 연결을 해지해야 합니다.
- 먼저 연결되어 정상 동작 중인 연장의 연결은 유지합니다.

기본 prefix:

```text
nobie/v1/node/<extensionId>/
```

기본 topic:

```text
nobie/v1/node/<extensionId>/status
nobie/v1/node/<extensionId>/capabilities
nobie/v1/node/<extensionId>/request
nobie/v1/node/<extensionId>/response
nobie/v1/node/<extensionId>/event
```

예시:

```text
nobie/v1/node/yeonjang-main/status
nobie/v1/node/yeonjang-main/capabilities
nobie/v1/node/yeonjang-main/request
nobie/v1/node/yeonjang-main/response
nobie/v1/node/yeonjang-main/event
```

## 3. Topic 역할

### 3.1 `status`

```text
nobie/v1/node/<extensionId>/status
```

용도:

- Yeonjang 현재 접속 상태
- online/offline/ready/error 상태 보고

권장:

- retained 사용
- last will 사용

예시:

```json
{
  "extension_id": "yeonjang-main",
  "state": "online",
  "message": "ready",
  "version": "0.1.0"
}
```

### 3.2 `capabilities`

```text
nobie/v1/node/<extensionId>/capabilities
```

용도:

- Yeonjang이 처리할 수 있는 메서드 공지

권장:

- retained 사용

예시:

```json
{
  "extension_id": "yeonjang-main",
  "methods": [
    { "name": "node.ping", "implemented": true },
    { "name": "node.capabilities", "implemented": true },
    { "name": "system.info", "implemented": true },
    { "name": "system.exec", "implemented": true },
    { "name": "camera.list", "implemented": true },
    { "name": "camera.capture", "implemented": true }
  ]
}
```

### 3.3 `request`

```text
nobie/v1/node/<extensionId>/request
```

용도:

- Nobie가 Yeonjang에 작업 요청 전달

### 3.4 `response`

```text
nobie/v1/node/<extensionId>/response
```

용도:

- Yeonjang이 Nobie에 최종 성공/실패 응답 반환

원칙:

- 모든 최종 응답은 반드시 `response`로 보냅니다.
- 응답에는 반드시 요청의 `id`가 포함되어야 합니다.
- 응답이 너무 커서 한 번에 전송하기 어려운 경우, 같은 `response` topic에서 청크 envelope 여러 개로 나눠 보낼 수 있습니다.
- 청크 응답도 반드시 같은 요청의 `id`를 포함해야 합니다.

### 3.5 `event`

```text
nobie/v1/node/<extensionId>/event
```

용도:

- 진행 상태
- 중간 로그
- 디버그 이벤트

원칙:

- 최종 결과는 `event`가 아니라 `response`에 담습니다.

## 4. 요청 JSON 형식

모든 요청은 아래 구조를 따릅니다.

```json
{
  "id": "req-1001",
  "method": "system.exec",
  "params": {}
}
```

필드:

- `id`
  - 필수
  - 요청/응답 상관관계 식별자
- `method`
  - 필수
  - 실행할 메서드 이름
- `params`
  - 선택
  - 메서드별 입력값
  - 비어 있으면 `{}` 사용

## 5. 응답 JSON 형식

성공 응답:

```json
{
  "id": "req-1001",
  "ok": true,
  "result": {
    "message": "done"
  }
}
```

실패 응답:

```json
{
  "id": "req-1001",
  "ok": false,
  "error": {
    "code": "request_failed",
    "message": "permission denied"
  }
}
```

필드:

- `id`
  - 요청과 동일한 값
- `ok`
  - 성공 여부
- `result`
  - 성공 시 결과 객체
- `error`
  - 실패 시 오류 객체
  - `code`, `message` 포함

## 5.1 파일/바이너리 응답 메타데이터 규칙

파일, 이미지, 스크린샷, 카메라 캡처처럼 바이너리 데이터를 전달하는 응답은 아래 메타데이터를 함께 포함해야 합니다.

- `file_name`
  - 파일명
- `file_extension`
  - 확장자
- `mime_type`
  - MIME 유형
- `size_bytes`
  - 원본 파일 크기
- `transfer_encoding`
  - 전달 방식
  - 예: `base64`, `file`
- `base64_data`
  - JSON 안에 직접 넣는 바이너리 데이터
  - `transfer_encoding = "base64"`일 때 사용
- `output_path`
  - 연장 로컬 장치 쪽 저장 경로
  - 파일 저장 방식일 때 사용

권장 원칙:

- 수신자는 `mime_type`, `file_extension`, `size_bytes`를 보고 데이터 무결성과 처리 방식을 판단할 수 있어야 합니다.
- `base64_data`만 보내더라도 `file_name`, `file_extension`, `mime_type`, `size_bytes`, `transfer_encoding`을 같이 보내야 합니다.
- 파일 저장 경로를 보내는 경우에도 같은 메타데이터를 같이 보내야 합니다.

예시:

```json
{
  "id": "req-2201",
  "ok": true,
  "result": {
    "output_path": "/tmp/yeonjang-screen-174.png",
    "file_name": "yeonjang-screen-174.png",
    "file_extension": "png",
    "mime_type": "image/png",
    "size_bytes": 482193,
    "transfer_encoding": "base64",
    "base64_data": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

## 5.2 큰 응답의 청크 전송 규칙

큰 JSON 응답은 같은 `response` topic에서 여러 개의 청크 메시지로 나눠 보낼 수 있습니다.

청크 envelope 예시:

```json
{
  "transport": "chunk",
  "id": "req-2201",
  "chunk_index": 0,
  "chunk_count": 4,
  "total_size_bytes": 182744,
  "encoding": "base64",
  "mime_type": "application/json",
  "base64_data": "eyJpZCI6InJlcS0yMjAxIiwib2siOnRydWUsInJlc3VsdCI6ey4uLg=="
}
```

원칙:

- 청크는 항상 같은 `response` topic으로 보냅니다.
- 청크는 `chunk_index` 오름차순으로 조립합니다.
- 모든 청크를 받은 뒤 원래 JSON 응답으로 복원해야 합니다.
- 일반 크기 응답은 기존처럼 단일 JSON 응답으로 보낼 수 있습니다.

## 6. Event JSON 형식

중간 진행 상황은 `event` topic으로 보냅니다.

```json
{
  "id": "req-1001",
  "type": "progress",
  "phase": "camera.capture",
  "message": "capturing image"
}
```

필드:

- `id`
  - 관련 요청 ID
- `type`
  - 이벤트 종류
- `phase`
  - 현재 작업 단계
- `message`
  - 사람이 읽을 수 있는 상태 메시지

## 7. 메서드 이름 규칙

메서드는 아래 형식을 사용합니다.

```text
<domain>.<action>
```

예:

- `node.ping`
- `node.capabilities`
- `system.info`
- `system.exec`
- `camera.list`
- `camera.capture`
- `screen.capture`
- `mouse.action`
- `mouse.move`
- `mouse.click`
- `keyboard.action`
- `keyboard.type`

## 7.1 마우스 액션 메서드

`mouse.action`은 마우스 입력을 액션 기반으로 받는 공통 메서드입니다.

요청 예시:

```json
{
  "id": "req-mouse-1",
  "method": "mouse.action",
  "params": {
    "action": "move",
    "x": 320,
    "y": 240
  }
}
```

```json
{
  "id": "req-mouse-2",
  "method": "mouse.action",
  "params": {
    "action": "click",
    "x": 640,
    "y": 480,
    "button": "left"
  }
}
```

지원 액션:

- `move`
- `click`
- `double_click`
- `button_down`
- `button_up`
- `scroll`

원칙:

- `move`, `click`, `double_click`는 현재 공통 추상화에서 직접 해석됩니다.
- `button_down`, `button_up`, `scroll`은 현재 계약에 포함되지만, OS별 구현이 붙기 전까지는 `not_implemented`를 반환할 수 있습니다.
- `mouse.move`, `mouse.click`은 기존 호출과의 호환용 메서드로 유지됩니다.

## 7.2 키보드 액션 메서드

`keyboard.action`은 키보드 입력을 액션 기반으로 받는 공통 메서드입니다.

요청 예시:

```json
{
  "id": "req-keyboard-1",
  "method": "keyboard.action",
  "params": {
    "action": "type_text",
    "text": "hello from yeonjang"
  }
}
```

```json
{
  "id": "req-keyboard-2",
  "method": "keyboard.action",
  "params": {
    "action": "shortcut",
    "key": "c",
    "modifiers": ["cmd"]
  }
}
```

지원 액션:

- `type_text`
- `key_press`
- `key_down`
- `key_up`
- `shortcut`

원칙:

- `type_text`는 현재 공통 추상화에서 직접 해석됩니다.
- `key_press`, `key_down`, `key_up`, `shortcut`은 현재 계약에 포함되지만, OS별 구현이 붙기 전까지는 `not_implemented`를 반환할 수 있습니다.
- `keyboard.type`은 기존 호출과의 호환용 메서드로 유지됩니다.

## 8. 바이너리 데이터 전송

바이너리 데이터는 MQTT payload 자체를 바이너리로 보내지 않고, JSON 내부의 `base64` 문자열로 전달합니다.

예:

```json
{
  "id": "req-camera-1",
  "ok": true,
  "result": {
    "mime_type": "image/jpeg",
    "base64_data": "/9j/4AAQSkZJRgABAQAAAQABAAD..."
  }
}
```

권장 필드:

- `mime_type`
  - 예: `image/jpeg`, `image/png`
- `base64_data`
  - base64 인코딩된 본문
- `output_path`
  - 필요하면 연장 쪽 저장 경로를 같이 포함 가능

원칙:

- base64 데이터는 항상 JSON 문자열로 넣습니다.
- Nobie는 수신한 `base64_data`를 디코딩해 로컬 파일로 저장하거나 바로 표시할 수 있습니다.

## 9. QoS / Retained 권장값

권장 운영값:

- `status`: QoS 1, retained 사용
- `capabilities`: QoS 1, retained 사용
- `request`: QoS 1, retained 사용 안 함
- `response`: QoS 1, retained 사용 안 함
- `event`: QoS 0 또는 1, retained 사용 안 함

## 10. 오류 처리 원칙

Yeonjang은 요청마다 가능한 한 항상 응답을 반환해야 합니다.

실패 시에도 아래 형식을 유지합니다.

```json
{
  "id": "req-1001",
  "ok": false,
  "error": {
    "code": "request_failed",
    "message": "failed to execute command `/bin/ls`"
  }
}
```

오류 코드 예:

- `invalid_request`
- `request_failed`
- `permission_denied`
- `not_implemented`

## 11. 요약

이 프로토콜은 아래만 정의합니다.

- Nobie ↔ Yeonjang 통신은 MQTT topic만 사용
- 모든 payload는 JSON
- 요청/응답은 `id`로 연결
- 최종 결과는 `response`, 중간 진행은 `event`
- 바이너리 데이터는 `base64`로 JSON에 포함