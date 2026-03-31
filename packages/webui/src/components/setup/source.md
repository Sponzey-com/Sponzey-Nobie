# source.md

## 역할

- `components/setup`은 설정 폼과 런타임 점검 패널을 담습니다.

## 주요 파일

- AI backend와 라우팅 편집: `BackendComposer`, `BackendHealthCard`, `RoutingPriorityEditor`
- 채널과 보안 설정: `TelegramSettingsForm`, `SecuritySettingsForm`, `AuthTokenPanel`
- MQTT 관리: `MqttSettingsForm`, `MqttRuntimePanel`
- 설정 가이드와 검토: `SetupAssistPanel`, `ReviewSummaryPanel`, `SetupChecksPanel`

## 메모

- 이 폴더는 단순 최초 설정용이 아니라 운영 제어판 역할도 합니다.
- MQTT와 연장 상태 가시화도 사용자 입장에서는 이 폴더를 통해 이뤄집니다.
