export type IntakeNormalizedRequestLanguage = "ko" | "en" | "mixed" | "unknown"

export interface IntakeNormalizedRequest {
  sourceLanguage: IntakeNormalizedRequestLanguage
  originalMessage: string
  normalizedEnglish: string
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, " ")
}

function detectSourceLanguage(text: string): IntakeNormalizedRequestLanguage {
  const hangulCount = (text.match(/[가-힣]/gu) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length

  if (hangulCount > 0 && latinCount > 0) return "mixed"
  if (hangulCount > 0) return "ko"
  if (latinCount > 0) return "en"
  return "unknown"
}

// Preserve the latest user message for intake without language-bound semantic rewriting.
export function normalizeRequestForIntake(message: string): IntakeNormalizedRequest {
  const originalMessage = normalizeWhitespace(message)
  const sourceLanguage = detectSourceLanguage(originalMessage)

  return {
    sourceLanguage,
    originalMessage,
    normalizedEnglish: originalMessage,
  }
}
