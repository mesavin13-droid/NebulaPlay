import { LoaderCircle } from "lucide-react"

export function PageLoading({
  label,
  detail,
  compact = false,
}: {
  label: string
  detail?: string
  compact?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center ${
        compact ? "min-h-[360px] py-16" : "min-h-[56vh] py-24"
      }`}
    >
      <span className="relative grid h-14 w-14 place-items-center rounded-full border border-white/8 bg-[#0e1018]">
        <span className="absolute inset-2 animate-pulse rounded-full bg-[#e0142c]/10" />
        <LoaderCircle
          className="relative h-7 w-7 animate-spin text-[#ff3b52]"
          aria-hidden="true"
        />
      </span>
      <p className="mt-5 font-serif text-lg font-bold text-white">{label}</p>
      {detail && <p className="mt-2 text-sm text-[#9aa0b0]">{detail}</p>}
    </div>
  )
}
