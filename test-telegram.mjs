/**
 * Telegram 채널 테스트 스크립트
 *
 * 실행 전 .env 파일에 아래 항목이 설정되어 있어야 합니다:
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_ALLOWED_USERS=123456789   (본인 Telegram User ID)
 *   ANTHROPIC_API_KEY=... 또는 OPENAI_API_KEY=...
 *
 * 실행:
 *   node test-telegram.mjs
 */

import { bootstrap, startChannels, loadEnv } from "./packages/core/dist/index.js"
import { writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// 1. .env 로드
loadEnv()

const token = process.env.TELEGRAM_BOT_TOKEN
const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS

if (!token) {
  console.error("❌  TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.")
  console.error("    .env 파일에 TELEGRAM_BOT_TOKEN=... 을 추가하세요.")
  process.exit(1)
}
if (!allowedUsers) {
  console.error("❌  TELEGRAM_ALLOWED_USERS가 설정되지 않았습니다.")
  console.error("    .env 파일에 TELEGRAM_ALLOWED_USERS=본인UserID 를 추가하세요.")
  console.error("    본인 User ID는 @userinfobot 에게 /start 전송하면 확인 가능합니다.")
  process.exit(1)
}

// 2. config.json5 에 telegram 설정 주입 (없는 경우)
const nobieConfigPath = join(homedir(), ".nobie", "config.json5")
const wizbyConfigPath = join(homedir(), ".wizby", "config.json5")
const howieConfigPath = join(homedir(), ".howie", "config.json5")
const legacyConfigPath = join(homedir(), ".nobie", "config.json5")
const configPath = existsSync(nobieConfigPath) ? nobieConfigPath : existsSync(wizbyConfigPath) ? wizbyConfigPath : existsSync(howieConfigPath) ? howieConfigPath : legacyConfigPath
if (existsSync(configPath)) {
  const content = Buffer.from(await import("node:fs").then(m => m.readFileSync(configPath, "utf-8")))
  if (!content.toString().includes("telegram")) {
    console.log("ℹ️  config.json5 에 telegram 설정을 추가합니다...")
    const userIds = allowedUsers.split(",").map(s => Number(s.trim())).filter(Boolean)
    const extra = `\n// Telegram (자동 추가)\ntelegram: {\n  enabled: true,\n  botToken: "\${TELEGRAM_BOT_TOKEN}",\n  allowedUserIds: [${userIds.join(",")}],\n  allowedGroupIds: [],\n},\n`
    const updated = content.toString().replace(/}(\s*)$/, extra + "}$1")
    writeFileSync(configPath, updated)
    console.log("✅  config.json5 업데이트 완료")
  }
}

// 3. 부트스트랩 + 채널 시작
console.log("🚀  스폰지 노비 · Sponzey Nobie 시작 중...")
bootstrap()
await startChannels()
console.log("✅  Telegram 봇이 실행되었습니다. 텔레그램에서 메시지를 보내보세요.")
console.log("    종료: Ctrl+C")

process.on("SIGINT", () => {
  console.log("\n👋  종료합니다.")
  process.exit(0)
})
