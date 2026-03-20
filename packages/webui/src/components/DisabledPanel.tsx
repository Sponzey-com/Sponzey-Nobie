export function DisabledPanel({
  title,
  reason,
}: {
  title: string
  reason: string
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="mb-2 text-sm font-semibold text-amber-900">{title}</div>
      <p className="text-sm leading-6 text-amber-800">{reason}</p>
    </div>
  )
}
