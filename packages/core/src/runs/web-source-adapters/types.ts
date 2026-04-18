import crypto from "node:crypto"
import type { RetrievalTargetKind } from "../web-retrieval-session.js"

export type WebSourceAdapterStatus = "active" | "degraded"

export interface WebSourceAdapterMetadata {
  adapterId: string
  adapterVersion: string
  parserVersion: string
  sourceDomains: string[]
  supportedTargetKinds: RetrievalTargetKind[]
  checksum: string
  status: WebSourceAdapterStatus
  degradedReason?: string | null
}

export interface WebSourceAdapterFixtureVersionCheck {
  ok: boolean
  adapterId: string
  expectedParserVersion: string
  actualParserVersion: string
  message: string
}

export function stableAdapterChecksum(input: Omit<WebSourceAdapterMetadata, "checksum" | "status" | "degradedReason">): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    parserVersion: input.parserVersion,
    sourceDomains: [...input.sourceDomains].sort(),
    supportedTargetKinds: [...input.supportedTargetKinds].sort(),
  })).digest("hex").slice(0, 16)
}

export function withAdapterChecksum(input: Omit<WebSourceAdapterMetadata, "checksum" | "status"> & { status?: WebSourceAdapterStatus }): WebSourceAdapterMetadata {
  return {
    ...input,
    checksum: stableAdapterChecksum(input),
    status: input.status ?? "active",
  }
}

export function compareAdapterFixtureParserVersion(input: {
  metadata: WebSourceAdapterMetadata
  expectedParserVersion: string
}): WebSourceAdapterFixtureVersionCheck {
  const ok = input.metadata.parserVersion === input.expectedParserVersion
  return {
    ok,
    adapterId: input.metadata.adapterId,
    expectedParserVersion: input.expectedParserVersion,
    actualParserVersion: input.metadata.parserVersion,
    message: ok
      ? "adapter fixture parser version matches"
      : `adapter fixture parser version mismatch: expected ${input.expectedParserVersion}, actual ${input.metadata.parserVersion}`,
  }
}
