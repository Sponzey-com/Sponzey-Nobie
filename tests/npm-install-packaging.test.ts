import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("npm install packaging", () => {
  it("defines a publishable Nobie meta package with the nobie binary", () => {
    const packageJson = readJson("packages/nobie/package.json")

    expect(packageJson).toMatchObject({
      name: "@sponzey/nobie",
      version: "0.1.0",
      type: "module",
    })
    expect(packageJson.private).not.toBe(true)
    expect(packageJson.bin).toEqual({ nobie: "./bin/nobie.js" })
    expect(packageJson.files).toEqual(expect.arrayContaining(["bin"]))
    expect(existsSync("packages/nobie/bin/nobie.js")).toBe(true)
  })

  it("keeps CLI, Core, and WebUI publishable for npm installation", () => {
    const cliPackage = readJson("packages/cli/package.json")
    const corePackage = readJson("packages/core/package.json")
    const webuiPackage = readJson("packages/webui/package.json")
    const cliSource = readFileSync("packages/cli/src/index.ts", "utf-8")

    expect(cliPackage.private).not.toBe(true)
    expect(cliPackage.files).toEqual(expect.arrayContaining(["dist"]))
    expect(corePackage.private).not.toBe(true)
    expect(corePackage.files).toEqual(expect.arrayContaining(["dist"]))
    expect(webuiPackage.private).not.toBe(true)
    expect(webuiPackage.files).toEqual(expect.arrayContaining(["dist"]))
    expect(cliSource).toContain('.command("start")')
  })

  it("stages the meta npm package with registry dependencies and Yeonjang optional packages", () => {
    const outputDir = makeTempDir("nobie-npm-package-")
    execFileSync("node", ["scripts/package-npm.mjs", "--output-dir", outputDir], {
      cwd: process.cwd(),
      stdio: "pipe",
    })

    const staged = readJson(join(outputDir, "nobie", "package.json"))
    expect(staged).toMatchObject({
      name: "@sponzey/nobie",
      bin: { nobie: "./bin/nobie.js" },
    })
    expect(staged.dependencies).toMatchObject({
      "@sponzey/cli": "0.1.0",
      "@sponzey/webui": "0.1.0",
    })
    expect(staged.optionalDependencies).toMatchObject({
      "@sponzey/yeonjang-darwin-arm64": "0.1.0",
      "@sponzey/yeonjang-linux-x64": "0.1.0",
      "@sponzey/yeonjang-win32-x64": "0.1.0",
    })
    expect(existsSync(join(outputDir, "nobie", "bin", "nobie.js"))).toBe(true)

    const core = readJson(join(outputDir, "core", "package.json"))
    const cli = readJson(join(outputDir, "cli", "package.json"))
    const webui = readJson(join(outputDir, "webui", "package.json"))
    expect(core.name).toBe("@sponzey/core")
    expect(cli).toMatchObject({
      name: "@sponzey/cli",
      dependencies: {
        "@sponzey/core": "0.1.0",
      },
    })
    expect(webui.name).toBe("@sponzey/webui")
    expect(readFileSync(join(outputDir, "cli", "dist", "index.js"), "utf-8")).toContain(
      "@sponzey/core",
    )
    expect(readFileSync(join(outputDir, "nobie", "bin", "nobie.js"), "utf-8")).toContain(
      "@sponzey/cli",
    )
  })

  it("stages a compiled Yeonjang platform package from a built binary", () => {
    const fixtureDir = makeTempDir("nobie-yeonjang-fixture-")
    const outputDir = makeTempDir("nobie-yeonjang-package-")
    const binaryPath = join(fixtureDir, "Yeonjang")
    writeFileSync(binaryPath, "fake-binary\n", "utf-8")

    execFileSync(
      "node",
      [
        "scripts/package-yeonjang-platform.mjs",
        "--target",
        "darwin-arm64",
        "--binary",
        binaryPath,
        "--output-dir",
        outputDir,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const staged = readJson(join(outputDir, "yeonjang-darwin-arm64", "package.json"))
    expect(staged).toMatchObject({
      name: "@sponzey/yeonjang-darwin-arm64",
      version: "0.1.0",
      os: ["darwin"],
      cpu: ["arm64"],
    })
    expect(existsSync(join(outputDir, "yeonjang-darwin-arm64", "bin", "nobie-yeonjang"))).toBe(
      true,
    )
    expect(existsSync(join(outputDir, "yeonjang-darwin-arm64", "index.js"))).toBe(true)

    execFileSync(
      "node",
      [
        "scripts/package-yeonjang-platform.mjs",
        "--target",
        "linux-x64",
        "--binary",
        binaryPath,
        "--output-dir",
        outputDir,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    )

    const linux = readJson(join(outputDir, "yeonjang-linux-x64", "package.json"))
    expect(linux).toMatchObject({
      name: "@sponzey/yeonjang-linux-x64",
      os: ["linux"],
      cpu: ["x64"],
      libc: ["glibc"],
    })
  })

  it("finds a Windows Yeonjang binary from the build target directory", () => {
    const targetDir = makeTempDir("nobie-yeonjang-windows-target-")
    const outputDir = makeTempDir("nobie-yeonjang-windows-package-")
    const binaryPath = join(targetDir, "release", "nobie-yeonjang.exe")
    mkdirSync(dirname(binaryPath), { recursive: true })
    writeFileSync(binaryPath, "fake-windows-binary\n", "utf-8")

    execFileSync(
      "node",
      [
        "scripts/package-yeonjang-platform.mjs",
        "--target",
        "win32-x64",
        "--binary",
        "Yeonjang/target/release/nobie-yeonjang.exe",
        "--output-dir",
        outputDir,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          YEONJANG_TARGET_DIR: targetDir,
        },
        stdio: "pipe",
      },
    )

    const staged = readJson(join(outputDir, "yeonjang-win32-x64", "package.json"))
    expect(staged).toMatchObject({
      name: "@sponzey/yeonjang-win32-x64",
      os: ["win32"],
      cpu: ["x64"],
    })
    expect(existsSync(join(outputDir, "yeonjang-win32-x64", "bin", "nobie-yeonjang.exe"))).toBe(
      true,
    )
  })

  it("documents the GitHub Actions release path for npm package publishing", () => {
    const workflow = readFileSync(".github/workflows/npm-release.yml", "utf-8")

    expect(workflow).toContain("scripts/package-npm.mjs")
    expect(workflow).toContain("scripts/package-yeonjang-platform.mjs")
    expect(workflow).toContain("macos-latest")
    expect(workflow).toContain("build-yeonjang-linux-package:")
    expect(workflow).toContain("image: ubuntu:20.04")
    expect(workflow).toMatch(/build-yeonjang-linux-package:[\s\S]*runs-on: ubuntu-latest/u)
    expect(workflow).toMatch(/build-yeonjang-linux-package:[\s\S]*bash scripts\/build-yeonjang-linux\.sh/u)
    expect(workflow).toContain("windows-latest")
    expect(workflow).toContain("github-release:")
    expect(workflow).toMatch(/github-release:[\s\S]*contents: write/u)
    expect(workflow).toContain("GH_REPO: ${{ github.repository }}")
    expect(workflow).toContain("gh release create")
    expect(workflow).toContain("gh release upload")
    expect(workflow).toContain("NODE_AUTH_TOKEN")
  })
})
