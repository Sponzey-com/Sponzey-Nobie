import { describe, expect, it } from "vitest"
import {
  buildOrchestrationPolicyParityFields,
  formatOrchestrationParityPlacement,
} from "../packages/webui/src/lib/orchestration-surface-policy.ts"

describe("task008 orchestration policy parity", () => {
  it("classifies advanced policy fields across quick edit, advanced foldout, legacy overlay, and settings preview", () => {
    const fields = buildOrchestrationPolicyParityFields("en")
    const ids = fields.map((field) => field.id)

    expect(ids).toEqual([
      "memoryPolicy",
      "delegation",
      "rateLimit",
      "secretScopeId",
      "disabledToolNames",
    ])

    for (const field of fields) {
      expect(field.quickEdit).toBe("hidden")
      expect(field.advancedFoldout).toBe("preview")
      expect(field.legacyOverlay).toBe("editable")
      expect(field.settingsPreview).toBe("preview")
    }
  })

  it("formats parity placement labels without silently dropping unfinished fields", () => {
    expect(formatOrchestrationParityPlacement("hidden", "en")).toBe("hidden")
    expect(formatOrchestrationParityPlacement("preview", "en")).toBe("preview")
    expect(formatOrchestrationParityPlacement("editable", "en")).toBe("editable")
  })
})
