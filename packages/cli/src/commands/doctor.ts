import type { DoctorMode, DoctorReport, DoctorStatus } from "@nobie/core"

export interface DoctorCommandOptions {
  quick?: boolean
  full?: boolean
  json?: boolean
  write?: boolean
}

const STATUS_ICON: Record<DoctorStatus, string> = {
  ok: "OK",
  warning: "WARN",
  blocked: "BLOCKED",
  unknown: "UNKNOWN",
}

function resolveMode(options: DoctorCommandOptions): DoctorMode {
  return options.full ? "full" : "quick"
}

function printTextReport(report: DoctorReport, artifactPath: string | null): void {
  console.log(`Nobie doctor (${report.mode})`)
  console.log(`Status: ${STATUS_ICON[report.overallStatus]}`)
  console.log(`Runtime manifest: ${report.runtimeManifestId}`)
  console.log(`Checks: ok=${report.summary.ok}, warning=${report.summary.warning}, blocked=${report.summary.blocked}, unknown=${report.summary.unknown}`)
  if (artifactPath) console.log(`Report: ${artifactPath}`)
  for (const check of report.checks) {
    const guide = check.guide ? ` | guide: ${check.guide}` : ""
    console.log(`- ${STATUS_ICON[check.status]} ${check.name}: ${check.message}${guide}`)
  }
}

export async function doctorCommand(options: DoctorCommandOptions): Promise<void> {
  const core = await import("@nobie/core")
  const mode = resolveMode(options)
  const report = core.runDoctor({ mode })
  const artifactPath = options.write ? core.writeDoctorReportArtifact(report) : null

  if (options.json) {
    console.log(JSON.stringify({ report, artifactPath }, null, 2))
    return
  }

  printTextReport(report, artifactPath)
}
