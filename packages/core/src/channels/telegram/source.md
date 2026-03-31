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
- Telegram 전송 성공이 실제 완료로 이어지려면 `runs` 쪽 완료 판정과도 맞물려야 합니다.
