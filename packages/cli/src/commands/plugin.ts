/**
 * `nobie plugin` CLI commands.
 */

import { resolve } from "node:path"
import { existsSync } from "node:fs"

async function getCore() {
  return import("@nobie/core")
}

export async function pluginListCommand(): Promise<void> {
  const { getDb, bootstrap } = await getCore()
  bootstrap()
  const db = getDb()
  const plugins = db
    .prepare("SELECT * FROM plugins ORDER BY installed_at DESC")
    .all() as Array<{ name: string; version: string; description: string | null; enabled: number; installed_at: number }>

  if (!plugins.length) {
    console.log("설치된 플러그인이 없습니다.")
    return
  }

  for (const p of plugins) {
    const status = p.enabled ? "✓ 활성" : "✗ 비활성"
    const desc = p.description ? ` — ${p.description}` : ""
    console.log(`  ${status}  ${p.name}@${p.version}${desc}`)
  }
}

export async function pluginInstallCommand(entryPath: string, opts: { name?: string; version?: string }): Promise<void> {
  const { bootstrap } = await getCore()
  bootstrap()

  const absPath = resolve(entryPath)
  if (!existsSync(absPath)) {
    console.error(`파일이 존재하지 않습니다: ${absPath}`)
    process.exit(1)
  }

  // Load plugin to get metadata
  const mod = await import(absPath) as { default?: { name?: string; version?: string; description?: string } }
  const plugin = mod.default
  if (!plugin) {
    console.error("플러그인 모듈이 default export를 제공하지 않습니다.")
    process.exit(1)
  }

  const name = opts.name ?? plugin.name
  const version = opts.version ?? plugin.version ?? "0.0.1"

  if (!name) {
    console.error("플러그인 이름을 지정하세요: --name <name>")
    process.exit(1)
  }

  const { PluginLoader } = await import("@nobie/core/src/plugins/loader.js" as string)
  const meta = PluginLoader.register({
    name,
    version,
    description: plugin.description,
    entryPath: absPath,
  })

  console.log(`✓ 플러그인 "${meta.name}" v${meta.version} 설치 완료`)
}

export async function pluginUninstallCommand(name: string): Promise<void> {
  const { getDb, bootstrap } = await getCore()
  bootstrap()
  const db = getDb()
  const existing = db.prepare("SELECT id FROM plugins WHERE name = ?").get(name)
  if (!existing) {
    console.error(`플러그인 "${name}"을(를) 찾을 수 없습니다.`)
    process.exit(1)
  }
  db.prepare("DELETE FROM plugins WHERE name = ?").run(name)
  console.log(`✓ 플러그인 "${name}" 제거 완료`)
}

export async function pluginEnableCommand(name: string): Promise<void> {
  const { getDb, bootstrap } = await getCore()
  bootstrap()
  const db = getDb()
  db.prepare("UPDATE plugins SET enabled = 1, updated_at = ? WHERE name = ?").run(Date.now(), name)
  console.log(`✓ 플러그인 "${name}" 활성화`)
}

export async function pluginDisableCommand(name: string): Promise<void> {
  const { getDb, bootstrap } = await getCore()
  bootstrap()
  const db = getDb()
  db.prepare("UPDATE plugins SET enabled = 0, updated_at = ? WHERE name = ?").run(Date.now(), name)
  console.log(`✓ 플러그인 "${name}" 비활성화`)
}

export async function pluginInfoCommand(name: string): Promise<void> {
  const { getDb, bootstrap } = await getCore()
  bootstrap()
  const db = getDb()
  const p = db.prepare("SELECT * FROM plugins WHERE name = ?").get(name) as {
    name: string; version: string; description: string | null; enabled: number
    entry_path: string; config: string; installed_at: number; updated_at: number
  } | undefined

  if (!p) {
    console.error(`플러그인 "${name}"을(를) 찾을 수 없습니다.`)
    process.exit(1)
  }

  console.log(`이름:     ${p.name}`)
  console.log(`버전:     ${p.version}`)
  console.log(`설명:     ${p.description ?? "(없음)"}`)
  console.log(`상태:     ${p.enabled ? "활성" : "비활성"}`)
  console.log(`경로:     ${p.entry_path}`)
  console.log(`설정:     ${p.config}`)
  console.log(`설치일:   ${new Date(p.installed_at).toLocaleString("ko-KR")}`)
  console.log(`수정일:   ${new Date(p.updated_at).toLocaleString("ko-KR")}`)
}
