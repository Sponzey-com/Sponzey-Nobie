import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type WebUiMessageKey =
  | "advanced.notice.eyebrow"
  | "advanced.notice.title"
  | "advanced.notice.description"
  | "advanced.notice.switch"
  | "advanced.notice.backToChat"
  | "admin.placeholder.eyebrow"
  | "admin.placeholder.title"
  | "admin.placeholder.description"
  | "admin.shell.warning"
  | "admin.shell.badge.enabled"
  | "admin.shell.badge.audit"
  | "admin.shell.badge.subscribers"
  | "admin.shell.dangerTitle"
  | "admin.shell.dangerDescription"
  | "admin.shell.confirmation"
  | "admin.shell.auditRequired"
  | "admin.shell.sidebarWarning"
  | "admin.shell.action.retry"
  | "admin.shell.action.purge"
  | "admin.shell.action.replay"
  | "admin.shell.action.export"
  | "admin.shell.action.retryDesc"
  | "admin.shell.action.purgeDesc"
  | "admin.shell.action.replayDesc"
  | "admin.shell.action.exportDesc"
  | "admin.live.title"
  | "admin.live.description"
  | "admin.live.streamTitle"
  | "admin.live.timelineTitle"
  | "admin.live.runsTitle"
  | "admin.live.ledgerTitle"
  | "admin.live.empty"
  | "admin.live.streamStatus"
  | "admin.live.reconnect"
  | "admin.live.backpressure"
  | "admin.live.eventCount"
  | "admin.live.deliveryStatus"
  | "admin.live.runStatus"
  | "admin.live.duplicates"
  | "admin.live.duration"
  | "admin.lab.title"
  | "admin.lab.description"
  | "admin.lab.toolsTitle"
  | "admin.lab.webTitle"
  | "admin.lab.fixtureTitle"
  | "admin.lab.fixtureRun"
  | "admin.lab.redacted"
  | "admin.lab.discovery"
  | "admin.lab.completion"
  | "admin.lab.candidates"
  | "admin.lab.attempts"
  | "admin.lab.degraded"
  | "admin.lab.answerable"
  | "admin.lab.cache"
  | "admin.lab.adapter"
  | "admin.inspectors.title"
  | "admin.inspectors.description"
  | "admin.inspectors.memoryTitle"
  | "admin.inspectors.schedulerTitle"
  | "admin.inspectors.channelTitle"
  | "admin.inspectors.documents"
  | "admin.inspectors.writeback"
  | "admin.inspectors.retrieval"
  | "admin.inspectors.failures"
  | "admin.inspectors.contract"
  | "admin.inspectors.queue"
  | "admin.inspectors.receipts"
  | "admin.inspectors.approvals"
  | "admin.inspectors.mapping"
  | "admin.inspectors.fieldChecks"
  | "admin.platform.title"
  | "admin.platform.description"
  | "admin.platform.yeonjangTitle"
  | "admin.platform.dbTitle"
  | "admin.platform.exportTitle"
  | "admin.platform.broker"
  | "admin.platform.nodes"
  | "admin.platform.heartbeat"
  | "admin.platform.reconnects"
  | "admin.platform.dbStructure"
  | "admin.platform.pending"
  | "admin.platform.integrity"
  | "admin.platform.backups"
  | "admin.platform.migrationLock"
  | "admin.platform.startExport"
  | "admin.platform.exportStatus"
  | "admin.platform.exportSafe"
  | "admin.platform.fingerprint"
  | "admin.platform.protocol"
  | "admin.platform.noJobs"
  | "beginner.tasks.title"
  | "beginner.tasks.description"
  | "beginner.tasks.active"
  | "beginner.tasks.details"
  | "beginner.home.eyebrow"
  | "beginner.home.title"
  | "beginner.home.description"
  | "beginner.home.conversation"
  | "beginner.home.recentResults"
  | "beginner.home.recentWork"
  | "beginner.home.emptyTitle"
  | "beginner.home.emptyDescription"
  | "beginner.home.inputPlaceholder"
  | "beginner.home.send"
  | "beginner.home.queue"
  | "beginner.home.newChat"
  | "beginner.setup.title"
  | "beginner.setup.description"
  | "beginner.setup.status.ready"
  | "beginner.setup.status.needsAttention"
  | "beginner.setup.status.skipped"
  | "beginner.setup.step.ai"
  | "beginner.setup.step.aiDesc"
  | "beginner.setup.step.channels"
  | "beginner.setup.step.channelsDesc"
  | "beginner.setup.step.computer"
  | "beginner.setup.step.computerDesc"
  | "beginner.setup.step.test"
  | "beginner.setup.step.testDesc"
  | "beginner.setup.aiTitle"
  | "beginner.setup.channelTitle"
  | "beginner.setup.computerTitle"
  | "beginner.setup.testTitle"
  | "beginner.setup.provider"
  | "beginner.setup.endpoint"
  | "beginner.setup.defaultModel"
  | "beginner.setup.apiKey"
  | "beginner.setup.authFile"
  | "beginner.setup.advancedOptions"
  | "beginner.setup.telegramToken"
  | "beginner.setup.slackBotToken"
  | "beginner.setup.slackAppToken"
  | "beginner.setup.enableTelegram"
  | "beginner.setup.enableSlack"
  | "beginner.setup.enableComputer"
  | "beginner.setup.computerHost"
  | "beginner.setup.computerPort"
  | "beginner.setup.saveAndTestAi"
  | "beginner.setup.saveChannel"
  | "beginner.setup.saveComputer"
  | "beginner.setup.refreshStatus"
  | "beginner.setup.finish"
  | "beginner.setup.openAdvanced"
  | "beginner.setup.saved"
  | "beginner.setup.testing"
  | "beginner.setup.testReady"
  | "beginner.setup.testNeedsAction"
  | "beginner.setup.smokeReady"
  | "beginner.setup.smokeNeedsAction"
  | "beginner.connection.ai"
  | "beginner.connection.channels"
  | "beginner.connection.yeonjang"
  | "beginner.connection.storage"
  | "beginner.connection.aiReady"
  | "beginner.connection.aiActionNeeded"
  | "beginner.connection.aiAction"
  | "beginner.connection.channelsReady"
  | "beginner.connection.channelsOptional"
  | "beginner.connection.channelsAction"
  | "beginner.connection.yeonjangReady"
  | "beginner.connection.yeonjangOptional"
  | "beginner.connection.yeonjangAction"
  | "beginner.connection.storageReady"
  | "beginner.connection.storageActionNeeded"
  | "beginner.connection.storageAction"
  | "beginner.status.title"
  | "beginner.status.gateway"
  | "beginner.status.channels"
  | "beginner.status.connected"
  | "beginner.status.needsCheck"
  | "beginner.status.setupNeeded"
  | "beginner.status.openAdvanced"
  | "layout.brand.eyebrow"
  | "layout.currentMode"
  | "layout.mode.beginner"
  | "layout.mode.advanced"
  | "layout.mode.admin"
  | "layout.gateway.connected"
  | "layout.gateway.disconnected"
  | "layout.nav.title"
  | "layout.status.title"
  | "layout.status.ready"
  | "layout.status.setupRequired"
  | "layout.status.ai"
  | "layout.status.channel"
  | "layout.status.yeonjang"
  | "layout.status.webui"
  | "layout.activeRuns"
  | "beginner.work.summaryPending"
  | "beginner.work.status.running"
  | "beginner.work.status.completed"
  | "beginner.work.status.needsAttention"
  | "beginner.work.status.failed"
  | "beginner.work.failedAction"
  | "beginner.work.needsAttentionAction"
  | "beginner.approval.title"
  | "beginner.approval.summary"
  | "beginner.approval.screenTitle"
  | "beginner.approval.screenSummary"
  | "beginner.approval.approveAll"
  | "beginner.approval.approveAllAria"
  | "beginner.approval.approveOnce"
  | "beginner.approval.approveOnceAria"
  | "beginner.approval.readyAll"
  | "beginner.approval.readyAllAria"
  | "beginner.approval.readyOnce"
  | "beginner.approval.readyOnceAria"
  | "beginner.approval.deny"
  | "beginner.approval.denyAria"
  | "error.beginner.auth"
  | "error.beginner.noAi"
  | "error.beginner.network"
  | "error.beginner.access"
  | "error.beginner.rateLimit"
  | "error.beginner.model"
  | "error.beginner.server"
  | "error.beginner.unknown"
  | "error.repeated"

export const WEB_UI_MESSAGE_CATALOG: Record<WebUiMessageKey, { ko: string; en: string }> = {
  "advanced.notice.eyebrow": { ko: "고급 화면", en: "Advanced mode" },
  "advanced.notice.title": { ko: "고급 화면입니다", en: "This is an advanced screen" },
  "advanced.notice.description": { ko: "현재는 초보 모드입니다. 이 화면은 설정, 진단, 실행 세부 정보를 다루므로 고급 모드로 전환한 뒤 확인할 수 있습니다.", en: "You are currently in beginner mode. This screen contains setup, diagnostics, and execution details, so switch to advanced mode to continue." },
  "advanced.notice.switch": { ko: "고급 모드로 전환", en: "Switch to advanced mode" },
  "advanced.notice.backToChat": { ko: "채팅으로 돌아가기", en: "Back to chat" },
  "admin.placeholder.eyebrow": { ko: "어드민", en: "Admin" },
  "admin.placeholder.title": { ko: "어드민 도구", en: "Admin tools" },
  "admin.placeholder.description": { ko: "실시간 진단 화면은 다음 작업에서 세부 구현됩니다.", en: "Realtime diagnostic screens will be implemented in later work." },
  "admin.shell.warning": { ko: "개발자용 진단 화면입니다. 위험 조작은 명시 확인과 감사 기록 없이 실행되지 않습니다.", en: "This is a developer diagnostics screen. Risky operations do not run without explicit confirmation and audit logging." },
  "admin.shell.badge.enabled": { ko: "ADMIN 활성", en: "ADMIN enabled" },
  "admin.shell.badge.audit": { ko: "감사 기록 필수", en: "Audit required" },
  "admin.shell.badge.subscribers": { ko: "구독 {count}", en: "Subscribers {count}" },
  "admin.shell.dangerTitle": { ko: "위험 조작", en: "Risky operations" },
  "admin.shell.dangerDescription": { ko: "재시도, 삭제, 재생, 내보내기는 확인 문구가 정확히 일치해야 접수됩니다.", en: "Retry, purge, replay, and export are accepted only when the confirmation phrase matches exactly." },
  "admin.shell.confirmation": { ko: "확인 문구", en: "Confirmation" },
  "admin.shell.auditRequired": { ko: "요청, 확인, 결과가 감사 기록에 남습니다.", en: "Request, confirmation, and result are recorded in audit logs." },
  "admin.shell.sidebarWarning": { ko: "Admin 도구 활성. 위험 조작은 확인과 감사 기록이 필요합니다.", en: "Admin tools active. Risky operations require confirmation and audit logging." },
  "admin.shell.action.retry": { ko: "재시도", en: "Retry" },
  "admin.shell.action.purge": { ko: "삭제", en: "Purge" },
  "admin.shell.action.replay": { ko: "재생", en: "Replay" },
  "admin.shell.action.export": { ko: "내보내기", en: "Export" },
  "admin.shell.action.retryDesc": { ko: "실패하거나 중단된 일을 다시 접수합니다.", en: "Accept a failed or interrupted unit of work again." },
  "admin.shell.action.purgeDesc": { ko: "오래된 실행 기록이나 임시 상태를 정리합니다.", en: "Clean old history or temporary state." },
  "admin.shell.action.replayDesc": { ko: "저장된 이벤트 흐름을 다시 확인합니다.", en: "Review a stored event flow again." },
  "admin.shell.action.exportDesc": { ko: "진단 또는 실행 데이터를 파일로 내보냅니다.", en: "Export diagnostic or execution data to a file." },
  "admin.live.title": { ko: "실시간 흐름", en: "Live flow" },
  "admin.live.description": { ko: "요청 수신부터 완료, 전달, 복구까지 한 화면에서 추적합니다.", en: "Trace intake, completion, delivery, and recovery in one view." },
  "admin.live.streamTitle": { ko: "스트림 상태", en: "Stream status" },
  "admin.live.timelineTitle": { ko: "흐름 기록", en: "Flow log" },
  "admin.live.runsTitle": { ko: "실행 분석", en: "Execution inspector" },
  "admin.live.ledgerTitle": { ko: "전달 장부", en: "Delivery ledger" },
  "admin.live.empty": { ko: "표시할 데이터가 없습니다.", en: "No data to show." },
  "admin.live.streamStatus": { ko: "상태 {status}", en: "Status {status}" },
  "admin.live.reconnect": { ko: "재연결 지원 {eventType}", en: "Reconnect supported {eventType}" },
  "admin.live.backpressure": { ko: "대기열 영향 {count}", en: "Queue impact {count}" },
  "admin.live.eventCount": { ko: "이벤트 {count}", en: "Events {count}" },
  "admin.live.deliveryStatus": { ko: "전달 {status}", en: "Delivery {status}" },
  "admin.live.runStatus": { ko: "실행 {status}", en: "Execution {status}" },
  "admin.live.duplicates": { ko: "중복 후보 {count}", en: "Duplicate candidates {count}" },
  "admin.live.duration": { ko: "소요 {duration}ms", en: "Duration {duration}ms" },
  "admin.lab.title": { ko: "도구와 웹 조회 분석", en: "Tool and web lookup analysis" },
  "admin.lab.description": { ko: "도구 호출, 승인, 웹 조회 근거, 후보 추출, 완료 확인을 분리해서 보여줍니다.", en: "Shows tool calls, approvals, web evidence, extracted candidates, and final checks separately." },
  "admin.lab.toolsTitle": { ko: "도구 호출", en: "Tool calls" },
  "admin.lab.webTitle": { ko: "웹 조회", en: "Web lookup" },
  "admin.lab.fixtureTitle": { ko: "오프라인 재검사", en: "Offline replay" },
  "admin.lab.fixtureRun": { ko: "재검사 실행", en: "Run replay" },
  "admin.lab.redacted": { ko: "민감값 숨김 {count}", en: "Hidden sensitive values {count}" },
  "admin.lab.discovery": { ko: "검색 단계: 넓게 찾기", en: "Discovery: broad lookup" },
  "admin.lab.completion": { ko: "완료 단계: 필드 기준 확인", en: "Completion: field checks" },
  "admin.lab.candidates": { ko: "후보 {count}", en: "Candidates {count}" },
  "admin.lab.attempts": { ko: "조회 시도 {count}", en: "Lookup attempts {count}" },
  "admin.lab.degraded": { ko: "저하 {count}", en: "Degraded {count}" },
  "admin.lab.answerable": { ko: "답변 가능 {count}", en: "Answerable {count}" },
  "admin.lab.cache": { ko: "캐시 {status}", en: "Cache {status}" },
  "admin.lab.adapter": { ko: "어댑터 {name}", en: "Adapter {name}" },
  "admin.inspectors.title": { ko: "메모리, 예약, 채널 분석", en: "Memory, schedule, and channel analysis" },
  "admin.inspectors.description": { ko: "저장, 예약 실행, 메시지 전달의 관계와 상태 변화를 함께 보여줍니다.", en: "Shows relationships and state changes for storage, scheduled execution, and message delivery." },
  "admin.inspectors.memoryTitle": { ko: "메모리", en: "Memory" },
  "admin.inspectors.schedulerTitle": { ko: "예약", en: "Schedule" },
  "admin.inspectors.channelTitle": { ko: "채널", en: "Channel" },
  "admin.inspectors.documents": { ko: "문서 {count}", en: "Documents {count}" },
  "admin.inspectors.writeback": { ko: "저장 대기 {count}", en: "Pending writes {count}" },
  "admin.inspectors.retrieval": { ko: "검색 기록 {count}", en: "Retrieval records {count}" },
  "admin.inspectors.failures": { ko: "연결된 실패 {count}", en: "Linked failures {count}" },
  "admin.inspectors.contract": { ko: "계약 {status}", en: "Contract {status}" },
  "admin.inspectors.queue": { ko: "대기 상태 {status}", en: "Queue state {status}" },
  "admin.inspectors.receipts": { ko: "전달 기록 {count}", en: "Receipts {count}" },
  "admin.inspectors.approvals": { ko: "승인 콜백 {count}", en: "Approval callbacks {count}" },
  "admin.inspectors.mapping": { ko: "연결 {count}", en: "Mappings {count}" },
  "admin.inspectors.fieldChecks": { ko: "완료 확인은 구조 필드만 사용", en: "Final checks use structured fields only" },
  "admin.platform.title": { ko: "연장, DB, 진단 묶음", en: "Computer link, DB, and diagnostic bundle" },
  "admin.platform.description": { ko: "브로커 연결, 연장 상태, DB 구조, 안전 내보내기를 한 화면에서 확인합니다.", en: "Inspect broker connection, computer-link state, DB structure, and safe export from one screen." },
  "admin.platform.yeonjangTitle": { ko: "연장과 MQTT", en: "Computer link and MQTT" },
  "admin.platform.dbTitle": { ko: "DB와 마이그레이션", en: "DB and migrations" },
  "admin.platform.exportTitle": { ko: "진단 내보내기", en: "Diagnostic export" },
  "admin.platform.broker": { ko: "브로커 {status}", en: "Broker {status}" },
  "admin.platform.nodes": { ko: "노드 {count}", en: "Nodes {count}" },
  "admin.platform.heartbeat": { ko: "하트비트 {count}", en: "Heartbeats {count}" },
  "admin.platform.reconnects": { ko: "재연결 {count}", en: "Reconnects {count}" },
  "admin.platform.dbStructure": { ko: "DB {current}/{latest}", en: "DB {current}/{latest}" },
  "admin.platform.pending": { ko: "대기 {count}", en: "Pending {count}" },
  "admin.platform.integrity": { ko: "무결성 {status}", en: "Integrity {status}" },
  "admin.platform.backups": { ko: "백업 {count}", en: "Backups {count}" },
  "admin.platform.migrationLock": { ko: "마이그레이션 잠금 {status}", en: "Migration lock {status}" },
  "admin.platform.startExport": { ko: "안전 내보내기 시작", en: "Start safe export" },
  "admin.platform.exportStatus": { ko: "상태 {status}", en: "Status {status}" },
  "admin.platform.exportSafe": { ko: "토큰, HTML 본문, 로컬 경로는 숨겨서 묶습니다.", en: "Tokens, HTML body content, and local paths are hidden in the bundle." },
  "admin.platform.fingerprint": { ko: "기능 지문 {value}", en: "Capability fingerprint {value}" },
  "admin.platform.protocol": { ko: "프로토콜 {value}", en: "Protocol {value}" },
  "admin.platform.noJobs": { ko: "생성된 내보내기가 없습니다.", en: "No exports have been created." },
  "beginner.tasks.title": { ko: "작업 확인", en: "Work review" },
  "beginner.tasks.description": { ko: "현재 진행 중이거나 확인이 필요한 일만 간단히 보여줍니다.", en: "Only active or attention-needed work is summarized here." },
  "beginner.tasks.active": { ko: "진행 중인 일", en: "Active work" },
  "beginner.tasks.details": { ko: "자세히 보기", en: "View details" },
  "beginner.home.eyebrow": { ko: "초보 홈", en: "Beginner home" },
  "beginner.home.title": { ko: "무엇을 도와드릴까요?", en: "What can I help with?" },
  "beginner.home.description": { ko: "요청을 입력하고, 필요한 확인과 결과를 이 화면에서 처리합니다.", en: "Send requests, confirm required actions, and review results on this screen." },
  "beginner.home.conversation": { ko: "대화", en: "Conversation" },
  "beginner.home.recentResults": { ko: "최근 결과", en: "Recent results" },
  "beginner.home.recentWork": { ko: "진행 상황", en: "Progress" },
  "beginner.home.emptyTitle": { ko: "아직 대화가 없습니다", en: "No conversation yet" },
  "beginner.home.emptyDescription": { ko: "아래 입력창에 요청을 적으면 진행 상황과 결과가 이곳에 표시됩니다.", en: "Type a request below to see progress and results here." },
  "beginner.home.inputPlaceholder": { ko: "요청을 입력하세요. Enter로 전송, Shift+Enter로 줄바꿈", en: "Type a request. Enter to send, Shift+Enter for a new line" },
  "beginner.home.send": { ko: "전송", en: "Send" },
  "beginner.home.queue": { ko: "추가", en: "Add" },
  "beginner.home.newChat": { ko: "새 대화", en: "New chat" },
  "beginner.setup.title": { ko: "처음 설정", en: "First setup" },
  "beginner.setup.description": { ko: "AI만 먼저 연결하면 바로 시작할 수 있습니다. 채널과 내 컴퓨터 연결은 필요할 때 켜면 됩니다.", en: "Connect AI first to start. Channels and computer connection can be enabled when needed." },
  "beginner.setup.status.ready": { ko: "사용 가능", en: "Ready" },
  "beginner.setup.status.needsAttention": { ko: "확인 필요", en: "Needs attention" },
  "beginner.setup.status.skipped": { ko: "나중에", en: "Later" },
  "beginner.setup.step.ai": { ko: "AI 연결", en: "AI connection" },
  "beginner.setup.step.aiDesc": { ko: "응답에 사용할 AI 하나를 연결합니다.", en: "Connect one AI for responses." },
  "beginner.setup.step.channels": { ko: "대화 채널", en: "Conversation channels" },
  "beginner.setup.step.channelsDesc": { ko: "Telegram 또는 Slack에서 대화할 때 설정합니다.", en: "Configure this to chat from Telegram or Slack." },
  "beginner.setup.step.computer": { ko: "내 컴퓨터 연결", en: "Computer connection" },
  "beginner.setup.step.computerDesc": { ko: "연장을 통해 화면, 파일, 앱 제어를 사용할 때 설정합니다.", en: "Configure this to use screen, file, and app controls through the extension." },
  "beginner.setup.step.test": { ko: "확인", en: "Check" },
  "beginner.setup.step.testDesc": { ko: "저장된 연결 상태를 한 번에 확인합니다.", en: "Check the saved connection state." },
  "beginner.setup.aiTitle": { ko: "AI 연결하기", en: "Connect AI" },
  "beginner.setup.channelTitle": { ko: "대화 채널 연결하기", en: "Connect channels" },
  "beginner.setup.computerTitle": { ko: "내 컴퓨터 연결하기", en: "Connect this computer" },
  "beginner.setup.testTitle": { ko: "연결 상태 확인", en: "Check connection status" },
  "beginner.setup.provider": { ko: "AI 종류", en: "AI type" },
  "beginner.setup.endpoint": { ko: "연결 주소", en: "Endpoint" },
  "beginner.setup.defaultModel": { ko: "기본 모델", en: "Default model" },
  "beginner.setup.apiKey": { ko: "API 키", en: "API key" },
  "beginner.setup.authFile": { ko: "인증 파일", en: "Auth file" },
  "beginner.setup.advancedOptions": { ko: "고급 설정", en: "Advanced options" },
  "beginner.setup.telegramToken": { ko: "Telegram Bot Token", en: "Telegram bot token" },
  "beginner.setup.slackBotToken": { ko: "Slack Bot Token", en: "Slack bot token" },
  "beginner.setup.slackAppToken": { ko: "Slack App Token", en: "Slack app token" },
  "beginner.setup.enableTelegram": { ko: "Telegram 사용", en: "Enable Telegram" },
  "beginner.setup.enableSlack": { ko: "Slack 사용", en: "Enable Slack" },
  "beginner.setup.enableComputer": { ko: "내 컴퓨터 연결 사용", en: "Enable computer connection" },
  "beginner.setup.computerHost": { ko: "연결 호스트", en: "Connection host" },
  "beginner.setup.computerPort": { ko: "연결 포트", en: "Connection port" },
  "beginner.setup.saveAndTestAi": { ko: "저장하고 AI 확인", en: "Save and test AI" },
  "beginner.setup.saveChannel": { ko: "채널 저장", en: "Save channels" },
  "beginner.setup.saveComputer": { ko: "내 컴퓨터 연결 저장", en: "Save computer connection" },
  "beginner.setup.refreshStatus": { ko: "상태 새로고침", en: "Refresh status" },
  "beginner.setup.finish": { ko: "설정 완료", en: "Finish setup" },
  "beginner.setup.openAdvanced": { ko: "고급 설정에서 자세히 보기", en: "Open advanced settings" },
  "beginner.setup.saved": { ko: "저장되었습니다.", en: "Saved." },
  "beginner.setup.testing": { ko: "확인 중입니다...", en: "Checking..." },
  "beginner.setup.testReady": { ko: "사용 가능합니다.", en: "Ready to use." },
  "beginner.setup.testNeedsAction": { ko: "확인이 필요합니다.", en: "Needs attention." },
  "beginner.setup.smokeReady": { ko: "시작할 준비가 되었습니다.", en: "Ready to start." },
  "beginner.setup.smokeNeedsAction": { ko: "필수 연결을 먼저 확인해 주세요.", en: "Check the required connection first." },
  "beginner.connection.ai": { ko: "AI", en: "AI" },
  "beginner.connection.channels": { ko: "대화 채널", en: "Channels" },
  "beginner.connection.yeonjang": { ko: "내 컴퓨터", en: "This computer" },
  "beginner.connection.storage": { ko: "저장 상태", en: "Storage" },
  "beginner.connection.aiReady": { ko: "AI 연결이 준비되었습니다.", en: "AI connection is ready." },
  "beginner.connection.aiActionNeeded": { ko: "AI 연결을 먼저 저장해 주세요.", en: "Save the AI connection first." },
  "beginner.connection.aiAction": { ko: "AI 연결하기", en: "Connect AI" },
  "beginner.connection.channelsReady": { ko: "대화 채널이 준비되었습니다.", en: "Conversation channel is ready." },
  "beginner.connection.channelsOptional": { ko: "필요할 때 채널을 연결할 수 있습니다.", en: "Connect a channel when needed." },
  "beginner.connection.channelsAction": { ko: "채널 연결하기", en: "Connect channels" },
  "beginner.connection.yeonjangReady": { ko: "내 컴퓨터 연결이 준비되었습니다.", en: "Computer connection is ready." },
  "beginner.connection.yeonjangOptional": { ko: "화면이나 앱 제어가 필요할 때 연결하세요.", en: "Connect when screen or app control is needed." },
  "beginner.connection.yeonjangAction": { ko: "내 컴퓨터 연결하기", en: "Connect this computer" },
  "beginner.connection.storageReady": { ko: "설정 저장 위치가 준비되었습니다.", en: "Settings storage is ready." },
  "beginner.connection.storageActionNeeded": { ko: "설정 저장 상태를 확인해야 합니다.", en: "Settings storage needs attention." },
  "beginner.connection.storageAction": { ko: "저장 상태 확인", en: "Check storage" },
  "beginner.status.title": { ko: "연결 상태", en: "Connection status" },
  "beginner.status.gateway": { ko: "Gateway", en: "Gateway" },
  "beginner.status.channels": { ko: "대화 채널", en: "Channels" },
  "beginner.status.connected": { ko: "연결됨", en: "Connected" },
  "beginner.status.needsCheck": { ko: "확인 필요", en: "Needs check" },
  "beginner.status.setupNeeded": { ko: "설정 필요", en: "Setup needed" },
  "beginner.status.openAdvanced": { ko: "고급 진단 보기", en: "Open advanced diagnostics" },
  "layout.brand.eyebrow": { ko: "WebUI First", en: "WebUI First" },
  "layout.currentMode": { ko: "현재 모드", en: "Current mode" },
  "layout.mode.beginner": { ko: "초보", en: "Beginner" },
  "layout.mode.advanced": { ko: "고급", en: "Advanced" },
  "layout.mode.admin": { ko: "어드민", en: "Admin" },
  "layout.gateway.connected": { ko: "Gateway 연결됨", en: "Gateway connected" },
  "layout.gateway.disconnected": { ko: "Gateway 연결 안 됨", en: "Gateway disconnected" },
  "layout.nav.title": { ko: "메뉴", en: "Menu" },
  "layout.status.title": { ko: "상태", en: "Status" },
  "layout.status.ready": { ko: "사용 가능", en: "Ready" },
  "layout.status.setupRequired": { ko: "초기 설정 필요", en: "Setup required" },
  "layout.status.ai": { ko: "AI", en: "AI" },
  "layout.status.channel": { ko: "대화 채널", en: "Channel" },
  "layout.status.yeonjang": { ko: "연장", en: "Yeonjang" },
  "layout.status.webui": { ko: "WebUI", en: "WebUI" },
  "layout.activeRuns": { ko: "진행 중 {count}", en: "active work {count}" },
  "beginner.work.summaryPending": { ko: "상태를 확인하는 중입니다.", en: "Checking the status." },
  "beginner.work.status.running": { ko: "진행 중", en: "Running" },
  "beginner.work.status.completed": { ko: "완료", en: "Completed" },
  "beginner.work.status.needsAttention": { ko: "확인 필요", en: "Needs confirmation" },
  "beginner.work.status.failed": { ko: "실패", en: "Failed" },
  "beginner.work.failedAction": { ko: "상태 확인", en: "Check status" },
  "beginner.work.needsAttentionAction": { ko: "확인하기", en: "Review" },
  "beginner.approval.title": { ko: "확인이 필요합니다", en: "Confirmation needed" },
  "beginner.approval.summary": { ko: "안전한 진행을 위해 사용자의 확인이 필요합니다.", en: "User confirmation is needed before continuing safely." },
  "beginner.approval.screenTitle": { ko: "화면 준비를 확인해 주세요", en: "Confirm the screen is ready" },
  "beginner.approval.screenSummary": { ko: "대상 화면이 준비되면 계속 진행할 수 있습니다.", en: "Continue once the target screen is ready." },
  "beginner.approval.approveAll": { ko: "이 요청 계속 진행", en: "Continue this request" },
  "beginner.approval.approveAllAria": { ko: "현재 요청 전체를 승인하고 계속 진행", en: "Approve the entire current request and continue" },
  "beginner.approval.approveOnce": { ko: "이번 단계만 진행", en: "Continue this step only" },
  "beginner.approval.approveOnceAria": { ko: "현재 단계만 승인하고 계속 진행", en: "Approve only the current step and continue" },
  "beginner.approval.readyAll": { ko: "준비 완료, 계속 진행", en: "Ready, continue" },
  "beginner.approval.readyAllAria": { ko: "화면 준비 완료를 확인하고 요청을 계속 진행", en: "Confirm the screen is ready and continue the request" },
  "beginner.approval.readyOnce": { ko: "이번 단계만 계속", en: "Continue this step" },
  "beginner.approval.readyOnceAria": { ko: "화면 준비 완료를 확인하고 현재 단계만 계속 진행", en: "Confirm the screen is ready and continue only this step" },
  "beginner.approval.deny": { ko: "취소", en: "Cancel" },
  "beginner.approval.denyAria": { ko: "승인하지 않고 현재 요청 취소", en: "Deny approval and cancel the current request" },
  "error.beginner.auth": { ko: "AI 인증에 실패했습니다. API 키 또는 인증 정보를 확인해 주세요.", en: "AI authentication failed. Check the API key or credentials." },
  "error.beginner.noAi": { ko: "사용 가능한 AI가 연결되어 있지 않습니다. 설정 화면에서 AI 연결과 기본 모델을 확인해 주세요.", en: "No usable AI is connected. Check the AI connection and default model in Settings." },
  "error.beginner.network": { ko: "AI 엔드포인트에 연결할 수 없습니다. 엔드포인트 주소와 서버 실행 상태를 확인해 주세요.", en: "Cannot connect to the AI endpoint. Check the endpoint URL and whether the server is running." },
  "error.beginner.access": { ko: "AI 인증 또는 권한 확인에 실패했습니다. API 키와 접근 권한을 확인해 주세요.", en: "AI authentication or permission check failed. Check the API key and access permissions." },
  "error.beginner.rateLimit": { ko: "AI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", en: "The AI rate limit was reached. Please try again later." },
  "error.beginner.model": { ko: "선택한 모델 설정에 문제가 있습니다. 기본 모델과 사용 가능한 모델 목록을 확인해 주세요.", en: "There is a problem with the selected model. Check the default model and the available model list." },
  "error.beginner.server": { ko: "AI 실행 중 서버 오류가 발생했습니다. 연결된 AI 설정과 상태 화면을 확인해 주세요.", en: "A server error occurred during AI execution. Check the AI settings and status screen." },
  "error.beginner.unknown": { ko: "요청 처리 중 문제가 발생했습니다. 같은 문제가 반복되면 진단 화면에서 확인해 주세요.", en: "A problem occurred while processing the request. If it repeats, check diagnostics." },
  "error.repeated": { ko: "같은 문제가 반복되었습니다. 같은 경로를 반복하지 말고 진단 화면에서 원인과 다른 진행 경로를 확인해 주세요.", en: "The same problem repeated. Do not repeat the same path; inspect diagnostics and choose another path." },
}

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? ""))
}

export function uiCatalogText(language: UiLanguage, key: WebUiMessageKey, params?: Record<string, string | number>): string {
  const entry = WEB_UI_MESSAGE_CATALOG[key]
  return interpolate(pickUiText(language, entry.ko, entry.en), params)
}

export function assertWebUiMessageCatalogCoverage(): void {
  for (const [key, value] of Object.entries(WEB_UI_MESSAGE_CATALOG)) {
    if (!value.ko.trim()) throw new Error(`missing ko message: ${key}`)
    if (!value.en.trim()) throw new Error(`missing en message: ${key}`)
  }
}

const BEGINNER_BLOCKED_TERMS = [/\bphase\b/iu, /\btask\b/iu, /\bverdict\b/iu, /policy\s*version/iu, /checksum/iu, /requestGroupId/iu, /runId/iu, /sessionId/iu, /\braw\b/iu, /stack\s*trace/iu, /internal\s*id/iu, /내부\s*ID/iu]

export function findBeginnerBlockedTerms(text: string): string[] {
  return BEGINNER_BLOCKED_TERMS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)
}

export interface WebUiErrorMessage {
  message: string
  diagnosticCode: string
  repeated: boolean
}

function sanitizeRawText(text: string): string {
  return text.replace(/<!doctype[\s\S]*$/iu, "").replace(/<html[\s\S]*$/iu, "").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, "Bearer ***").trim()
}

export function formatWebUiErrorMessage(raw: string, language: UiLanguage = "ko", repeatCount = 0): WebUiErrorMessage {
  const text = raw.trim()
  const lower = text.toLowerCase()
  if (repeatCount >= 2) return { message: uiCatalogText(language, "error.repeated"), diagnosticCode: "ERR_REPEATED_FAILURE", repeated: true }
  if (lower.includes("no available openai api keys") || lower.includes("no available anthropic api keys") || lower.includes("api key authentication failed") || lower.includes("invalid api key") || lower.includes("authentication failed")) {
    return { message: uiCatalogText(language, "error.beginner.auth"), diagnosticCode: "ERR_AUTH", repeated: false }
  }
  if (lower.includes("unsupported ai backend") || lower.includes("no model") || lower.includes("model is required") || lower.includes("no backend") || lower.includes("provider unavailable")) {
    return { message: uiCatalogText(language, "error.beginner.noAi"), diagnosticCode: "ERR_NO_AI", repeated: false }
  }
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("timeout") || lower.includes("timed out") || lower.includes("socket hang up") || lower.includes("network")) {
    return { message: uiCatalogText(language, "error.beginner.network"), diagnosticCode: "ERR_NETWORK", repeated: false }
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden") || /<html|<!doctype/i.test(text)) {
    return { message: uiCatalogText(language, "error.beginner.access"), diagnosticCode: "ERR_ACCESS_BLOCKED", repeated: false }
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { message: uiCatalogText(language, "error.beginner.rateLimit"), diagnosticCode: "ERR_RATE_LIMIT", repeated: false }
  }
  if (lower.includes("model not found") || lower.includes("does not exist") || lower.includes("unknown model") || lower.includes("context length") || lower.includes("maximum context length")) {
    return { message: uiCatalogText(language, "error.beginner.model"), diagnosticCode: "ERR_MODEL", repeated: false }
  }
  if (lower.includes("500 internal server error")) {
    return { message: uiCatalogText(language, "error.beginner.server"), diagnosticCode: "ERR_SERVER", repeated: false }
  }
  if (lower.includes("ai error:")) {
    const detail = sanitizeRawText(text.replace(/^ai error:\s*/i, ""))
    const safeDetail = detail && !findBeginnerBlockedTerms(detail).length && !/<[a-z][\s\S]*>/i.test(detail) ? ` (${detail})` : ""
    return { message: `${uiCatalogText(language, "error.beginner.server")}${safeDetail}`, diagnosticCode: "ERR_AI", repeated: false }
  }
  return { message: uiCatalogText(language, "error.beginner.unknown"), diagnosticCode: "ERR_UNKNOWN", repeated: false }
}

export function useUiMessageCatalog(language: UiLanguage) {
  return {
    msg: (key: WebUiMessageKey, params?: Record<string, string | number>) => uiCatalogText(language, key, params),
  }
}
