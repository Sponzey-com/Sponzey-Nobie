# source.md

## 역할

- Telegram 연동은 채팅과 thread 메시지를 Nobie의 session과 request group으로 매핑합니다.

## 주요 파일

- `bot.ts`: 수신 메시지 처리, session 결정, reply 기반 태스크 연결, run 시작
- `responder.ts`: 텍스트/파일 전송과 메시지 참조 기록
- `approval-handler.ts`: 승인 처리와 활성 채팅 바인딩
- `file-handler.ts`: Telegram 파일 다운로드 파이프라인
- `session.ts`: session key와 session ID 매핑

## 메모

- 이 폴더는 “답장(reply)이 같은 태스크를 이어간다”는 동작을 책임집니다.
- reply-to로 들어온 메시지는 답장 대상 태스크가 이미 완료/실패/취소 상태여도, 새 일반 태스크로 만들지 않고 같은 `request_group`에 다시 붙여 이어갑니다.
- Telegram 전송 성공이 실제 완료로 이어지려면 `runs` 쪽 완료 판정과도 맞물려야 합니다.
- 반복 스케줄이나 지연 실행처럼 실시간 채팅 컨텍스트가 없는 경우에도, 세션 ID만 알면 다시 같은 Telegram 대화로 텍스트를 보낼 수 있어야 합니다.
- Telegram bot의 long polling 시작은 완료 Promise가 길게 유지될 수 있으므로, 런타임 활성 등록은 polling 완료를 기다리지 않고 먼저 이뤄져야 scheduler가 `telegram channel is not running`으로 오판하지 않습니다.
- 승인 요청 메시지는 전송 실패로 곧바로 `deny`가 되지 않도록, Telegram 쪽에서는 Markdown 의존을 최소화한 안전한 plain text 전송 경로를 유지하는 것이 맞습니다.
- Telegram 승인 타임아웃은 사용자 거부와 구분해서 `approval.resolved.reason = "timeout"`으로 전달해야 하며, UI와 run 요약도 그 차이를 그대로 보여주는 것이 맞습니다.
- 파일 전달 완료는 도구 출력 문자열을 다시 파싱해서 추론하지 않고, Telegram 채널이 실제 `sendFile()`을 끝낸 뒤 반환하는 구조화된 전달 receipt를 기준으로 `runs` 쪽이 판단해야 합니다.
