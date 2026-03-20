import type { CapabilityStatus } from "../contracts/capabilities"

const STYLE_MAP: Record<CapabilityStatus, string> = {
  ready: "bg-green-100 text-green-700 border-green-200",
  disabled: "bg-amber-100 text-amber-800 border-amber-200",
  planned: "bg-slate-100 text-slate-700 border-slate-200",
  error: "bg-red-100 text-red-700 border-red-200",
}

const LABEL_MAP: Record<CapabilityStatus, string> = {
  ready: "READY",
  disabled: "DISABLED",
  planned: "PLANNED",
  error: "ERROR",
}

export function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${STYLE_MAP[status]}`}>
      {LABEL_MAP[status]}
    </span>
  )
}
