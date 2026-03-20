import { useState } from "react"

export function SetupExpandableSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-3xl border border-stone-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-stone-900">{title}</div>
          {description?.trim() ? <div className="mt-1 text-sm leading-6 text-stone-600">{description}</div> : null}
        </div>
        <span className="mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-stone-200 bg-stone-50 px-2 text-xs font-semibold text-stone-600">
          {open ? "-" : "+"}
        </span>
      </button>
      {open ? <div className="border-t border-stone-200 px-5 py-5">{children}</div> : null}
    </section>
  )
}
