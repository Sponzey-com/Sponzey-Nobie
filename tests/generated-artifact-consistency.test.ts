import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const coreDir = join(repoRoot, "packages/core")
const sourceDir = join(coreDir, "src")
const outputDir = join(coreDir, `.artifact-consistency-test-${process.pid}`)

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

function walkFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) results.push(...walkFiles(path))
    else results.push(path)
  }
  return results
}

function generatedSuffix(path: string): string | undefined {
  return GENERATED_SUFFIXES.find((suffix) => path.endsWith(suffix))
}

function isGeneratedArtifact(path: string): boolean {
  return generatedSuffix(path) !== undefined
}

function stripGeneratedSuffix(path: string): string {
  const suffix = generatedSuffix(path)
  return suffix ? path.slice(0, -suffix.length) : path
}

function buildCleanCoreArtifacts(): void {
  rmSync(outputDir, { recursive: true, force: true })
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
    { cwd: repoRoot, stdio: "pipe" },
  )
}

describe("core generated artifact policy", () => {
  it("publishes dist as the public package contract", () => {
    const pkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8")) as {
      main?: string
      types?: string
      exports?: { "."?: { import?: string; types?: string } }
      files?: string[]
    }

    expect(pkg.main).toBe("./dist/index.js")
    expect(pkg.types).toBe("./dist/index.d.ts")
    expect(pkg.exports?.["."]?.import).toBe("./dist/index.js")
    expect(pkg.exports?.["."]?.types).toBe("./dist/index.d.ts")
    expect(pkg.files).toEqual(["dist"])
  })

  it(
    "keeps src compatibility artifacts synchronized with a clean TypeScript build",
    () => {
      buildCleanCoreArtifacts()

      try {
        const cleanGenerated = walkFiles(outputDir)
          .filter(isGeneratedArtifact)
          .map((file) => relative(outputDir, file))
          .sort()
        const cleanGeneratedSet = new Set(cleanGenerated)

        const missingFromSource = cleanGenerated.filter((relPath) => !existsSync(join(sourceDir, relPath)))
        const mismatchedWithSource = cleanGenerated.filter((relPath) => {
          const cleanPath = join(outputDir, relPath)
          const sourcePath = join(sourceDir, relPath)
          return existsSync(sourcePath) && readFileSync(cleanPath, "utf8") !== readFileSync(sourcePath, "utf8")
        })

        const unexpectedSourceOnly = walkFiles(sourceDir)
          .filter(isGeneratedArtifact)
          .map((file) => relative(sourceDir, file))
          .filter((relPath) => {
            if (cleanGeneratedSet.has(relPath)) return false
            return !JS_ONLY_COMPATIBILITY_STEMS.has(stripGeneratedSuffix(relPath))
          })
          .sort()

        expect({
          missingFromSource: missingFromSource.slice(0, 20),
          mismatchedWithSource: mismatchedWithSource.slice(0, 20),
          unexpectedSourceOnly: unexpectedSourceOnly.slice(0, 20),
        }).toEqual({
          missingFromSource: [],
          mismatchedWithSource: [],
          unexpectedSourceOnly: [],
        })
      } finally {
        rmSync(outputDir, { recursive: true, force: true })
      }
    },
    90_000,
  )

  it("keeps JS-only source artifacts explicit until removal", () => {
    const sourceOnlyStems = walkFiles(sourceDir)
      .filter(isGeneratedArtifact)
      .map((file) => relative(sourceDir, file))
      .map(stripGeneratedSuffix)
      .filter((stem, index, all) => all.indexOf(stem) === index)
      .filter((stem) => !existsSync(join(sourceDir, `${stem}.ts`)))
      .sort()

    expect(sourceOnlyStems).toEqual([...JS_ONLY_COMPATIBILITY_STEMS].sort())
  })
})
