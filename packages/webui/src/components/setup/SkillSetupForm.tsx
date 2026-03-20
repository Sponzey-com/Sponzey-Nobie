import type { SetupSkillDraftItem } from "../../contracts/setup"
import { useUiI18n } from "../../lib/ui-i18n"
import type { SkillItemErrors } from "../../lib/setupFlow"

function createDraftSkill(): SetupSkillDraftItem {
  return {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    description: "",
    source: "local",
    path: "",
    enabled: true,
    required: false,
    status: "disabled",
    reason: undefined,
  }
}

export function SkillSetupForm({
  value,
  onChange,
  onTest,
  testingSkillId,
  errors = {},
}: {
  value: { items: SetupSkillDraftItem[] }
  onChange: (value: { items: SetupSkillDraftItem[] }) => void
  onTest: (skillId: string) => void
  testingSkillId?: string | null
  errors?: Record<string, SkillItemErrors>
}) {
  const { text, displayText } = useUiI18n()

  function updateItem(skillId: string, patch: Partial<SetupSkillDraftItem>) {
    onChange({
      items: value.items.map((item) => (item.id === skillId ? { ...item, ...patch } : item)),
    })
  }

  function addSkill() {
    onChange({ items: [...value.items, createDraftSkill()] })
  }

  function removeSkill(skillId: string) {
    onChange({ items: value.items.filter((item) => item.id !== skillId) })
  }

  return (
    <div className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-stone-900">{text("작업 능력 확장 (Skill)", "Skill Extensions")}</div>
          <div className="mt-1 text-sm leading-6 text-stone-600">
            {text("Nobie가 참고할 작업 지침이나 확장 능력을 등록하는 단계입니다. 지금은 로컬 Skill과 기본 Skill 표시를 지원합니다.", "This step registers helper instructions and extra abilities Nobie can use. Right now it supports local skills and built-in skill markers.")}
          </div>
        </div>
        <button
          type="button"
          onClick={addSkill}
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-700"
        >
          {text("새 Skill 추가", "Add Skill")}
        </button>
      </div>

      <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
        {text("Skill이 없으면 특정 작업을 더 쉽게 처리하도록 가르치는 기능이 부족할 수 있습니다.", "Without skills, Nobie may have fewer specialized instructions for handling certain tasks easily.")}
      </div>

      {value.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-500">
          {text("아직 추가된 Skill이 없습니다. 필요하면 추가하고 경로나 상태를 확인해 주세요.", "No skills have been added yet. Add one if needed, then check the path or status.")}
        </div>
      ) : null}

      <div className="space-y-4">
        {value.items.map((item) => {
          const itemErrors = errors[item.id]
          const isTesting = testingSkillId === item.id
          const statusTone = item.status === "ready"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : item.status === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-stone-200 bg-stone-100 text-stone-700"

          return (
            <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-stone-900">{item.label.trim() || text("새 Skill", "New Skill")}</div>
                  <div className="mt-1 text-xs text-stone-500">{text("작업 능력 확장 (Skill)", "Skill Extension")}</div>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}>
                  {item.status === "ready" ? text("확인됨", "Ready") : item.status === "error" ? text("오류", "Error") : text("준비 전", "Not Ready")}
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">{text("Skill 이름 *", "Skill Name *")}</label>
                  <input
                    className="input"
                    value={item.label}
                    onChange={(event) => updateItem(item.id, { label: event.target.value, status: "disabled", reason: undefined })}
                    placeholder={text("예: 파일 정리 도우미", "Example: File Organizer Helper")}
                  />
                  {itemErrors?.label ? <p className="mt-2 text-xs leading-5 text-red-600">{itemErrors.label}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">{text("출처 (Source)", "Source")}</label>
                  <select
                    className="input"
                    value={item.source}
                    onChange={(event) => updateItem(item.id, {
                      source: event.target.value as SetupSkillDraftItem["source"],
                      status: event.target.value === "builtin" ? "ready" : "disabled",
                      reason: event.target.value === "builtin" ? text("기본 Skill로 표시됩니다.", "Shown as a built-in skill.") : undefined,
                    })}
                  >
                    <option value="local">{text("로컬 Skill", "Local Skill")}</option>
                    <option value="builtin">{text("기본 Skill", "Built-in Skill")}</option>
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-stone-700">{text("설명 (Description)", "Description")}</label>
                <textarea
                  className="input min-h-[88px] text-sm"
                  value={item.description}
                  onChange={(event) => updateItem(item.id, { description: event.target.value })}
                  placeholder={text("이 Skill이 어떤 일을 더 쉽게 해주는지 적어주세요", "Describe what this skill helps with")}
                />
              </div>

              {item.source === "local" ? (
                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-stone-700">{text("로컬 Skill 경로 (Local Path) *", "Local Skill Path *")}</label>
                  <input
                    className="input font-mono"
                    value={item.path}
                    onChange={(event) => updateItem(item.id, { path: event.target.value, status: "disabled", reason: undefined })}
                    placeholder={text("예: /Users/you/.codex/skills/my-skill", "Example: /Users/you/.codex/skills/my-skill")}
                  />
                  {itemErrors?.path ? <p className="mt-2 text-xs leading-5 text-red-600">{itemErrors.path}</p> : null}
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-stone-100 px-3 py-3 text-sm leading-6 text-stone-700">
                  {text("기본 Skill은 경로 입력 없이 바로 사용할 수 있는 안내용 항목입니다.", "Built-in skills are guidance items that can be used without entering a path.")}
                </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => updateItem(item.id, { enabled: event.target.checked })}
                  />
                  {text("이 Skill 사용", "Use this skill")}
                </label>
                <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(event) => updateItem(item.id, { required: event.target.checked })}
                  />
                  {text("필수 Skill로 표시", "Mark as required")}
                </label>
              </div>

              {item.reason ? (
                <div className={`mt-4 rounded-xl px-3 py-3 text-sm leading-6 ${item.status === "error" ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-700"}`}>
                  {displayText(item.reason)}
                </div>
              ) : null}
              {itemErrors?.status ? <p className="mt-2 text-xs leading-5 text-red-600">{itemErrors.status}</p> : null}

              <div className="mt-4 flex flex-wrap gap-3">
                {item.source === "local" ? (
                  <button
                    type="button"
                    onClick={() => onTest(item.id)}
                    disabled={isTesting}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isTesting ? text("경로 확인 중...", "Checking path...") : text("경로 확인", "Check Path")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeSkill(item.id)}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
                >
                  {text("삭제", "Delete")}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
