export function ErrorState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <div className="mb-2 text-sm font-semibold text-red-900">{title}</div>
      <p className="text-sm leading-6 text-red-700">{description}</p>
    </div>
  )
}
