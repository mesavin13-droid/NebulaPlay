import { useCallback, useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
// 必须排在 video-js.css 之后:两边有同特异性的规则,靠顺序决胜。
import './videoPlayer.css'
import {
  Expand,
  Maximize,
  Pause,
  PictureInPicture2,
  Settings,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  isAnime4KSupported,
  startAnime4K,
  type Anime4KHandle,
} from './anime4kEnhancer'
import { type PlaySource } from './data'
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  type PlaybackPreferences,
} from './playbackPreferences'
import {
  resolvePlaybackStart,
  shouldSkipOutro,
  type PlaybackResumePoint,
} from './playbackProgress'
import { IconFilm, IconPlay } from './ui'
import {
  qualityLevelsOf,
  selectVideoJsQuality,
  videoElementOf,
  videoJsSource,
} from './videoJsAdapter'

type I = { className?: string }

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

// screen.orientation 的 lock / unlock 属于 limited-availability API,TS 的 DOM lib
// 未收录。运行时按可选链尽力调用,不支持的环境静默跳过。
type ScreenOrientationApi = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>
  unlock?: () => void
}
const screenOrientation = () =>
  (typeof screen === 'undefined' ? undefined : screen.orientation) as
    | ScreenOrientationApi
    | undefined

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
  title,
  resumePoint,
  autoPlay = false,
  showWaitingIndicator = true,
  skipIntroSeconds = 0,
  skipOutroSeconds = 0,
  hasNextEpisode = false,
  preferences = DEFAULT_PLAYBACK_PREFERENCES,
  onTime,
  onEnded,
  onSkipOutro,
  onNextEpisode,
  onPreferencesChange,
}: {
  sources: PlaySource[]
  poster: string
  title?: string
  resumePoint?: PlaybackResumePoint
  autoPlay?: boolean
  showWaitingIndicator?: boolean
  skipIntroSeconds?: number
  skipOutroSeconds?: number
  hasNextEpisode?: boolean
  preferences?: PlaybackPreferences
  onTime?: (current: number, duration: number, force?: boolean) => void
  onEnded?: () => void
  onSkipOutro?: () => void
  onNextEpisode?: () => void
  onPreferencesChange?: (patch: Partial<PlaybackPreferences>) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoHostRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)
  const enhanceCanvasRef = useRef<HTMLCanvasElement>(null)
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
  const [iosNativeFs, setIosNativeFs] = useState(false) // iOS 原生视频全屏
  const [qi, setQi] = useState(0)
  const [playerReady, setPlayerReady] = useState(false)
  // Anime4K 画质增强:idle → starting → on;失败回落 off 并提示。
  const [enhance, setEnhance] = useState<"off" | "starting" | "on">("off")
  const enhanceHandle = useRef<Anime4KHandle | null>(null)
  // HLS 多码率:MANIFEST_PARSED 后填充;LEVEL_SWITCHED 跟踪自动档实际切到的码率。
  const [levels, setLevels] = useState<{ i: number; label: string }[]>([])
  const [level, setLevel] = useState(-1) // -1 = 自动
  const [autoLevel, setAutoLevel] = useState(-1) // 自动模式下当前实际播放的码率档
  // 单码率流 playlist 不带 RESOLUTION:起播后从 video 元素读真实分辨率做标签。
  const [videoH, setVideoH] = useState(0)
  const [danmaku, setDanmaku] = useState<Danmaku[]>([])
  const [dmOn, setDmOn] = useState(true)
  const [dmText, setDmText] = useState('')
  const [dmFocus, setDmFocus] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dmId = useRef(0)
  // 切换清晰度时用于保留播放进度 / 播放状态。
  const resume = useRef<{ t: number; play: boolean } | null>(null)
  const initialResumeApplied = useRef(false)
  const autoPlayApplied = useRef(false)
  const outroHandled = useRef(false)
  const onTimeRef = useRef(onTime)
  const onEndedRef = useRef(onEnded)
  const onSkipOutroRef = useRef(onSkipOutro)

  useEffect(() => {
    onTimeRef.current = onTime
    onEndedRef.current = onEnded
    onSkipOutroRef.current = onSkipOutro
  }, [onTime, onEnded, onSkipOutro])

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
    autoPlayApplied.current = false
    outroHandled.current = false
  }, [src])

  // Anime4K 增强:开启且源就绪时启动;换源重建,卸载/关闭时销毁 GPU 资源。
  useEffect(() => {
    if (enhance === "off") return
    const video = videoRef.current
    const canvas = enhanceCanvasRef.current
    if (!video || !canvas) return
    let alive = true
    startAnime4K(video, canvas)
      .then((handle) => {
        if (!alive) {
          handle.stop()
          return
        }
        enhanceHandle.current = handle
        handle.onFatal = (error) => {
          setEnhance("off")
          const reason = error instanceof Error ? error.message : ""
          showOsd(
            reason.includes("GPU 无法流畅")
              ? "Производительности устройства недостаточно. Улучшение изображения отключено."
              : "Улучшение изображения отключено: источник не поддерживает обработку WebGPU.",
          )
        }
        setEnhance("on")
        showOsd("Улучшение изображения включено")
      })
      .catch(() => {
        if (!alive) return
        setEnhance("off")
        showOsd("Этот браузер не поддерживает улучшение изображения WebGPU")
      })
    return () => {
      alive = false
      enhanceHandle.current?.stop()
      enhanceHandle.current = null
    }
    // 换源(切清晰度/换集)时按新流重建管线;关闭时走 cleanup 销毁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhance !== "off", playerReady, src])

  const toggleEnhance = () => {
    if (enhance === "off") {
      if (!isAnime4KSupported()) {
        showOsd("Этот браузер не поддерживает улучшение изображения WebGPU")
        return
      }
      setEnhance("starting")
    } else {
      enhanceHandle.current?.stop()
      enhanceHandle.current = null
      setEnhance("off")
      showOsd("Улучшение изображения отключено")
    }
  }

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

      const start = resolvePlaybackStart(resumePoint, mediaDuration, skipIntroSeconds)
      initialResumeApplied.current = true
      if (!start.seconds) return
      try {
        video.currentTime = start.seconds
        setCurrent(start.seconds)
        showOsd(
          start.reason === 'intro'
            ? `Пропущено вступление: ${fmt(start.seconds)}`
            : `Продолжение с ${fmt(start.seconds)}`,
        )
      } catch {
        initialResumeApplied.current = false
      }
    },
    [resumePoint, showOsd, skipIntroSeconds],
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
      showOsd(delta > 0 ? `Перемотка вперёд +${delta} с` : `Перемотка назад ${delta} с`)
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
          showOsd(v.paused ? 'Воспроизведение' : 'Пауза')
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
          showOsd(`Громкость ${Math.round(next * 100)}%`)
          break
        }
        case 'm':
          setMuted((m) => {
            showOsd(m ? 'Включить звук' : 'Отключить звук')
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
          showOsd(`Скорость ${next}x`)
          break
        }
        default:
          if (/^[0-9]$/.test(e.key) && isFinite(v.duration)) {
            v.currentTime = (Number(e.key) / 10) * v.duration
            showOsd(`Переход к ${e.key}0%`)
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
  }, [playerReady])

  const toggleFs = async () => {
    const el = wrapRef.current
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
      webkitExitFullscreen?: () => void
    }) | null
    if (!el || !video) return
    if (iosNativeFs) {
      video.webkitExitFullscreen?.()
      return
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    if (webFull) {
      setWebFull(false)
      return
    }
    // iOS Safari 不支持容器全屏,退回 video 原生全屏(系统播放器接管)。
    if (!el.requestFullscreen && video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen()
      return
    }
    // 优先尝试原生全屏;在 iframe(预览环境)里常被策略禁用 → 退回网页全屏。
    try {
      await el.requestFullscreen()
      // 触屏设备全屏后顺手锁横屏;桌面/未授权时静默忽略。
      if (window.matchMedia?.("(pointer: coarse)").matches) {
        await screenOrientation()?.lock?.("landscape").catch(() => {})
      }
    } catch {
      setWebFull(true)
    }
  }

  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement
      setFs(on)
      if (!on) {
        try {
          screenOrientation()?.unlock?.()
        } catch {
          /* 未锁定时调用抛错,忽略 */
        }
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // iOS 原生全屏走自己的事件,不触发 fullscreenchange。
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const begin = () => setIosNativeFs(true)
    const end = () => setIosNativeFs(false)
    video.addEventListener("webkitbeginfullscreen", begin)
    video.addEventListener("webkitendfullscreen", end)
    return () => {
      video.removeEventListener("webkitbeginfullscreen", begin)
      video.removeEventListener("webkitendfullscreen", end)
    }
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
    const player = playerRef.current
    if (!player || player.isDisposed()) return
    player.volume(volume)
    player.muted(muted)
    player.playbackRate(rate)
  }, [playerReady, volume, muted, rate])

  // 触屏设备:单击视频切换控制栏(桌面仍是单击播放/暂停)。
  const isCoarse = useRef(
    typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ?? false),
  )
  const onVideoTap = () => {
    if (!isCoarse.current) {
      toggle()
      return
    }
    if (showUI && playing) setShowUI(false)
    else nudgeUI()
  }

  // 桌面悬停进度条时的时间预览(拖动时仍用 scrub)。
  const [hoverT, setHoverT] = useState<number | null>(null)
  const onBarHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !duration) return
    setHoverT(barTime(e.clientX))
  }

  // 画中画:特性检测一次即可。
  const [pipSupported] = useState(
    () =>
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      document.pictureInPictureEnabled,
  )
  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      showOsd("Режим «картинка в картинке» недоступен")
    }
  }

  // Video.js 只初始化一次。元素在 effect 内创建,避免 React StrictMode
  // 重复挂载时与 Video.js 的 DOM 托管发生冲突。
  useEffect(() => {
    const host = videoHostRef.current
    if (!host || playerRef.current) return
    const videoElement = document.createElement('video-js')
    videoElement.classList.add('nebula-videojs')
    videoElement.setAttribute('playsinline', '')
    host.appendChild(videoElement)

    const player = videojs(videoElement, {
      controls: false,
      autoplay: false,
      preload: 'auto',
      fill: true,
      playsinline: true,
      nativeControlsForTouch: false,
      html5: {
        vhs: {
          overrideNative: !videojs.browser.IS_SAFARI,
          useBandwidthFromLocalStorage: true,
          limitRenditionByPlayerDimensions: true,
          useDevicePixelRatio: true,
          usePlayerObjectFit: true,
        },
      },
      userActions: {
        click: false,
        doubleClick: false,
        hotkeys: false,
      },
    })
    playerRef.current = player
    videoRef.current = videoElementOf(player)
    setPlayerReady(true)
    player.ready(() => {
      if (player.isDisposed()) return
      videoRef.current = videoElementOf(player)
    })

    return () => {
      setPlayerReady(false)
      videoRef.current = null
      if (!player.isDisposed()) player.dispose()
      playerRef.current = null
    }
  }, [])

  // 换集/换清晰度只更换 Video.js source;VHS 自行重置 ABR 与缓冲。
  useEffect(() => {
    const player = playerRef.current
    if (!playerReady || !player || player.isDisposed() || !src) return
    setLevels([])
    setLevel(-1)
    setAutoLevel(-1)
    // Video.js 运行时支持 error(null) 清掉上一条错误,类型签名没覆盖这个用法。
    ;(player.error as unknown as (value: null) => void)(null)
    player.src(videoJsSource(src))
    videoRef.current = videoElementOf(player)
  }, [playerReady, src])

  useEffect(() => {
    const player = playerRef.current
    if (!playerReady || !player || player.isDisposed()) return
    player.poster(poster)
  }, [playerReady, poster])

  // Video.js 管理源与 VHS;NebulaPlay 业务状态监听其底层 media element。
  useEffect(() => {
    const player = playerRef.current
    if (!playerReady || !player || player.isDisposed()) return

    let boundQualityList: ReturnType<typeof qualityLevelsOf> = null
    const syncVideoElement = () => {
      const video = videoElementOf(player)
      if (video) videoRef.current = video
      return video
    }
    const syncQualityLevels = () => {
      const qualityList = qualityLevelsOf(player)
      if (!qualityList) {
        setLevels([])
        setAutoLevel(-1)
        return
      }
      setLevels(
        Array.from({ length: qualityList.length }, (_, i) => ({
          i,
          label: qualityLabel(qualityList[i].height, qualityList[i].bitrate),
        })),
      )
      setAutoLevel(qualityList.selectedIndex)
    }
    const bindQualityEvents = () => {
      const qualityList = qualityLevelsOf(player)
      if (boundQualityList !== qualityList) {
        boundQualityList?.off('addqualitylevel', syncQualityLevels)
        boundQualityList?.off('removequalitylevel', syncQualityLevels)
        boundQualityList?.off('change', syncQualityLevels)
        boundQualityList = qualityList
        boundQualityList?.on('addqualitylevel', syncQualityLevels)
        boundQualityList?.on('removequalitylevel', syncQualityLevels)
        boundQualityList?.on('change', syncQualityLevels)
      }
      syncQualityLevels()
    }
    const onPlayEvent = () => {
      setPlaying(true)
      nudgeUI()
    }
    const onPauseEvent = () => {
      setPlaying(false)
      setShowUI(true)
      const video = syncVideoElement()
      if (video && Number.isFinite(video.duration)) {
        onTimeRef.current?.(video.currentTime, video.duration, true)
      }
    }
    const onEndedEvent = () => {
      const video = syncVideoElement()
      if (!video) return
      if (preferences.loop) {
        video.currentTime = 0
        void player.play()?.catch(() => {})
        return
      }
      setPlaying(false)
      onTimeRef.current?.(video.currentTime, video.duration, true)
      onEndedRef.current?.()
    }
    const onTimeUpdateEvent = () => {
      const video = syncVideoElement()
      if (!video) return
      setCurrent(video.currentTime)
      onTimeRef.current?.(video.currentTime, video.duration)
      if (
        !outroHandled.current &&
        onSkipOutroRef.current &&
        shouldSkipOutro(video.currentTime, video.duration, skipOutroSeconds)
      ) {
        outroHandled.current = true
        onSkipOutroRef.current()
      }
    }
    const onMetadataEvent = () => {
      const video = syncVideoElement()
      if (!video) return
      setVideoH(video.videoHeight)
      applyResume(video)
      bindQualityEvents()
    }
    const onCanPlayEvent = () => {
      const video = syncVideoElement()
      if (!video) return
      applyResume(video)
      setWaiting(false)
      if (autoPlay && !autoPlayApplied.current) {
        autoPlayApplied.current = true
        void player.play()?.catch(() => {})
      }
    }
    const onProgressEvent = () => {
      // 与其余处理器保持一致:每次都重新取 media element,不依赖闭包里的初始引用。
      const video = syncVideoElement()
      if (!video) return
      const ranges = video.buffered
      if (ranges.length) setBuffered(ranges.end(ranges.length - 1))
    }
    const onWaitingEvent = () => setWaiting(true)
    const onPlayingEvent = () => setWaiting(false)
    const onErrorEvent = () => {
      setFailed(true)
      setWaiting(false)
    }
    const onLoadStartEvent = () => {
      syncVideoElement()
      setWaiting(true)
      setFailed(false)
      bindQualityEvents()
    }

    const video = syncVideoElement()
    if (!video) return
    video.addEventListener('play', onPlayEvent)
    video.addEventListener('pause', onPauseEvent)
    video.addEventListener('ended', onEndedEvent)
    video.addEventListener('timeupdate', onTimeUpdateEvent)
    video.addEventListener('loadedmetadata', onMetadataEvent)
    video.addEventListener('durationchange', onMetadataEvent)
    video.addEventListener('canplay', onCanPlayEvent)
    video.addEventListener('waiting', onWaitingEvent)
    video.addEventListener('playing', onPlayingEvent)
    video.addEventListener('progress', onProgressEvent)
    video.addEventListener('error', onErrorEvent)
    video.addEventListener('loadstart', onLoadStartEvent)
    bindQualityEvents()

    return () => {
      video.removeEventListener('play', onPlayEvent)
      video.removeEventListener('pause', onPauseEvent)
      video.removeEventListener('ended', onEndedEvent)
      video.removeEventListener('timeupdate', onTimeUpdateEvent)
      video.removeEventListener('loadedmetadata', onMetadataEvent)
      video.removeEventListener('durationchange', onMetadataEvent)
      video.removeEventListener('canplay', onCanPlayEvent)
      video.removeEventListener('waiting', onWaitingEvent)
      video.removeEventListener('playing', onPlayingEvent)
      video.removeEventListener('progress', onProgressEvent)
      video.removeEventListener('error', onErrorEvent)
      video.removeEventListener('loadstart', onLoadStartEvent)
      boundQualityList?.off('addqualitylevel', syncQualityLevels)
      boundQualityList?.off('removequalitylevel', syncQualityLevels)
      boundQualityList?.off('change', syncQualityLevels)
    }
  }, [applyResume, autoPlay, nudgeUI, playerReady, preferences.loop, skipOutroSeconds])

  const shown = scrub ?? current
  const pct = duration ? (shown / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  // 展示用码率档:playlist 没给高度时,用起播后读到的真实分辨率兜底。
  const displayLevels = levels.map((l) => ({
    i: l.i,
    label: l.label || qualityLabel(videoH) || 'По умолчанию',
  }))
  const autoDisplay = autoLevel >= 0 ? (displayLevels.find((l) => l.i === autoLevel)?.label ?? '') : ''

  return (
    <div
      ref={wrapRef}
      className={`group overflow-hidden bg-black ${
        webFull
          ? 'fixed inset-0 z-[9999] h-[100dvh] w-[100dvw]'
          : 'relative aspect-video rounded-xl ring-1 ring-white/8'
      }`}
      onMouseMove={nudgeUI}
      onMouseLeave={() => playing && setShowUI(false)}
    >
      <div
        ref={videoHostRef}
        data-vjs-player
        data-source-url={src}
        onClick={onVideoTap}
        className={`nebula-videojs-host absolute inset-0 ${
          enhance === 'on' ? 'nebula-videojs-enhanced' : ''
        }`}
      />

      {/* Anime4K 增强画面层 */}
      {enhance !== "off" && (
        <canvas
          ref={enhanceCanvasRef}
          onClick={onVideoTap}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
            enhance === "on" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {enhance === "starting" && (
        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/75 px-3 py-1.5 text-xs font-medium text-[#e8b23a] backdrop-blur">
          Запускаем улучшение изображения…
        </span>
      )}

      {/* 顶部标题栏(腾讯视频风格):控制栏可见时一起出现 */}
      {title && (
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-3 transition-opacity ${
            showUI || !playing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <p className="truncate text-sm font-medium text-white/95">{title}</p>
        </div>
      )}

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
            Не удалось загрузить видео. Попробуйте ещё раз или выберите другое качество.
          </div>
        </div>
      ) : waiting && showWaitingIndicator ? (
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
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2.5 pt-10 transition-opacity sm:px-4 sm:pb-3 ${
          showUI || !playing || dmFocus ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* 跳过片头/片尾浮钮(腾讯视频风格,悬停在进度条上方) */}
        {skipIntroSeconds > 0 && shown > 0.5 && shown < skipIntroSeconds && (
          <button
            onClick={() => {
              const v = videoRef.current
              if (v) v.currentTime = skipIntroSeconds
              showOsd(`Пропущено вступление: ${fmt(skipIntroSeconds)}`)
            }}
            className="absolute bottom-[72px] right-4 rounded-md border border-white/25 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/85"
          >
            跳过片头
          </button>
        )}
        {skipOutroSeconds > 0 &&
          hasNextEpisode &&
          duration > 0 &&
          shown > Math.max(0, duration - skipOutroSeconds - 30) &&
          shown < duration - skipOutroSeconds && (
            <button
              onClick={() => onSkipOutro?.()}
              className="absolute bottom-[72px] right-4 rounded-md border border-white/25 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/85"
            >
              跳过片尾
            </button>
          )}

        {/* 进度条:单层轨道内叠 buffered / played / thumb,三者同坐标系,位置精确 */}
        <div className="mb-1 select-none text-xs tabular-nums text-[#c9ccd6]">
          {fmt(current)} / {fmt(duration)}
        </div>
        <div
          ref={barRef}
          onPointerDown={onBarDown}
          onPointerMove={onBarHover}
          onPointerLeave={() => setHoverT(null)}
          className="group/bar relative mb-2 h-4 cursor-pointer touch-none"
        >
          {(scrub !== null || hoverT !== null) && (
            <span
              className="absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-2 py-0.5 text-xs tabular-nums text-white"
              style={{
                left: `${duration ? (((scrub ?? hoverT) ?? 0) / duration) * 100 : 0}%`,
              }}
            >
              {fmt((scrub ?? hoverT) ?? 0)}
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

        <div className="flex items-center gap-3 text-white sm:gap-4">
          <button onClick={toggle} aria-label={playing ? 'Пауза' : 'Воспроизведение'}>
            {playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
          </button>

          {hasNextEpisode && (
            <button onClick={() => onNextEpisode?.()} aria-label="Следующая серия" title="Следующая серия">
              <SkipForward className="h-5 w-5" />
            </button>
          )}

          {/* 弹幕输入(bilibili 风格) */}
          <div className="ml-2 hidden min-w-0 flex-1 items-center gap-2 md:flex">
            <button
              onClick={() => setDmOn((v) => !v)}
              className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition ${
                dmOn ? 'bg-[#e0142c] text-white' : 'bg-white/10 text-[#9aa0b0] hover:text-white'
              }`}
              title={dmOn ? 'Выключить комментарии' : 'Включить комментарии'}
            >
              Комментарии {dmOn ? "вкл." : "выкл."}
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
              placeholder="Оставьте комментарий поверх видео…"
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

          <div className="ml-auto flex shrink-0 items-center gap-2.5 sm:gap-3">
            <SpeedMenu rate={rate} onChange={setRate} />
            <QualityMenu list={list} active={safeQi} onChange={changeQuality} />
            {levels.length > 0 && (
              <LevelsMenu
                list={displayLevels}
                active={level}
                autoLabel={autoDisplay}
                onChange={(i) => {
                  setLevel(i)
                  const player = playerRef.current
                  if (player && !player.isDisposed()) selectVideoJsQuality(player, i)
                }}
              />
            )}
            <button
              onClick={toggleEnhance}
              aria-label="Улучшение изображения"
              title={enhance === "on" ? "Отключить улучшение изображения (Anime4K)" : "Включить улучшение изображения (Anime4K)"}
              className={`transition ${
                enhance === "on"
                  ? "text-[#e8b23a]"
                  : "text-[#c9ccd6] hover:text-white"
              }`}
            >
              <Sparkles className="h-5 w-5" />
            </button>
            {/* 音量:桌面 hover 展开滑条;移动端交给系统按键 */}
            <div className="group/vol hidden items-center gap-2 sm:flex">
              <button onClick={() => setMuted((m) => !m)} aria-label="Отключить звук">
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
                className="h-1 w-0 cursor-pointer opacity-0 accent-[#e0142c] transition-all duration-200 group-hover/vol:w-16 group-hover/vol:opacity-100"
                aria-label="Громкость"
              />
            </div>
            <PlayerSettingsMenu
              value={preferences}
              onChange={(patch) => onPreferencesChange?.(patch)}
            />
            {pipSupported && (
              <button onClick={togglePip} aria-label="Картинка в картинке" title="Картинка в картинке" className="hidden sm:block">
                <PictureInPicture2 className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => setWebFull((v) => !v)}
              aria-label="Полноэкранный режим страницы"
              title="Полноэкранный режим страницы"
              className="hidden sm:block"
            >
              <Expand className={`h-5 w-5 ${webFull ? 'text-[#e0142c]' : ''}`} />
            </button>
            <button onClick={toggleFs} aria-label="Полный экран">
              <IconExpand className={`h-5 w-5 ${fs || iosNativeFs ? 'text-[#e0142c]' : ''}`} />
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
    return <span className="text-xs text-[#c9ccd6]">{list[0]?.label ?? 'Стандартное'}</span>
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-[#c9ccd6] hover:text-white"
      >
        {list[active]?.label ?? 'Качество'}
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
      ? `Авто${autoLabel ? ` · ${autoLabel}` : ''}`
      : (list.find((l) => l.i === active)?.label ?? 'Авто')
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
          {[{ i: -1, label: 'Авто' }, ...[...list].reverse()].map((l) => (
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

// 连播设置菜单(腾讯视频风格):自动下一集 / 循环播放 / 跳过片头片尾。
function PlayerSettingsMenu({
  value,
  onChange,
}: {
  value: PlaybackPreferences
  onChange: (patch: Partial<PlaybackPreferences>) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Настройки воспроизведения"
        title="Настройки воспроизведения"
        className="text-[#c9ccd6] transition hover:text-white"
      >
        <Settings className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-white/10 bg-[#0e1018] py-1 shadow-xl">
          <MenuSwitch
            label="Автоматически включать следующую серию"
            checked={value.autoNext}
            onChange={(autoNext) => onChange({ autoNext })}
          />
          <MenuSwitch
            label="Повторять воспроизведение"
            checked={value.loop}
            onChange={(loop) => onChange({ loop })}
          />
          <MenuSwitch
            label="Пропускать вступление"
            checked={value.skipIntro}
            onChange={(skipIntro) => onChange({ skipIntro })}
          />
          {value.skipIntro && (
            <MenuSeconds
              label="Длительность вступления"
              value={value.introSeconds}
              onChange={(introSeconds) => onChange({ introSeconds })}
            />
          )}
          <MenuSwitch
            label="Пропускать концовку"
            checked={value.skipOutro}
            onChange={(skipOutro) => onChange({ skipOutro })}
          />
          {value.skipOutro && (
            <MenuSeconds
              label="Длительность концовки"
              value={value.outroSeconds}
              onChange={(outroSeconds) => onChange({ outroSeconds })}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MenuSwitch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-[#c9ccd6] transition hover:bg-white/5 hover:text-white"
    >
      {label}
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          checked ? "bg-[#e0142c]" : "bg-white/15"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition ${
            checked ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  )
}

function MenuSeconds({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between px-4 py-1.5 text-xs text-[#5a5f70]">
      {label}
      <span className="inline-flex items-center gap-1.5">
        <input
          aria-label={label}
          type="number"
          min={0}
          max={600}
          step={5}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-6 w-14 rounded-md border border-white/10 bg-[#14161f] px-2 text-center text-xs tabular-nums text-white outline-none focus:border-[#e0142c]/60"
        />
        秒
      </span>
    </label>
  )
}
