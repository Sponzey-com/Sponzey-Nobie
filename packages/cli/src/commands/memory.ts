import { cwd } from "node:process"

export async function memoryInitCommand(): Promise<void> {
  const { bootstrap, initNobieMd } = await import("@nobie/core")
  bootstrap()
  const target = initNobieMd(cwd())
  console.log(`✓ NOBIE.md: ${target}`)
  console.log("  파일을 열어 프로젝트 정보를 입력하세요.")
}

export async function memoryShowCommand(): Promise<void> {
  const { bootstrap, recentMemories } = await import("@nobie/core")
  bootstrap()
  const items = recentMemories(20)
  if (items.length === 0) {
    console.log("저장된 메모리가 없습니다.")
    return
  }
  console.log(`\n저장된 메모리 (최근 ${items.length}개):\n`)
  for (const item of items) {
    const date = new Date(item.created_at).toLocaleString("ko-KR")
    const tags = item.tags ? (JSON.parse(item.tags) as string[]).join(", ") : ""
    const importance = item.importance ?? "medium"
    console.log(`  [${date}] [${importance}${tags ? ` | ${tags}` : ""}]`)
    console.log(`  ${item.content}`)
    console.log()
  }
}
