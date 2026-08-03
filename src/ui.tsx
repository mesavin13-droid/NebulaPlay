import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Hls from 'hls.js'
import {
  Check,
  ChevronRight,
  Crown,
  Film,
  Heart,
  Maximize,
  Pause,
  Play,
  Plus,
  Search,
  Share2,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { ratingLabel, type PlaySource, type Title } from './data'
import { resolveResumeSeconds, type PlaybackResumePoint } from './playbackProgress'

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
    <button onClick={onClick} className="flex items-center gap-2 outline-none">
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

// ---- 真实视频播放器 --------------------------------------------------------
const IconPause = ({ className }: I) => <Pause className={className} fill="currentColor" stroke="none" />
const IconVolume = ({ muted, className }: I & { muted?: boolean }) =>
  muted ? <VolumeX className={className} /> : <Volume2 className={className} />
const IconExpand = ({ className }: I) => <Maximize className={className} />

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '00:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const h = Math.floor(m / 60)
  const mm = String(h > 0 ? m % 60 : m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2]

// 分辨率 → 清晰度标签:2160+ 记 4K,1440+ 记 2K,其余按 P 数;高度缺失时按码率兜底。
const qualityLabel = (height?: number, bitrate?: number): string => {
  if (height) {
    if (height >= 2000) return '4K'
    if (height >= 1400) return '2K'
    return `${height}P`
  }
  if (bitrate && bitrate >= 200000) return `${Math.round(bitrate / 100000) / 10}M`
  return ''
}

type Danmaku = { id: number; text: string; top: number; dur: number }

export function VideoPlayer({
  sources,
  poster,
  resumePoint,
  onTime,
}: {
  sources: PlaySource[]
  poster: string
  resumePoint?: PlaybackResumePoint
  onTime?: (current: number, duration: number, force?: boolean) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  // 拖拽进度条时的预览时间;为 null 表示未在拖拽。
  const [scrub, setScrub] = useState<number | null>(null)
  const [osd, setOsd] = useState<string | null>(null)
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [waiting, setWaiting] = useState(true)
  const [failed, setFailed] = useState(false)
  const [showUI, setShowUI] = useState(true)
  const [fs, setFs] = useState(false)
  const [webFull, setWebFull] = useState(false) // 网页全屏(iframe 内原生全屏常被禁用时的兜底)
  const [qi, setQi] = useState(0)
  // HLS 多码率:MANIFEST_PARSED 后填充;LEVEL_SWITCHED 跟踪自动档实际切到的码率。
  const [levels, setLevels] = useState<{ i: number; label: string }[]>([])
  const [level, setLevel] = useState(-1) // -1 = 自动
  const [autoLevel, setAutoLevel] = useState(-1) // 自动模式下当前实际播放的码率档
  // 单码率流 playlist 不带 RESOLUTION:起播后从 video 元素读真实分辨率做标签。
  const [videoH, setVideoH] = useState(0)
  const hlsRef = useRef<Hls | null>(null)
  const [danmaku, setDanmaku] = useState<Danmaku[]>([])
  const [dmOn, setDmOn] = useState(true)
  const [dmText, setDmText] = useState('')
  const [dmFocus, setDmFocus] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dmId = useRef(0)
  // 切换清晰度时用于保留播放进度 / 播放状态。
  const resume = useRef<{ t: number; play: boolean } | null>(null)
  const initialResumeApplied = useRef(false)
  const onTimeRef = useRef(onTime)

  useEffect(() => {
    onTimeRef.current = onTime
  }, [onTime])

  const sendDanmaku = () => {
    const text = dmText.trim()
    if (!text) return
    const id = ++dmId.current
    const top = 6 + (id % 8) * 10 // 8 条轨道,避开底部控制栏
    const dur = 8 + Math.random() * 4
    setDanmaku((d) => [...d, { id, text, top, dur }])
    setDmText('')
    setDmOn(true)
  }
  const removeDanmaku = (id: number) => setDanmaku((d) => d.filter((x) => x.id !== id))

  const list = sources?.length ? sources : [{ label: '标清', url: '' }]
  const safeQi = Math.min(qi, list.length - 1)
  const src = list[safeQi]?.url ?? ''
  // m3u8 (HLS) 播放:Chrome 等经 hls.js 走 MSE;Safari 原生支持,直接吃 src。
  // TVBox 的 m3u8 已被包成 /__tvbox?u=… 同源代理地址,其中仍含 ".m3u8" 字样。
  const isHls = /\.m3u8/i.test(src)
  const useMse = isHls && Hls.isSupported()

  useEffect(() => {
    if (!useMse) return
    const v = videoRef.current
    if (!v) return
    const hls = new Hls({ maxMaxBufferLength: 60, fragLoadingMaxRetry: 4, manifestLoadingMaxRetry: 2 })
    hlsRef.current = hls
    hls.loadSource(src)
    hls.attachMedia(v)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setLevels(
        hls.levels.map((l, i) => ({
          i,
          label: qualityLabel(l.height, l.bitrate),
        })),
      )
      setLevel(-1)
    })
    hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => setAutoLevel(data.level))
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return
      // 网络 / 媒体错误先自愈,只有解码级致命错误才展示失败态。
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
      else setFailed(true)
    })
    return () => {
      hls.destroy()
      hlsRef.current = null
      setLevels([])
      setAutoLevel(-1)
    }
  }, [src, useMse])

  // sources 变化(换片/换集)时回到最高清晰度并重置状态。
  useEffect(() => {
    setQi(0)
    resume.current = null
    initialResumeApplied.current = false
  }, [sources])

  // 换源(换片或切清晰度)时重置播放相关状态。
  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setFailed(false)
    setWaiting(true)
    setVideoH(0)
  }, [src])

  // 切换清晰度:记录当前进度,换 src 后在 loadedmetadata 时恢复。
  const changeQuality = (i: number) => {
    if (i === safeQi) return
    const v = videoRef.current
    resume.current = { t: v?.currentTime ?? 0, play: !!v && !v.paused }
    setQi(i)
  }

  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => setFailed(true))
    else v.pause()
  }, [])

  const showOsd = useCallback((text: string) => {
    setOsd(text)
    if (osdTimer.current) clearTimeout(osdTimer.current)
    osdTimer.current = setTimeout(() => setOsd(null), 800)
  }, [])

  const applyResume = useCallback(
    (video: HTMLVideoElement) => {
      const mediaDuration = video.duration
      if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return
      setDuration(mediaDuration)

      // 切换清晰度优先恢复本次播放位置，不重复套用历史续播。
      if (resume.current) {
        video.currentTime = Math.min(resume.current.t, mediaDuration)
        if (resume.current.play) video.play().catch(() => {})
        resume.current = null
        return
      }
      if (initialResumeApplied.current) return

      const target = resolveResumeSeconds(resumePoint, mediaDuration)
      initialResumeApplied.current = true
      if (!target) return
      try {
        video.currentTime = target
        setCurrent(target)
        showOsd(`已续播至 ${fmt(target)}`)
      } catch {
        initialResumeApplied.current = false
      }
    },
    [resumePoint, showOsd],
  )

  // 页面隐藏、路由切换或刷新时强制保存最后位置。
  useEffect(() => {
    const flush = () => {
      const video = videoRef.current
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
      onTimeRef.current?.(video.currentTime, video.duration, true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [src])

  // 进度条:点击 / 拖拽都先本地预览,松手才真正 seek,避免拖动中反复拉流。
  const barTime = useCallback(
    (clientX: number) => {
      const el = barRef.current
      if (!el || !duration) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration],
  )

  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return
    e.preventDefault()
    setScrub(barTime(e.clientX))
    const move = (ev: PointerEvent) => setScrub(barTime(ev.clientX))
    const up = (ev: PointerEvent) => {
      const v = videoRef.current
      if (v) v.currentTime = barTime(ev.clientX)
      setScrub(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current
      if (!v || !isFinite(v.duration)) return
      v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration)
      showOsd(delta > 0 ? `快进 +${delta}s` : `快退 ${delta}s`)
    },
    [showOsd],
  )

  // 播放器快捷键:空格/K 播放暂停,←/→ ±5s,J/L ±10s,↑/↓ 音量,M 静音,F 全屏,
  // 0-9 跳转百分比,[ ] 调倍速。输入框聚焦(弹幕等)时不劫持按键。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          toggle()
          showOsd(v.paused ? '播放' : '暂停')
          break
        case 'ArrowLeft':
          e.preventDefault()
          seekBy(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seekBy(5)
          break
        case 'j':
          seekBy(-10)
          break
        case 'l':
          seekBy(10)
          break
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          const next = Math.min(1, Math.max(0, v.volume + (e.key === 'ArrowUp' ? 0.1 : -0.1)))
          setVolume(next)
          setMuted(next === 0)
          showOsd(`音量 ${Math.round(next * 100)}%`)
          break
        }
        case 'm':
          setMuted((m) => {
            showOsd(m ? '取消静音' : '静音')
            return !m
          })
          break
        case 'f':
          toggleFs()
          break
        case '[':
        case ']': {
          const i = SPEEDS.findIndex((s) => s === rate)
          const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (e.key === ']' ? 1 : -1)))]
          setRate(next)
          showOsd(`倍速 ${next}x`)
          break
        }
        default:
          if (/^[0-9]$/.test(e.key) && isFinite(v.duration)) {
            v.currentTime = (Number(e.key) / 10) * v.duration
            showOsd(`跳转 ${e.key}0%`)
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seekBy, showOsd, rate])

  const nudgeUI = useCallback(() => {
    setShowUI(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowUI(false), 2600)
  }, [])

  const toggleFs = async () => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    if (webFull) {
      setWebFull(false)
      return
    }
    // 优先尝试原生全屏;在 iframe(预览环境)里常被策略禁用 → 退回网页全屏。
    try {
      await el.requestFullscreen()
    } catch {
      setWebFull(true)
    }
  }

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // 网页全屏下按 Esc 退出。
  useEffect(() => {
    if (!webFull) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWebFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [webFull])

  useEffect(() => {
    const v = videoRef.current
    if (v) {
      v.volume = volume
      v.muted = muted
      v.playbackRate = rate
    }
  }, [volume, muted, rate])

  const shown = scrub ?? current
  const pct = duration ? (shown / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  // 展示用码率档:playlist 没给高度时,用起播后读到的真实分辨率兜底。
  const displayLevels = levels.map((l) => ({
    i: l.i,
    label: l.label || qualityLabel(videoH) || '默认',
  }))
  const autoDisplay = autoLevel >= 0 ? (displayLevels.find((l) => l.i === autoLevel)?.label ?? '') : ''

  return (
    <div
      ref={wrapRef}
      className={`group relative overflow-hidden bg-black ${
        webFull
          ? 'fixed inset-0 z-[9999] h-screen w-screen'
          : 'aspect-video rounded-xl ring-1 ring-white/8'
      }`}
      onMouseMove={nudgeUI}
      onMouseLeave={() => playing && setShowUI(false)}
    >
      <video
        ref={videoRef}
        src={useMse ? undefined : src}
        poster={poster}
        playsInline
        className="h-full w-full bg-black object-contain"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true)
          nudgeUI()
        }}
        onPause={() => {
          setPlaying(false)
          setShowUI(true)
          const video = videoRef.current
          if (video && Number.isFinite(video.duration))
            onTimeRef.current?.(video.currentTime, video.duration, true)
        }}
        onEnded={(e) => {
          setPlaying(false)
          onTimeRef.current?.(e.currentTarget.currentTime, e.currentTarget.duration, true)
        }}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime)
          onTimeRef.current?.(e.currentTarget.currentTime, e.currentTarget.duration)
        }}
        onLoadedMetadata={(e) => applyResume(e.currentTarget)}
        onDurationChange={(e) => applyResume(e.currentTarget)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={(e) => {
          applyResume(e.currentTarget)
          setWaiting(false)
        }}
        onResize={(e) => setVideoH(e.currentTarget.videoHeight)}
        onError={() => {
          setFailed(true)
          setWaiting(false)
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
      />

      {/* 弹幕层 */}
      {dmOn && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {danmaku.map((d) => (
            <span
              key={d.id}
              onAnimationEnd={() => removeDanmaku(d.id)}
              className="absolute whitespace-nowrap text-[15px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
              style={{
                top: `${d.top}%`,
                animation: `danmaku ${d.dur}s linear forwards`,
                animationPlayState: playing ? 'running' : 'paused',
              }}
            >
              {d.text}
            </span>
          ))}
        </div>
      )}

      {/* 加载 / 错误 / 大播放按钮 */}
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-sm text-[#9aa0b0]">
          <div>
            <IconFilm className="mx-auto mb-2 h-8 w-8" />
            视频加载失败,请稍后重试或切换清晰度。
          </div>
        </div>
      ) : waiting ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-11 w-11 animate-spin rounded-full border-2 border-white/20 border-t-[#e0142c]" />
        </div>
      ) : (
        !playing && (
          <button onClick={toggle} className="absolute inset-0 grid place-items-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-[#e0142c]/85 shadow-2xl shadow-[#e0142c]/40 backdrop-blur transition hover:scale-105">
              <IconPlay className="h-8 w-8 translate-x-1 text-white" />
            </span>
          </button>
        )
      )}

      {/* 快捷键操作提示(OSD) */}
      {osd && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rounded-lg bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            {osd}
          </span>
        </div>
      )}

      {/* 控制栏 */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 transition-opacity ${
          showUI || !playing || dmFocus ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* 进度条:单层轨道内叠 buffered / played / thumb,三者同坐标系,位置精确 */}
        <div
          ref={barRef}
          onPointerDown={onBarDown}
          className="group/bar relative mb-2 h-4 cursor-pointer touch-none"
        >
          {scrub !== null && (
            <span className="absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-2 py-0.5 text-xs tabular-nums text-white" style={{ left: `${pct}%` }}>
              {fmt(scrub)}
            </span>
          )}
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/20">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/25"
              style={{ width: `${bufPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#e0142c]"
              style={{ width: `${pct}%` }}
            />
            <span
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity ${
                scrub !== null ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'
              }`}
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 text-white">
          <button onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
            {playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2">
            <button onClick={() => setMuted((m) => !m)} aria-label="静音">
              <IconVolume muted={muted || volume === 0} className="h-5 w-5" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(Number(e.target.value) === 0)
              }}
              className="h-1 w-16 cursor-pointer accent-[#e0142c]"
              aria-label="音量"
            />
          </div>

          <span className="text-xs tabular-nums text-[#c9ccd6]">
            {fmt(current)} / {fmt(duration)}
          </span>

          {/* 弹幕输入(bilibili 风格) */}
          <div className="ml-2 hidden min-w-0 flex-1 items-center gap-2 sm:flex">
            <button
              onClick={() => setDmOn((v) => !v)}
              className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition ${
                dmOn ? 'bg-[#e0142c] text-white' : 'bg-white/10 text-[#9aa0b0] hover:text-white'
              }`}
              title={dmOn ? '关闭弹幕' : '开启弹幕'}
            >
              弹幕{dmOn ? '开' : '关'}
            </button>
            <input
              value={dmText}
              onChange={(e) => setDmText(e.target.value)}
              onFocus={() => setDmFocus(true)}
              onBlur={() => setDmFocus(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendDanmaku()
                e.stopPropagation()
              }}
              placeholder="发一条友善的弹幕…"
              maxLength={40}
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs text-white placeholder:text-[#8a8f9e] outline-none focus:border-[#e0142c]/60"
            />
            <button
              onClick={sendDanmaku}
              className="shrink-0 rounded-full bg-[#e0142c] px-3 py-1 text-xs font-bold text-white transition hover:bg-[#ff3b52]"
            >
              发送
            </button>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <QualityMenu list={list} active={safeQi} onChange={changeQuality} />
            {levels.length > 0 && (
              <LevelsMenu
                list={displayLevels}
                active={level}
                autoLabel={autoDisplay}
                onChange={(i) => {
                  setLevel(i)
                  if (hlsRef.current) hlsRef.current.currentLevel = i
                }}
              />
            )}
            <SpeedMenu rate={rate} onChange={setRate} />
            <button onClick={toggleFs} aria-label="全屏">
              <IconExpand className={`h-5 w-5 ${fs || webFull ? 'text-[#e0142c]' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QualityMenu({
  list,
  active,
  onChange,
}: {
  list: PlaySource[]
  active: number
  onChange: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  if (list.length <= 1) {
    return <span className="text-xs text-[#c9ccd6]">{list[0]?.label ?? '标清'}</span>
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-[#c9ccd6] hover:text-white"
      >
        {list[active]?.label ?? '清晰度'}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#0e1018] py-1 shadow-xl">
          {list.map((s, i) => (
            <button
              key={s.label + i}
              onClick={() => {
                onChange(i)
                setOpen(false)
              }}
              className={`block w-20 px-3 py-1.5 text-left text-xs ${
                i === active ? 'bg-[#e0142c]/15 text-[#ff3b52]' : 'text-[#c9ccd6] hover:bg-white/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// HLS 多码率清晰度菜单:仅在流本身带多档码率时出现,默认「自动」。
function LevelsMenu({
  list,
  active,
  autoLabel,
  onChange,
}: {
  list: { i: number; label: string }[]
  active: number // -1 = 自动
  autoLabel?: string // 自动模式下当前实际码率(展示为「自动 · 1080P」)
  onChange: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  const current =
    active < 0
      ? `自动${autoLabel ? ` · ${autoLabel}` : ''}`
      : (list.find((l) => l.i === active)?.label ?? '自动')
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="whitespace-nowrap text-xs font-medium text-[#c9ccd6] hover:text-white"
      >
        {current}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#0e1018] py-1 shadow-xl">
          {/* 高码率在上,符合选清晰度的直觉顺序 */}
          {[{ i: -1, label: '自动' }, ...[...list].reverse()].map((l) => (
            <button
              key={l.i}
              onClick={() => {
                onChange(l.i)
                setOpen(false)
              }}
              className={`block w-full whitespace-nowrap px-4 py-1.5 text-left text-xs transition ${
                l.i === active ? 'bg-[#e0142c]/15 text-[#ff3b52]' : 'text-[#c9ccd6] hover:bg-white/5'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SpeedMenu({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="text-xs tabular-nums text-[#c9ccd6] hover:text-white">
        {rate}x
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#0e1018] py-1 shadow-xl">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => {
                onChange(s)
                setOpen(false)
              }}
              className={`block w-16 px-3 py-1.5 text-left text-xs ${
                s === rate ? 'bg-[#e0142c]/15 text-[#ff3b52]' : 'text-[#c9ccd6] hover:bg-white/5'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      )}
    </div>
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
