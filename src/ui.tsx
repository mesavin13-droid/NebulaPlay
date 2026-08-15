import { useState, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  Crown,
  Film,
  Heart,
  Play,
  Plus,
  Search,
  Share2,
  Star,
} from 'lucide-react'
import { ratingLabel, type Title } from './data'

// ---- Image with graceful fallback -----------------------------------------
export function Img({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden bg-[#14161f] ${className ?? ''}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[#3a3f52]">
          <IconFilm className="h-8 w-8" />
        </div>
      )}
    </div>
  )
}

// ---- Icons (lucide-react) --------------------------------------------------
// 统一改用 lucide-react;保留原有组件名与 className API,调用处无需改动。
// 需要"实心"观感的图标(播放/评分/暂停)透传 fill="currentColor"。
type I = { className?: string }
export const IconSearch = ({ className }: I) => <Search className={className} />
export const IconPlay = ({ className }: I) => <Play className={className} fill="currentColor" stroke="none" />
export const IconPlus = ({ className }: I) => <Plus className={className} />
export const IconCheck = ({ className }: I) => <Check className={className} />
export const IconFilm = ({ className }: I) => <Film className={className} />
export const IconStar = ({ className }: I) => <Star className={className} fill="currentColor" stroke="none" />
export const IconHeart = ({ className }: I) => <Heart className={className} />
export const IconShare = ({ className }: I) => <Share2 className={className} />
export const IconChevron = ({ className }: I) => <ChevronRight className={className} />
export const IconCrown = ({ className }: I) => <Crown className={className} fill="currentColor" stroke="none" />

// ---- Brand mark ------------------------------------------------------------
export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap outline-none"
    >
      <span className="relative grid h-8 w-8 place-items-center">
        <svg viewBox="0 0 32 32" className="h-8 w-8">
          <circle cx="16" cy="16" r="14" fill="none" stroke="#e0142c" strokeWidth="2" opacity="0.6" />
          <circle cx="16" cy="16" r="5.5" fill="#e0142c" />
          <circle cx="24.5" cy="8.5" r="2" fill="#e8b23a" />
        </svg>
      </span>
      <span className="font-display text-xl font-bold tracking-wide text-white">
        Nebula<span className="text-[#e0142c]">Play</span>
      </span>
      <span className="ml-0.5 font-serif text-lg font-bold text-white/90">星幕</span>
    </button>
  )
}

// ---- Section header --------------------------------------------------------
export function SectionHeader({
  title,
  accent,
  more,
  onMore,
}: {
  title: string
  accent?: string
  more?: boolean
  onMore?: () => void
}) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <h2 className="flex items-center gap-3 font-serif text-xl font-bold text-white">
        <span className="h-5 w-1 rounded-full bg-[#e0142c]" />
        {title}
        {accent && <span className="text-sm font-normal text-[#9aa0b0]">{accent}</span>}
      </h2>
      {more && (
        <button
          onClick={onMore}
          className="flex items-center gap-1 text-sm text-[#9aa0b0] transition hover:text-[#ff3b52]"
        >
          查看全部 <IconChevron className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

// ---- Quality / rating badges ----------------------------------------------
export function QualityBadge({ q }: { q: Title['quality'] }) {
  const color =
    q === '4K' ? 'bg-[#e0142c] text-white' : q === '蓝光' ? 'bg-[#e8b23a] text-black' : 'bg-white/15 text-white'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${color}`}>{q}</span>
}

// ---- Poster card -----------------------------------------------------------
export function PosterCard({
  t,
  onOpen,
  index,
}: {
  t: Title
  onOpen: (id: string) => void
  index?: number
}) {
  return (
    <button
      onClick={() => onOpen(t.id)}
      className="group relative block w-full text-left outline-none"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md ring-1 ring-white/5">
        <Img src={t.poster} alt={t.name} className="h-full w-full transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/30 opacity-90" />

        <div className="absolute left-2 top-2 flex gap-1">
          <QualityBadge q={t.quality} />
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-bold text-[#e8b23a] backdrop-blur">
          <IconStar className="h-3 w-3" /> {ratingLabel(t)}
        </div>

        {typeof index === 'number' && (
          <span className="absolute -bottom-1 left-1 font-display text-4xl font-bold italic text-white/85 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
            {index}
          </span>
        )}

        {/* hover play */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e0142c]/90 shadow-lg shadow-[#e0142c]/40 backdrop-blur">
            <IconPlay className="h-5 w-5 translate-x-[1px] text-white" />
          </span>
        </div>

        <div className="absolute inset-x-2 bottom-2">
          <p className="truncate text-sm font-medium text-white">{t.name}</p>
          {t.latest && <p className="truncate text-[11px] text-[#ff3b52]">{t.latest}</p>}
        </div>
      </div>
    </button>
  )
}

// ---- Landscape / continue-watching card ------------------------------------
export function LandscapeCard({ t, onOpen }: { t: Title; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(t.id)} className="group block w-full text-left outline-none">
      <div className="relative aspect-video overflow-hidden rounded-md ring-1 ring-white/5">
        <Img src={t.backdrop} alt={t.name} className="h-full w-full transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute left-2 top-2">
          <QualityBadge q={t.quality} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e0142c]/90">
            <IconPlay className="h-5 w-5 translate-x-[1px] text-white" />
          </span>
        </div>
        <div className="absolute inset-x-2 bottom-2">
          <p className="truncate text-sm font-medium text-white">{t.name}</p>
          <p className="text-[11px] text-[#9aa0b0]">
            {t.genres.join(' · ')} · {t.year}
          </p>
        </div>
      </div>
    </button>
  )
}

export function Pill({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 text-sm transition ${
        active
          ? 'bg-[#e0142c] font-medium text-white'
          : 'text-[#9aa0b0] hover:bg-white/5 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
