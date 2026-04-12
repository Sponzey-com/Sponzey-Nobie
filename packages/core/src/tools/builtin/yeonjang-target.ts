import { getMqttExtensionSnapshots, type MqttExtensionSnapshot } from "../../mqtt/broker.js"
import { DEFAULT_YEONJANG_EXTENSION_ID } from "../../yeonjang/mqtt-client.js"

const EXPLICIT_EXTENSION_ID_PATTERN = /\byeonjang-[a-z0-9][\w-]*\b/iu
const WINDOWS_PATTERNS = [/\bwindows?\b/i, /\bwin(?:11|10)?\b/i, /윈도우/u]
const MAC_PATTERNS = [/\bmac(?:os)?\b/i, /\bosx\b/i, /맥북|맥/u]

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function isConnected(snapshot: MqttExtensionSnapshot): boolean {
  return normalize(snapshot.state) !== "offline"
}

function snapshotText(snapshot: MqttExtensionSnapshot): string[] {
  return [snapshot.extensionId, snapshot.displayName, snapshot.message]
    .map((value) => normalize(value))
    .filter(Boolean)
}

function looksLikeWindowsAlias(value: string): boolean {
  return value === "yeonjang-windows" || WINDOWS_PATTERNS.some((pattern) => pattern.test(value))
}

function looksLikeMacAlias(value: string): boolean {
  return value === DEFAULT_YEONJANG_EXTENSION_ID || value === "yeonjang-osx" || MAC_PATTERNS.some((pattern) => pattern.test(value))
}

function snapshotLooksWindows(snapshot: MqttExtensionSnapshot): boolean {
  return snapshotText(snapshot).some((value) => looksLikeWindowsAlias(value))
}

function snapshotLooksMac(snapshot: MqttExtensionSnapshot): boolean {
  return normalize(snapshot.extensionId) === normalize(DEFAULT_YEONJANG_EXTENSION_ID)
    || snapshotText(snapshot).some((value) => looksLikeMacAlias(value))
}

function resolveAliasAgainstSnapshots(snapshots: MqttExtensionSnapshot[], rawCandidate: string): string | undefined {
  const candidate = normalize(rawCandidate)
  if (!candidate) return undefined

  const exact = snapshots.find((snapshot) => normalize(snapshot.extensionId) === candidate)
  if (exact) return exact.extensionId

  const textMatch = snapshots.filter((snapshot) => snapshotText(snapshot).some((value) => value === candidate || value.includes(candidate) || candidate.includes(value)))
  if (textMatch.length === 1) return textMatch[0]?.extensionId

  if (looksLikeMacAlias(candidate)) {
    const preferred = snapshots.find((snapshot) => snapshotLooksMac(snapshot))
    if (preferred) return preferred.extensionId
  }

  if (looksLikeWindowsAlias(candidate)) {
    const windowsMatches = snapshots.filter((snapshot) => snapshotLooksWindows(snapshot))
    if (windowsMatches.length === 1) return windowsMatches[0]?.extensionId

    const nonMainSnapshots = snapshots.filter((snapshot) => normalize(snapshot.extensionId) !== normalize(DEFAULT_YEONJANG_EXTENSION_ID))
    if (nonMainSnapshots.length === 1) return nonMainSnapshots[0]?.extensionId
  }

  return undefined
}

function inferAliasFromUserMessage(userMessage: string | undefined): string | undefined {
  const normalizedMessage = userMessage?.trim() ?? ""
  if (!normalizedMessage) return undefined

  const explicit = normalizedMessage.match(EXPLICIT_EXTENSION_ID_PATTERN)?.[0]
  if (explicit) return explicit
  if (WINDOWS_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) return "windows"
  if (MAC_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) return "macos"
  return undefined
}

export function resolvePreferredYeonjangExtensionId(params: {
  requestedExtensionId?: string | undefined
  userMessage?: string | undefined
}): string | undefined {
  const connectedSnapshots = getMqttExtensionSnapshots().filter(isConnected)

  const requested = params.requestedExtensionId?.trim()
  if (requested) {
    return resolveAliasAgainstSnapshots(connectedSnapshots, requested) ?? requested
  }

  const inferredAlias = inferAliasFromUserMessage(params.userMessage)
  if (inferredAlias) {
    return resolveAliasAgainstSnapshots(connectedSnapshots, inferredAlias)
  }

  if (connectedSnapshots.length === 1) {
    return connectedSnapshots[0]?.extensionId
  }

  return undefined
}
