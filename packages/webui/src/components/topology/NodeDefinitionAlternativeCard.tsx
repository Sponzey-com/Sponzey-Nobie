import * as React from "react"
import type {
  NodeDefinitionAlternative,
  NodeDefinitionDraft,
  NodeDefinitionField,
  NodeDefinitionFieldLocks,
} from "../../lib/node-definition-suggestion"

export const NODE_DEFINITION_FIELD_LABELS: Record<NodeDefinitionField, string> = {
  name: "이름",
  description: "성격과 하는 일",
  expectedOutput: "예상 결과",
  successCriteria: "성공 기준",
  capabilityHints: "필요한 능력",
  toolHints: "필요한 도구",
  understandingSummary: "노비가 이해한 내용",
}

export interface NodeDefinitionAlternativeCardProps {
  alternative: NodeDefinitionAlternative
  currentDraft: NodeDefinitionDraft
  fieldLocks: NodeDefinitionFieldLocks
  onSelect: (alternative: NodeDefinitionAlternative) => void
}

export function NodeDefinitionAlternativeCard({
  alternative,
  currentDraft,
  fieldLocks,
  onSelect,
}: NodeDefinitionAlternativeCardProps) {
  const changedFields = Object.keys(alternative.patch).filter((field): field is NodeDefinitionField => {
    return Object.prototype.hasOwnProperty.call(NODE_DEFINITION_FIELD_LABELS, field)
  })
  const roleName = formatPreviewValue(alternative.patch.name)

  return (
    <article
      className="grid w-full min-w-0 content-start gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm"
      data-testid="node-definition-alternative-card"
      data-alternative-id={alternative.alternativeId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-stone-950">{alternative.title}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-stone-600">{alternative.summary}</p>
          {roleName ? (
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800" data-testid="node-definition-role-name-badge">
              <span className="text-sky-600">역할명</span>
              <span className="truncate">{roleName}</span>
            </div>
          ) : null}
        </div>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
          {Math.round(alternative.confidence * 100)}%
        </span>
      </div>

      <div className="grid gap-2">
        {changedFields.length > 0 ? changedFields.map((field) => (
          <FieldPreview
            key={field}
            field={field}
            before={currentDraft[field]}
            after={alternative.patch[field]}
            locked={fieldLocks[field]}
          />
        )) : (
          <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-500">
            바뀌는 항목이 없습니다.
          </div>
        )}
      </div>

      {alternative.recommendedConnectionMeaning || alternative.riskNotes.length > 0 ? (
        <div className="grid gap-1 rounded-md bg-stone-50 px-2.5 py-2 text-[11px] leading-5 text-stone-600">
          {alternative.recommendedConnectionMeaning ? (
            <div>
              <span className="font-semibold text-stone-700">추천 연결 방식 </span>
              {alternative.recommendedConnectionMeaning}
            </div>
          ) : null}
          {alternative.riskNotes.length > 0 ? (
            <div>
              <span className="font-semibold text-stone-700">주의할 점 </span>
              {alternative.riskNotes.join(" / ")}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onSelect(alternative)}
        className="h-9 rounded-md bg-stone-950 px-3 text-xs font-semibold text-white hover:bg-stone-800"
        data-testid="node-definition-alternative-select"
      >
        이 대안 적용
      </button>
    </article>
  )
}

function FieldPreview({
  field,
  before,
  after,
  locked,
}: {
  field: NodeDefinitionField
  before: unknown
  after: unknown
  locked: boolean
}) {
  return (
    <div className="rounded-md border border-stone-100 bg-stone-50 px-2.5 py-2" data-testid="node-definition-field-preview" data-field={field}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-stone-500">
        <span>{NODE_DEFINITION_FIELD_LABELS[field]}</span>
        {locked ? <span className="rounded-full bg-white px-2 py-0.5 text-stone-600">유지됨</span> : null}
      </div>
      <div className="mt-1 grid gap-1 text-xs leading-5 text-stone-700">
        <div className="whitespace-pre-wrap break-words">
          <span className="text-stone-400">현재 </span>
          {formatPreviewValue(before) || "비어 있음"}
        </div>
        {!locked ? (
          <div className="whitespace-pre-wrap break-words font-semibold text-stone-900">
            <span className="font-normal text-stone-400">제안 </span>
            {formatPreviewValue(after) || "비어 있음"}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatPreviewValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(", ")
  return typeof value === "string" ? value.trim() : ""
}
