export type DoctorStatus = "ok" | "warning" | "blocked" | "unknown"
export type DoctorMode = "quick" | "full"

export interface DoctorCheckResult {
  name: string
  status: DoctorStatus
  message: string
  detail: Record<string, unknown>
  guide: string | null
}

export interface DoctorReport {
  kind: "nobie.doctor.report"
  version: 1
  id: string
  mode: DoctorMode
  createdAt: string
  overallStatus: DoctorStatus
  runtimeManifestId: string
  checks: DoctorCheckResult[]
  summary: {
    ok: number
    warning: number
    blocked: number
    unknown: number
  }
  manifest: {
    id: string
    app: {
      displayVersion: string
      gitDescribe: string | null
    }
    database: {
      currentVersion: number
      latestVersion: number
      upToDate: boolean
    }
    promptSources: {
      count: number
      checksum: string | null
      localeParityOk: boolean
    }
    provider: {
      provider: string
      model: string
      profileId: string
      runtimeProfileId?: string
      capabilityMatrix?: {
        adapterType: string
        authType: string
        endpointMismatch: { status: string; detail: string }
        embeddings: { status: string; detail: string }
        lastCheckResult: { status: string; message: string; sourceUrl: string | null }
      }
    }
  }
}

export interface DoctorResponse {
  ok: boolean
  report: DoctorReport
  artifactPath: string | null
}
