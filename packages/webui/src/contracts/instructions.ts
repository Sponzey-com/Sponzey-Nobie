export interface ActiveInstructionSource {
  path: string
  scope: "global" | "project"
  level: number
  loaded: boolean
  size: number
  error?: string
}

export interface ActiveInstructionsResponse {
  workDir: string
  gitRoot?: string
  mergedText: string
  sources: ActiveInstructionSource[]
}
