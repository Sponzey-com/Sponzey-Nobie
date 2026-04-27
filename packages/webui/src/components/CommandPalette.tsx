import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "../api/client"
import type {
  CommandPaletteSearchResult,
  FocusBinding,
  FocusTarget,
} from "../contracts/command-palette"
import {
  commandPaletteA11yState,
  commandPaletteOptionId,
  groupCommandPaletteResults,
  moveCommandPaletteSelection,
  parseCommandPaletteInput,
} from "../lib/command-palette"
import { useUiI18n } from "../lib/ui-i18n"

function focusLabel(binding: FocusBinding | null): string {
  if (!binding) return "No focus"
  const label = binding.target.label ?? binding.target.id
  if (binding.target.kind === "agent") return `Agent: ${label}`
  if (binding.target.kind === "team") return `Team: ${label}`
  return `Sub-session: ${label}`
}

function targetLabel(target: FocusTarget): string {
  return target.label ?? target.id
}

function resultKindLabel(kind: CommandPaletteSearchResult["kind"]): string {
  switch (kind) {
    case "agent":
      return "Agent"
    case "team":
      return "Team"
    case "sub_session":
      return "Sub-session"
    case "agent_template":
      return "Agent template"
    case "team_template":
      return "Team template"
    case "command":
      return "Command"
  }
}

export function CommandPalette({ threadId }: { threadId: string }) {
  const { text } = useUiI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CommandPaletteSearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [focus, setFocus] = useState<FocusBinding | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => groupCommandPaletteResults(results), [results])
  const flatResults = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const a11y = commandPaletteA11yState({
    open,
    selectedIndex,
    itemCount: flatResults.length,
  })

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    let cancelled = false
    void api.getFocus(threadId).then((response) => {
      if (!cancelled) setFocus(response.binding)
    }).catch(() => {
      if (!cancelled) setFocus(null)
    })
    return () => {
      cancelled = true
    }
  }, [open, threadId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void api.commandPaletteSearch({ q: query, limit: 80 })
        .then((response) => {
          if (cancelled) return
          setResults(response.results)
          setSelectedIndex(response.results.length > 0 ? 0 : -1)
          setMessage("")
        })
        .catch((error) => {
          if (cancelled) return
          setResults([])
          setSelectedIndex(-1)
          setMessage(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  async function refreshFocus() {
    try {
      const response = await api.getFocus(threadId)
      setFocus(response.binding)
    } catch {
      setFocus(null)
    }
  }

  async function executeSlashCommand(commandText: string) {
    const response = await api.executeCommand({ command: commandText, threadId })
    setMessage(response.reasonCode)
    await refreshFocus()
    if (response.ok && commandText.trim() === "/unfocus") setQuery("")
  }

  async function activateResult(result: CommandPaletteSearchResult) {
    try {
      if (result.kind === "agent_template") {
        await api.instantiateAgentTemplate(result.id.replace(/^agent-template:/, ""))
        setMessage("agent_template_draft_created")
        return
      }
      if (result.kind === "team_template") {
        await api.instantiateTeamTemplate(result.id.replace(/^team-template:/, ""))
        setMessage("team_template_draft_created")
        return
      }
      if (result.target) {
        const response = await api.setFocus(threadId, result.target)
        setFocus(response.focus.binding)
        setMessage(`focus: ${targetLabel(result.target)}`)
        return
      }
      if (result.command) {
        setQuery(result.command)
        inputRef.current?.focus()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function submitCurrent() {
    const state = parseCommandPaletteInput(query)
    if (state.mode === "slash_command" && state.query) {
      try {
        await executeSlashCommand(state.query)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
      return
    }
    const selected = flatResults[selectedIndex]
    if (selected) await activateResult(selected)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      const direction =
        event.key === "ArrowDown"
          ? "down"
          : event.key === "ArrowUp"
            ? "up"
            : event.key === "Home"
              ? "home"
              : "end"
      setSelectedIndex((currentIndex) =>
        moveCommandPaletteSelection({
          currentIndex,
          itemCount: flatResults.length,
          direction,
        }),
      )
      return
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submitCurrent()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-semibold text-stone-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        <span>{text("명령", "Command")}</span>
        <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-stone-400">
          K
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] bg-stone-950/50 px-4 py-10 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <section
            role={a11y.role}
            aria-modal="true"
            aria-label={text("명령 팔레트", "Command palette")}
            className="mx-auto flex max-h-[80vh] max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
          >
            <div className="border-b border-stone-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {text("명령 팔레트", "Command Palette")}
                  </div>
                  <div className="mt-1 truncate text-xs text-stone-500">{focusLabel(focus)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void api.clearFocus(threadId).then(() => {
                      setFocus(null)
                      setMessage("focus_binding_cleared")
                    })
                  }}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                >
                  {text("초점 해제", "Unfocus")}
                </button>
              </div>
              <label htmlFor="command-palette-input" className="sr-only">
                {text("검색 또는 명령 입력", "Search or enter command")}
              </label>
              <input
                ref={inputRef}
                id="command-palette-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                role="combobox"
                aria-expanded={a11y.expanded}
                aria-controls="command-palette-results"
                aria-activedescendant={a11y.activeDescendant}
                placeholder={text("agent, team, sub-session 또는 /command", "agent, team, sub-session, or /command")}
                className="mt-4 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
              />
              {message ? (
                <div className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
                  {message}
                </div>
              ) : null}
            </div>

            <div
              id="command-palette-results"
              role={a11y.listRole}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {loading ? (
                <output className="block px-3 py-6 text-center text-sm text-stone-500">
                  {text("검색 중...", "Searching...")}
                </output>
              ) : groups.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-stone-500">
                  {text("결과 없음", "No results")}
                </div>
              ) : (
                groups.map((group) => {
                  let groupOffset = 0
                  for (const previous of groups) {
                    if (previous.kind === group.kind) break
                    groupOffset += previous.items.length
                  }
                  return (
                    <div key={group.kind} className="py-2">
                      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                        {group.label}
                      </div>
                      {group.items.map((result, index) => {
                        const flatIndex = groupOffset + index
                        const selected = flatIndex === selectedIndex
                        return (
                          <button
                            key={`${result.kind}:${result.id}`}
                            id={commandPaletteOptionId(flatIndex)}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            onClick={() => void activateResult(result)}
                            className={`block w-full rounded-xl px-3 py-3 text-left focus:outline-none ${
                              selected ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate text-sm font-semibold">{result.title}</span>
                              <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${
                                selected ? "bg-white/10 text-stone-200" : "bg-stone-100 text-stone-500"
                              }`}>
                                {resultKindLabel(result.kind)}
                              </span>
                            </div>
                            {result.subtitle ? (
                              <div className={`mt-1 line-clamp-2 text-xs leading-5 ${
                                selected ? "text-stone-300" : "text-stone-500"
                              }`}>
                                {result.subtitle}
                              </div>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
