export interface UpdateSnapshot {
  currentVersion: string
  latestVersion: string | null
  checkedAt: number | null
  updateAvailable: boolean
  status: "idle" | "latest" | "update_available" | "unsupported" | "error"
  message: string
  source: string | null
  repositoryUrl: string | null
  releaseUrl: string | null
}
