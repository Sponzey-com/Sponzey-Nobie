import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

function scriptPath(name: string): string {
  return join(repoRoot, "scripts", name)
}

function scriptText(name: string): string {
  return readFileSync(scriptPath(name), "utf-8")
}

describe("task001 local runtime scripts", () => {
  const scripts = ["start-local.sh", "stop-local.sh", "status-local.sh", "restart-local.sh"]

  for (const script of scripts) {
    it(`${script} is executable bash with valid syntax`, () => {
      const path = scriptPath(script)
      const text = readFileSync(path, "utf-8")
      expect(text.startsWith("#!/usr/bin/env bash\n")).toBe(true)
      expect(statSync(path).mode & 0o111).not.toBe(0)
      execFileSync("bash", ["-n", path], { cwd: repoRoot })
    })
  }

  it("start script blocks stale-port false positives and verifies the new Gateway process", () => {
    const text = scriptText("start-local.sh")
    expect(text).toContain("assert_port_available")
    expect(text).toContain("verify_gateway_status")
    expect(text).toContain("runtime.pid")
    expect(text).toContain("paths.stateDir")
    expect(text).toContain("promptSources.checksum")
  })

  it("status script reports runtime ownership and Yeonjang extension count without mutating state", () => {
    const text = scriptText("status-local.sh")
    expect(text).toContain("pid_belongs_to_repo")
    expect(text).toContain("Gateway health")
    expect(text).toContain("yeonjangExtensions")
    expect(text).toContain("Channel config")
  })

  it("restart script enforces stop, port release, start, and health check order", () => {
    const text = scriptText("restart-local.sh")
    const stopIndex = text.indexOf("scripts/stop-local.sh")
    const releaseIndex = text.indexOf("wait_port_release", stopIndex)
    const startIndex = text.indexOf("scripts/start-local.sh")
    const healthIndex = text.indexOf("wait_http_ready", startIndex)
    expect(stopIndex).toBeGreaterThan(0)
    expect(releaseIndex).toBeGreaterThan(stopIndex)
    expect(startIndex).toBeGreaterThan(releaseIndex)
    expect(healthIndex).toBeGreaterThan(startIndex)
  })
})
