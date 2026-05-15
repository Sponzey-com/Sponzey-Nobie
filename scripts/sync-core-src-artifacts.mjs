#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const coreDir = join(rootDir, "packages/core")
const sourceDir = join(coreDir, "src")
const outputDir = join(coreDir, ".artifact-consistency-sync")

const GENERATED_SUFFIXES = [".d.ts.map", ".js.map", ".d.ts", ".js"]

const JS_ONLY_COMPATIBILITY_STEMS = new Set([
  "api/routes/oauth",
  "auth/chatgpt-oauth",
  "llm/index",
  "llm/providers/anthropic",
  "llm/providers/gemini",
  "llm/providers/openai",
  "llm/types",
  "memory/sidekick-md",
])

function walkFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) results.push(...walkFiles(path))
    else results.push(path)
  }
  return results
}

function generatedSuffix(path) {
  return GENERATED_SUFFIXES.find((suffix) => path.endsWith(suffix))
}

function isGeneratedArtifact(path) {
  return generatedSuffix(path) !== undefined
}

function stripGeneratedSuffix(path) {
  const suffix = generatedSuffix(path)
  return suffix ? path.slice(0, -suffix.length) : path
}

function copyGeneratedArtifacts() {
  const generatedFiles = walkFiles(outputDir).filter(isGeneratedArtifact)
  const generatedRelPaths = new Set()

  for (const file of generatedFiles) {
    const relPath = relative(outputDir, file)
    generatedRelPaths.add(relPath)
    const target = join(sourceDir, relPath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(file, target)
  }

  const unexpectedStaleFiles = walkFiles(sourceDir)
    .filter(isGeneratedArtifact)
    .map((file) => relative(sourceDir, file))
    .filter((relPath) => {
      if (generatedRelPaths.has(relPath)) return false
      return !JS_ONLY_COMPATIBILITY_STEMS.has(stripGeneratedSuffix(relPath))
    })

  if (unexpectedStaleFiles.length > 0) {
    throw new Error(
      [
        "Unexpected stale core src generated artifacts remain.",
        "Remove them or add a documented compatibility exception:",
        ...unexpectedStaleFiles.map((file) => `- ${file}`),
      ].join("\n"),
    )
  }

  return { copied: generatedFiles.length, compatibilityOnly: JS_ONLY_COMPATIBILITY_STEMS.size }
}

try {
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "-p",
      "packages/core/tsconfig.json",
      "--outDir",
      outputDir,
      "--tsBuildInfoFile",
      join(outputDir, ".tsbuildinfo"),
    ],
    { cwd: rootDir, stdio: "inherit" },
  )
  const result = copyGeneratedArtifacts()
  console.log(
    `Synced ${result.copied} generated core src artifacts. JS-only compatibility stems: ${result.compatibilityOnly}.`,
  )
} finally {
  rmSync(outputDir, { recursive: true, force: true })
}
