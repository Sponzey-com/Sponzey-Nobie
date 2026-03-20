/**
 * `nobie index` — file indexing command.
 */

import { resolve } from "node:path"

export async function indexCommand(
  targetPath: string,
  opts: { exclude?: string[]; stats?: boolean },
): Promise<void> {
  const { bootstrap } = await import("@nobie/core")
  bootstrap()

  const { fileIndexer } = await import("@nobie/core/src/memory/file-indexer.js" as string)

  const absPath = resolve(targetPath)
  console.log(`인덱싱 시작: ${absPath}`)

  if (opts.stats) {
    const stats = fileIndexer.getStats()
    console.log(`\n현재 인덱스 상태:`)
    console.log(`  파일 수:    ${stats.files}`)
    console.log(`  청크 수:    ${stats.chunks}`)
    console.log(`  벡터 임베딩: ${stats.embedded}`)
    return
  }

  let fileCount = 0
  let chunkCount = 0

  const result = await fileIndexer.indexDirectory(absPath, {
    exclude: opts.exclude,
    onProgress: (file: string, chunks: number) => {
      fileCount++
      chunkCount += chunks
      process.stdout.write(`\r  ${fileCount}개 파일 처리 중... (${chunkCount} chunks)`)
    },
  })

  console.log(`\n\n✓ 인덱싱 완료`)
  console.log(`  파일:  ${result.files}개`)
  console.log(`  청크:  ${result.chunks}개`)
}

export async function indexClearCommand(targetPath?: string): Promise<void> {
  const { bootstrap } = await import("@nobie/core")
  bootstrap()

  const { fileIndexer } = await import("@nobie/core/src/memory/file-indexer.js" as string)

  if (targetPath) {
    const absPath = resolve(targetPath)
    fileIndexer.removeDirectory(absPath)
    console.log(`✓ "${absPath}" 인덱스 제거 완료`)
  } else {
    const { getDb } = await import("@nobie/core")
    getDb().prepare("DELETE FROM file_chunks").run()
    console.log("✓ 전체 파일 인덱스 초기화 완료")
  }
}
