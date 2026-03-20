import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { randomBytes } from "node:crypto"
import JSON5 from "json5"
import { PATHS } from "./paths.js"

export function generateAuthToken(): { token: string } {
  const token = randomBytes(32).toString("hex")
  const configPath = PATHS.configFile

  let raw: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try { raw = JSON5.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown> } catch { /* ignore */ }
  } else {
    mkdirSync(dirname(configPath), { recursive: true })
  }

  if (!raw.webui) raw.webui = {}
  const webui = raw.webui as Record<string, unknown>
  if (!webui.auth) webui.auth = {}
  const auth = webui.auth as Record<string, unknown>
  auth.enabled = true
  auth.token = token

  writeFileSync(configPath, JSON5.stringify(raw, null, 2), "utf-8")
  return { token }
}
