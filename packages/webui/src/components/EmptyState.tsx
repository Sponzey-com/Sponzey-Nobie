export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <div className="mb-2 text-base font-semibold text-gray-800">{title}</div>
      <p className="mx-auto max-w-xl text-sm leading-6 text-gray-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
