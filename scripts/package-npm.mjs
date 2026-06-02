#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, "..")

const YEONJANG_OPTIONAL_PACKAGES = [
  "@sponzey/yeonjang-darwin-arm64",
  "@sponzey/yeonjang-darwin-x64",
  "@sponzey/yeonjang-linux-x64",
  "@sponzey/yeonjang-win32-x64",
]

function parseArgs(argv) {
  const options = {
    outputDir: resolve(rootDir, "release/npm"),
    version: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--output-dir") options.outputDir = resolve(argv[++index] ?? options.outputDir)
    else if (arg === "--version") options.version = argv[++index] ?? null
    else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function packageVersion(explicitVersion) {
  if (explicitVersion?.trim()) return explicitVersion.trim().replace(/^v/i, "")
  const rootPackage = readJson(join(rootDir, "package.json"))
  return String(rootPackage.version ?? "0.1.0")
}

function rewriteTextFiles(dir, replacements) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      rewriteTextFiles(path, replacements)
      continue
    }
    if (!/\.(?:js|mjs|cjs|d\.ts|map)$/u.test(entry)) continue
    let content = readFileSync(path, "utf-8")
    for (const [from, to] of replacements) content = content.split(from).join(to)
    writeFileSync(path, content, "utf-8")
  }
}

function stagePackageDir(outputDir, packageDirName, packageJson) {
  const targetDir = join(outputDir, packageDirName)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  writeJson(join(targetDir, "package.json"), packageJson)
  return targetDir
}

function copyBuiltPackage(outputDir, input) {
  const sourceDir = join(rootDir, "packages", input.sourcePackageDir)
  const sourcePackage = readJson(join(sourceDir, "package.json"))
  const targetDir = stagePackageDir(outputDir, input.targetPackageDir, {
    ...sourcePackage,
    name: input.name,
    version: input.version,
    private: undefined,
    scripts: undefined,
    devDependencies: undefined,
    dependencies: input.dependencies,
  })
  for (const item of input.copy) {
    cpSync(join(sourceDir, item), join(targetDir, item), { recursive: true })
  }
  if (input.replacements) rewriteTextFiles(targetDir, input.replacements)
  return targetDir
}

function copyMetaPackage(outputDir, version) {
  const sourceDir = join(rootDir, "packages", "nobie")
  const sourcePackage = readJson(join(sourceDir, "package.json"))
  const optionalDependencies = Object.fromEntries(
    YEONJANG_OPTIONAL_PACKAGES.map((name) => [name, version]),
  )
  const targetDir = stagePackageDir(outputDir, "nobie", {
    ...sourcePackage,
    version,
    dependencies: {
      "@sponzey/cli": version,
      "@sponzey/webui": version,
    },
    optionalDependencies,
  })
  cpSync(join(sourceDir, "bin"), join(targetDir, "bin"), { recursive: true })
  rewriteTextFiles(targetDir, [["@nobie/cli", "@sponzey/cli"]])
  chmodSync(join(targetDir, "bin", "nobie.js"), 0o755)
  return targetDir
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const version = packageVersion(options.version)
  mkdirSync(options.outputDir, { recursive: true })
  copyBuiltPackage(options.outputDir, {
    sourcePackageDir: "core",
    targetPackageDir: "core",
    name: "@sponzey/core",
    version,
    dependencies: readJson(join(rootDir, "packages", "core", "package.json")).dependencies,
    copy: ["dist"],
  })
  copyBuiltPackage(options.outputDir, {
    sourcePackageDir: "webui",
    targetPackageDir: "webui",
    name: "@sponzey/webui",
    version,
    dependencies: {},
    copy: ["dist"],
  })
  copyBuiltPackage(options.outputDir, {
    sourcePackageDir: "cli",
    targetPackageDir: "cli",
    name: "@sponzey/cli",
    version,
    dependencies: {
      "@sponzey/core": version,
      commander: readJson(join(rootDir, "packages", "cli", "package.json")).dependencies.commander,
    },
    copy: ["dist"],
    replacements: [["@nobie/core", "@sponzey/core"]],
  })
  const targetDir = copyMetaPackage(options.outputDir, version)
  console.log(`Nobie npm package staged: ${targetDir}`)
}

main()
