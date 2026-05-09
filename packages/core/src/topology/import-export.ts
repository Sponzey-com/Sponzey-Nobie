import JSON5 from "json5"
import {
  validateEnterpriseTopology,
  type EnterpriseTopology,
  type EnterpriseTopologyValidationIssue,
} from "../contracts/enterprise-topology.js"

export type TopologyImportExportFormat = "json" | "yaml"

export type TopologyDocumentParseResult =
  | { ok: true; topology: EnterpriseTopology; format: TopologyImportExportFormat }
  | { ok: false; issues: EnterpriseTopologyValidationIssue[]; format?: TopologyImportExportFormat }

interface ParsedYamlLine {
  indent: number
  content: string
}

function importIssue(path: string, reasonCode: string, message: string): EnterpriseTopologyValidationIssue {
  return {
    path,
    code: "enterprise_contract_validation_failed",
    reasonCode: "enterprise_contract_validation_failed",
    message: `${reasonCode}: ${message}`,
  }
}

export function normalizeTopologyDocumentFormat(value: unknown): TopologyImportExportFormat {
  return value === "yaml" || value === "yml" ? "yaml" : "json"
}

export function inferTopologyDocumentFormat(sourceRef: string | undefined): TopologyImportExportFormat {
  const normalized = sourceRef?.toLowerCase() ?? ""
  return normalized.endsWith(".yaml") || normalized.endsWith(".yml") ? "yaml" : "json"
}

export function parseTopologyImportDocument(input: {
  content?: unknown
  topology?: unknown
  format?: unknown
  sourceRef?: unknown
}): TopologyDocumentParseResult {
  const format = input.format !== undefined
    ? normalizeTopologyDocumentFormat(input.format)
    : inferTopologyDocumentFormat(typeof input.sourceRef === "string" ? input.sourceRef : undefined)
  let value: unknown = input.topology

  if (typeof input.content === "string") {
    try {
      value = format === "yaml" ? parseYamlDocument(input.content) : JSON5.parse(input.content)
    } catch (error) {
      return {
        ok: false,
        format,
        issues: [importIssue("$", "topology_import_parse_failed", error instanceof Error ? error.message : "Import document could not be parsed.")],
      }
    }
  }

  const validation = validateEnterpriseTopology(value)
  return validation.ok
    ? { ok: true, topology: validation.value, format }
    : { ok: false, format, issues: validation.issues }
}

export function stringifyTopologyDocument(value: unknown, format: TopologyImportExportFormat): string {
  return format === "yaml" ? stringifyYaml(value) : JSON.stringify(value, null, 2)
}

function parseYamlDocument(text: string): unknown {
  const lines = text
    .split(/\r?\n/)
    .map((raw): ParsedYamlLine | null => {
      const withoutComment = stripYamlComment(raw)
      if (withoutComment.trim().length === 0) return null
      return {
        indent: withoutComment.length - withoutComment.trimStart().length,
        content: withoutComment.trim(),
      }
    })
    .filter((line): line is ParsedYamlLine => line !== null)
  if (lines.length === 0) return {}

  let index = 0
  const parseBlock = (indent: number): unknown => {
    const line = lines[index]
    if (!line || line.indent < indent) return {}
    return line.content.startsWith("-") && line.indent === indent ? parseArray(indent) : parseObject(indent)
  }

  const parseArray = (indent: number): unknown[] => {
    const values: unknown[] = []
    while (index < lines.length) {
      const line = lines[index]
      if (!line || line.indent !== indent || !line.content.startsWith("-")) break
      const rest = line.content.slice(1).trim()
      index += 1
      if (!rest) {
        values.push(parseBlock(indent + 2))
        continue
      }
      const pair = parseYamlKeyValue(rest)
      if (pair) {
        const item: Record<string, unknown> = {}
        item[pair.key] = pair.valueText === undefined ? parseBlock(indent + 2) : parseYamlScalar(pair.valueText)
        const nested = index < lines.length && lines[index]!.indent >= indent + 2
          ? parseObject(indent + 2)
          : undefined
        if (isRecord(nested)) Object.assign(item, nested)
        values.push(item)
        continue
      }
      values.push(parseYamlScalar(rest))
    }
    return values
  }

  const parseObject = (indent: number): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    while (index < lines.length) {
      const line = lines[index]
      if (!line || line.indent !== indent || line.content.startsWith("-")) break
      const pair = parseYamlKeyValue(line.content)
      if (!pair) throw new Error(`Invalid YAML mapping line: ${line.content}`)
      index += 1
      result[pair.key] = pair.valueText === undefined ? parseBlock(indent + 2) : parseYamlScalar(pair.valueText)
    }
    return result
  }

  const parsed = parseBlock(lines[0]!.indent)
  if (index < lines.length) throw new Error(`Unexpected YAML line: ${lines[index]!.content}`)
  return parsed
}

function stripYamlComment(raw: string): string {
  let quote: "'" | "\"" | null = null
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if ((char === "'" || char === "\"") && raw[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char
    }
    if (char === "#" && quote === null) return raw.slice(0, index)
  }
  return raw
}

function parseYamlKeyValue(content: string): { key: string; valueText?: string } | null {
  const colonIndex = content.indexOf(":")
  if (colonIndex <= 0) return null
  const key = content.slice(0, colonIndex).trim()
  const valueText = content.slice(colonIndex + 1).trim()
  if (!key) return null
  return {
    key: unquoteYamlString(key),
    ...(valueText ? { valueText } : {}),
  }
}

function parseYamlScalar(valueText: string): unknown {
  if (valueText === "[]") return []
  if (valueText === "{}") return {}
  if (valueText === "null" || valueText === "~") return null
  if (valueText === "true") return true
  if (valueText === "false") return false
  if (/^-?\d+(?:\.\d+)?$/.test(valueText)) return Number(valueText)
  return unquoteYamlString(valueText)
}

function unquoteYamlString(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n")
  }
  return value
}

function stringifyYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return value.map((item) => {
      if (isScalar(item)) return `${pad}- ${formatYamlScalar(item)}`
      return `${pad}-\n${stringifyYaml(item, indent + 2)}`
    }).join("\n")
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
    if (entries.length === 0) return "{}"
    return entries.map(([key, entryValue]) => {
      if (isScalar(entryValue) || isEmptyCollection(entryValue)) {
        return `${pad}${key}: ${formatYamlScalar(entryValue)}`
      }
      return `${pad}${key}:\n${stringifyYaml(entryValue, indent + 2)}`
    }).join("\n")
  }
  return `${pad}${formatYamlScalar(value)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object"
}

function isEmptyCollection(value: unknown): boolean {
  return (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0)
}

function formatYamlScalar(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : stringifyYaml(value, 0)
  if (isRecord(value)) return Object.keys(value).length === 0 ? "{}" : stringifyYaml(value, 0)
  if (value === null || value === undefined) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const text = String(value)
  if (/^[A-Za-z0-9_./:@-]+$/.test(text) && !["true", "false", "null"].includes(text)) return text
  return JSON.stringify(text)
}
