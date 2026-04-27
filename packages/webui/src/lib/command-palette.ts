import type {
  CommandPaletteResultKind,
  CommandPaletteSearchResult,
} from "../contracts/command-palette"

export interface CommandPaletteGroup {
  kind: CommandPaletteResultKind
  label: string
  items: CommandPaletteSearchResult[]
}

export interface CommandPaletteInputState {
  mode: "slash_command" | "search"
  command?: string
  query: string
}

const GROUP_LABELS: Record<CommandPaletteResultKind, string> = {
  command: "Commands",
  agent: "Agents",
  team: "Teams",
  sub_session: "Sub-sessions",
  agent_template: "Agent templates",
  team_template: "Team templates",
}

export function parseCommandPaletteInput(value: string): CommandPaletteInputState {
  const query = value.trim()
  if (query.startsWith("/")) {
    return { mode: "slash_command", command: query.split(/\s+/)[0] ?? query, query }
  }
  return { mode: "search", query }
}

export function groupCommandPaletteResults(
  results: CommandPaletteSearchResult[],
): CommandPaletteGroup[] {
  const groups = new Map<CommandPaletteResultKind, CommandPaletteSearchResult[]>()
  for (const result of results) {
    groups.set(result.kind, [...(groups.get(result.kind) ?? []), result])
  }
  return (Object.keys(GROUP_LABELS) as CommandPaletteResultKind[])
    .map((kind) => ({
      kind,
      label: GROUP_LABELS[kind],
      items: groups.get(kind) ?? [],
    }))
    .filter((group) => group.items.length > 0)
}

export function moveCommandPaletteSelection(input: {
  currentIndex: number
  itemCount: number
  direction: "up" | "down" | "home" | "end"
}): number {
  if (input.itemCount <= 0) return -1
  if (input.direction === "home") return 0
  if (input.direction === "end") return input.itemCount - 1
  if (input.currentIndex < 0) return input.direction === "down" ? 0 : input.itemCount - 1
  if (input.direction === "down") return (input.currentIndex + 1) % input.itemCount
  return (input.currentIndex - 1 + input.itemCount) % input.itemCount
}

export function commandPaletteOptionId(index: number): string {
  return `command-palette-option-${index}`
}

export function commandPaletteA11yState(input: {
  open: boolean
  selectedIndex: number
  itemCount: number
}): {
  role: "dialog"
  listRole: "listbox"
  activeDescendant?: string
  expanded: boolean
} {
  return {
    role: "dialog",
    listRole: "listbox",
    expanded: input.open,
    ...(input.open && input.selectedIndex >= 0 && input.selectedIndex < input.itemCount
      ? { activeDescendant: commandPaletteOptionId(input.selectedIndex) }
      : {}),
  }
}
