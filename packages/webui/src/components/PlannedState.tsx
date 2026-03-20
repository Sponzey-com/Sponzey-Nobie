export function PlannedState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
      <p className="text-sm leading-6 text-slate-700">{description}</p>
    </div>
  )
}
