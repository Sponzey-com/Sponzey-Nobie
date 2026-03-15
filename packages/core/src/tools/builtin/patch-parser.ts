export type PatchOperation =
  | { type: "update"; filePath: string; hunks: Hunk[] }
  | { type: "add"; filePath: string; content: string }
  | { type: "delete"; filePath: string }

export interface Hunk {
  context: string[] // @@ 이후 컨텍스트 힌트 라인들
  changes: Array<{ op: "add" | "remove" | "context"; line: string }>
}

export interface ParsedPatch {
  operations: PatchOperation[]
  hasDeletes: boolean
}

export function parsePatch(patch: string): ParsedPatch {
  const lines = patch.split(/\r?\n/)
  const operations: PatchOperation[] = []
  let hasDeletes = false

  let i = 0

  // Skip *** Begin Patch line if present
  if (lines[i]?.trim() === "*** Begin Patch") {
    i++
  }

  while (i < lines.length) {
    const line = lines[i] ?? ""

    if (line.trim() === "*** End Patch") {
      break
    }

    if (line.startsWith("*** Update File:")) {
      const filePath = line.slice("*** Update File:".length).trim()
      i++
      const hunks: Hunk[] = []
      let currentHunk: Hunk | null = null

      while (i < lines.length) {
        const l = lines[i] ?? ""
        if (l.startsWith("***")) break

        if (l.startsWith("@@ ")) {
          // Save previous hunk if exists
          if (currentHunk !== null && currentHunk.changes.length > 0) {
            hunks.push(currentHunk)
          }
          const contextHint = l.slice(3).trim()
          currentHunk = {
            context: contextHint ? [contextHint] : [],
            changes: [],
          }
          i++
          continue
        }

        if (currentHunk === null) {
          // Create implicit hunk if no @@ found yet
          currentHunk = { context: [], changes: [] }
        }

        if (l.startsWith("-")) {
          currentHunk.changes.push({ op: "remove", line: l.slice(1) })
        } else if (l.startsWith("+")) {
          currentHunk.changes.push({ op: "add", line: l.slice(1) })
        } else if (l.startsWith(" ")) {
          currentHunk.changes.push({ op: "context", line: l.slice(1) })
        } else {
          // Treat as context line
          currentHunk.changes.push({ op: "context", line: l })
        }
        i++
      }

      if (currentHunk !== null && currentHunk.changes.length > 0) {
        hunks.push(currentHunk)
      }

      operations.push({ type: "update", filePath, hunks })
      continue
    }

    if (line.startsWith("*** Add File:")) {
      const filePath = line.slice("*** Add File:".length).trim()
      i++
      const contentLines: string[] = []

      while (i < lines.length) {
        const l = lines[i] ?? ""
        if (l.startsWith("***")) break
        contentLines.push(l)
        i++
      }

      operations.push({ type: "add", filePath, content: contentLines.join("\n") })
      continue
    }

    if (line.startsWith("*** Delete File:")) {
      const filePath = line.slice("*** Delete File:".length).trim()
      hasDeletes = true
      operations.push({ type: "delete", filePath })
      i++
      continue
    }

    i++
  }

  return { operations, hasDeletes }
}
