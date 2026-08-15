import { useEffect, useRef } from "react"
import { getEpisodeRanges } from "./episodePagination"

export function EpisodePager({
  total,
  page,
  onPageChange,
  className = "",
}: {
  total: number
  page: number
  onPageChange: (page: number) => void
  className?: string
}) {
  const ranges = getEpisodeRanges(total)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const revealActive = () => {
      const container = containerRef.current
      const active = activeRef.current
      if (!container || !active) return
      const left =
        active.offsetLeft - (container.clientWidth - active.clientWidth) / 2
      container.scrollTo({ left: Math.max(0, left), behavior: "smooth" })
    }
    revealActive()
    const container = containerRef.current
    const observer =
      typeof ResizeObserver === "undefined" || !container
        ? null
        : new ResizeObserver(revealActive)
    if (container) observer?.observe(container)
    window.addEventListener("resize", revealActive)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", revealActive)
    }
  }, [page, total])

  if (ranges.length <= 1) return null

  return (
    <div
      ref={containerRef}
      className={`no-scrollbar flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1 ${className}`}
      role="navigation"
      aria-label="选集分页"
    >
      {ranges.map((range) => (
        <button
          key={range.page}
          ref={range.page === page ? activeRef : undefined}
          type="button"
          aria-current={range.page === page ? "page" : undefined}
          onClick={() => onPageChange(range.page)}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium tabular-nums transition ${
            range.page === page
              ? "bg-[#e0142c] text-white"
              : "bg-[#14161f] text-[#9aa0b0] hover:bg-white/10 hover:text-white"
          }`}
        >
          {range.start}-{range.end}
        </button>
      ))}
    </div>
  )
}
