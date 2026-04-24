import { describe, expect, it } from "vitest"
import type { CommandPaletteSearchResult } from "../packages/webui/src/contracts/command-palette.ts"
import {
  commandPaletteA11yState,
  commandPaletteOptionId,
  groupCommandPaletteResults,
  moveCommandPaletteSelection,
  parseCommandPaletteInput,
} from "../packages/webui/src/lib/command-palette.ts"

const results: CommandPaletteSearchResult[] = [
  {
    id: "agent:alpha",
    kind: "agent",
    title: "Alpha",
    subtitle: "Research worker",
    target: { kind: "agent", id: "agent:alpha" },
    reasonCodes: ["agent_registry_result"],
  },
  {
    id: "team:alpha",
    kind: "team",
    title: "Alpha Team",
    subtitle: "Research team",
    target: { kind: "team", id: "team:alpha" },
    reasonCodes: ["team_registry_result"],
  },
  {
    id: "command:/focus",
    kind: "command",
    title: "/focus",
    command: "/focus agent:agent:alpha",
    reasonCodes: ["focus_command"],
  },
  {
    id: "agent-template:coding",
    kind: "agent_template",
    title: "Coding",
    reasonCodes: ["agent_template_result"],
  },
]

describe("task026 webui command palette helpers", () => {
  it("parses slash commands separately from search input", () => {
    expect(parseCommandPaletteInput("/subsessions list")).toEqual({
      mode: "slash_command",
      command: "/subsessions",
      query: "/subsessions list",
    })
    expect(parseCommandPaletteInput("alpha")).toEqual({ mode: "search", query: "alpha" })
  })

  it("groups search results in stable accessible sections", () => {
    const groups = groupCommandPaletteResults(results)
    expect(groups.map((group) => group.kind)).toEqual([
      "command",
      "agent",
      "team",
      "agent_template",
    ])
    expect(groups.find((group) => group.kind === "agent")?.items).toHaveLength(1)
  })

  it("wraps keyboard navigation and exposes aria active descendant", () => {
    expect(moveCommandPaletteSelection({ currentIndex: -1, itemCount: 4, direction: "down" })).toBe(0)
    expect(moveCommandPaletteSelection({ currentIndex: 0, itemCount: 4, direction: "up" })).toBe(3)
    expect(moveCommandPaletteSelection({ currentIndex: 1, itemCount: 4, direction: "end" })).toBe(3)
    expect(commandPaletteOptionId(2)).toBe("command-palette-option-2")
    expect(commandPaletteA11yState({ open: true, selectedIndex: 2, itemCount: 4 })).toEqual({
      role: "dialog",
      listRole: "listbox",
      expanded: true,
      activeDescendant: "command-palette-option-2",
    })
    expect(commandPaletteA11yState({ open: true, selectedIndex: -1, itemCount: 0 })).toEqual({
      role: "dialog",
      listRole: "listbox",
      expanded: true,
    })
  })
})
