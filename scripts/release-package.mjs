#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, "..")
const releaseModulePath = resolve(rootDir, "packages/core/src/release/package.js")

function parseArgs(argv) {
  const options = {
    dryRun: false,
    json: false,
    copyPayload: true,
    outputDir: null,
    targetPlatforms: [],
    skipTests: false,
    skipSmoke: false,
    skipYeonjang: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--json") options.json = true
    else if (arg === "--no-copy") options.copyPayload = false
    else if (arg === "--skip-tests") options.skipTests = true
    else if (arg === "--skip-smoke") options.skipSmoke = true
    else if (arg === "--skip-yeonjang") options.skipYeonjang = true
    else if (arg === "--output-dir") options.outputDir = argv[++index] ?? null
    else if (arg === "--platform") {
      const value = argv[++index]
      if (value) options.targetPlatforms.push(value)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

function runCommand(command, options = {}) {
  const [program, ...args] = command
  const result = spawnSync(program, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...options.env },
  })
  if (result.status !== 0) throw new Error(`Command failed: ${command.join(" ")}`)
}

function filterPipelineSteps(steps, options) {
  return steps.filter((step) => {
    if (options.skipTests && (step.id === "unit-tests" || step.id === "typecheck")) return false
    if (options.skipSmoke && step.smoke) return false
    if (options.skipYeonjang && step.id.startsWith("yeonjang-")) return false
    if (step.id === "web-retrieval-live-smoke" && process.env.NOBIE_LIVE_WEB_SMOKE !== "1") return false
    if (step.id === "environment-preflight" || step.id === "package-manifest" || step.id === "live-smoke-gate") return false
    return true
  })
}

function printHumanSummary(result, dryRun) {
  const manifest = result.manifest
  console.log(`${dryRun ? "Release dry-run" : "Release package"}: ${manifest.releaseVersion}`)
  console.log(`  output: ${result.outputDir}`)
  console.log(`  manifest: ${result.manifestPath}`)
  console.log(`  checksums: ${result.checksumPath}`)
  console.log(`  artifacts: ${manifest.artifacts.filter((artifact) => artifact.status === "present").length} present, ${manifest.requiredMissing.length} required missing`)
  if (manifest.requiredMissing.length > 0) {
    for (const id of manifest.requiredMissing) console.log(`  missing: ${id}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(releaseModulePath)) {
    throw new Error(`Release module is missing. Build or sync core sidecars first: ${releaseModulePath}`)
  }

  const release = await import(releaseModulePath)
  const targetPlatforms = options.targetPlatforms.length > 0 ? options.targetPlatforms : undefined
  const outputDir = resolve(rootDir, options.outputDir ?? `release/${new Date().toISOString().replace(/[:.]/g, "-")}`)
  const previewManifest = release.buildReleaseManifest({ rootDir, targetPlatforms })

  if (!options.dryRun) {
    for (const step of filterPipelineSteps(previewManifest.pipeline.steps, options)) {
      runCommand(step.command)
    }
  }

  const result = release.writeReleasePackage({
    rootDir,
    outputDir,
    targetPlatforms,
    copyPayload: options.copyPayload && !options.dryRun,
  })

  if (!options.dryRun && result.manifest.requiredMissing.length > 0) {
    throw new Error(`Required release artifacts are missing: ${result.manifest.requiredMissing.join(", ")}`)
  }

  if (options.json) {
    console.log(JSON.stringify({ dryRun: options.dryRun, ...result, manifest: result.manifest }, null, 2))
  } else {
    printHumanSummary(result, options.dryRun)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
