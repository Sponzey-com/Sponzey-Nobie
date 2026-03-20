import { platform } from "node:os"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "status" | "logs"

/** Resolve the absolute path of a binary, throwing if not found */
export function which(bin: string): string {
  try {
    return execSync(`which ${bin}`, { encoding: "utf-8" }).trim()
  } catch {
    throw new Error(`Cannot find '${bin}' in PATH. Is it installed?`)
  }
}

/** Find Nobie CLI entry point absolute path */
export function nobieBinPath(): string {
  // When running from dist/, __dirname is packages/cli/dist/commands/service/
  // The bin entry is packages/cli/dist/index.js
  const url = new URL(import.meta.url)
  const thisFile = url.pathname
  // Walk up to dist/, then index.js
  const distDir = resolve(thisFile, "../../../")
  const candidate = resolve(distDir, "index.js")
  if (existsSync(candidate)) return candidate
  // Fallback: try to find via npm/pnpm global
  try { return which("nobie") } catch { /* ignore */ }
  try { return which("wizby") } catch { /* ignore */ }
  try { return which("howie") } catch { /* ignore */ }
  throw new Error("Cannot determine 스폰지 노비 · Sponzey Nobie binary path")
}

export const wizbyBinPath = nobieBinPath
export const howieBinPath = nobieBinPath

export async function runServiceAction(action: ServiceAction): Promise<void> {
  const p = platform()
  let manager: { run: (action: ServiceAction) => Promise<void> }

  if (p === "darwin") {
    manager = await import("./macos.js")
  } else if (p === "linux") {
    manager = await import("./linux.js")
  } else if (p === "win32") {
    manager = await import("./windows.js")
  } else {
    throw new Error(`Unsupported platform: ${p}`)
  }

  await manager.run(action)
}
