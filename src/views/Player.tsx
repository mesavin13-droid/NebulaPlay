import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
  ratingLabel,
  type PlaySource,
  type Title,
  type VideoSource,
} from "../data"
import { EpisodePager } from "../EpisodePager"
import { episodePageFor, getEpisodePagination } from "../episodePagination"
import { getHistoryRecord, historyEpisode, recordHistory } from "../history"
import { PageLoading } from "../PageLoading"
import {
  loadPlaybackPreferences,
  savePlaybackPreferences,
  type PlaybackPreferences,
} from "../playbackPreferences"
import type { Catalog } from "../useCatalog"
import { IconChevron, IconPlay, IconStar, PosterCard } from "../ui"

// video.js + VHS 占首屏包的大头,但只有真正进播放页才用得上。拆成独立 chunk,
// 并在播放页一挂载就开始拉,与详情/播放地址的网络请求并行,不让它串在后面。
const loadVideoPlayer = () => import("../VideoPlayer")
const VideoPlayer = lazy(() =>
  loadVideoPlayer().then((module) => ({ default: module.VideoPlayer })),
)

type ResolvedPlayback = {
  episodeKey: string
  episode: number
  sources: PlaySource[]
  seamless: boolean
}

export function Player({
  id,
  ep,
  source,
  catalog,
  onOpen,
  onPlay,
  onBack,
}: {
  id: string
  ep: number
  source: VideoSource
  catalog?: Catalog
  onOpen: (id: string) => void
  onPlay: (id: string, ep: number) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<"选集" | "简介" | "评论">("选集")
  const [playback, setPlayback] = useState<ResolvedPlayback | null>(null)
  const [pendingEpisodeKey, setPendingEpisodeKey] = useState<string | null>(
    null,
  )
  const [playError, setPlayError] = useState<string | null>(null)
  const [playAttempt, setPlayAttempt] = useState(0)
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [relOffset, setRelOffset] = useState(0)
  const [episodePage, setEpisodePage] = useState(() => episodePageFor(ep))
  // 在线片源(TVBox 等)列表数据不含集数,播放页同样拉一次完整详情。
  const [fresh, setFresh] = useState<Title | null>(null)
  const [preferences, setPreferences] = useState(loadPlaybackPreferences)
  const prefetchedSources = useRef(new Map<string, PlaySource[]>())
  const lastSaved = useRef(0)

  const t = fresh ?? catalog?.byId(id)
  const episodeKey = `${source.id}:${id}:${ep}`
  const activeEpisode = playback?.episode ?? ep
  const history = getHistoryRecord(source.id, id)
  const resumePoint =
    history && historyEpisode(history) === activeEpisode
      ? { positionSeconds: history.positionSeconds, progress: history.progress }
      : undefined

  // 不等 playback 解析完再触发 lazy 加载,否则 chunk 请求会排在详情请求后面。
  useEffect(() => {
    void loadVideoPlayer()
  }, [])

  useEffect(() => {
    lastSaved.current = 0
    setEpisodePage(episodePageFor(ep))
  }, [source.id, id, ep])

  useEffect(() => {
    prefetchedSources.current.clear()
  }, [source.id, id])

  useEffect(() => {
    let alive = true
    setFresh(null)
    setDetailLoading(true)
    setDetailError(null)
    source
      .loadDetail(id)
      .then((detail) => alive && setFresh(detail ?? null))
      .catch(
        (error) =>
          alive &&
          setDetailError(
            error instanceof Error ? error.message : "Не удалось загрузить информацию о фильме",
          ),
      )
      .finally(() => alive && setDetailLoading(false))
    return () => {
      alive = false
    }
  }, [source, id])

  // 通过当前片源解析真实可播放地址(合法 / CC 授权),含多清晰度。
  useEffect(() => {
    let alive = true
    setPlayError(null)
    setPendingEpisodeKey(episodeKey)
    const cached = prefetchedSources.current.get(episodeKey)
    const request = cached
      ? Promise.resolve(cached)
      : source.loadPlaySources(id, ep)
    request
      .then((list) => {
        if (!alive) return
        if (!list.length) throw new Error("Нет доступных источников для воспроизведения")
        prefetchedSources.current.set(episodeKey, list)
        setPlayback((current) => ({
          episodeKey,
          episode: ep,
          sources: list,
          seamless: current !== null,
        }))
        setPendingEpisodeKey(null)
      })
      .catch((error) => {
        if (!alive) return
        setPendingEpisodeKey(null)
        setPlayError(
          error instanceof Error ? error.message : "Не удалось загрузить видеопоток",
        )
      })
    return () => {
      alive = false
    }
  }, [source, id, ep, episodeKey, playAttempt])

  // 仅预取下一集,为自动连播和手动切集准备线路,不会扫完整部剧。
  useEffect(() => {
    if (
      detailLoading ||
      !t ||
      ep >= t.airedEpisodes ||
      (!preferences.autoNext && !preferences.skipOutro)
    )
      return
    const nextEpisode = ep + 1
    const nextKey = `${source.id}:${id}:${nextEpisode}`
    if (prefetchedSources.current.has(nextKey)) return
    let alive = true
    source
      .loadPlaySources(id, nextEpisode)
      .then((list) => {
        if (alive && list.length) prefetchedSources.current.set(nextKey, list)
      })
      .catch(() => {
        // 预取失败不影响当前播放;实际切集时仍会按正常路径Повторить。
      })
    return () => {
      alive = false
    }
  }, [
    source,
    id,
    ep,
    detailLoading,
    t,
    preferences.autoNext,
    preferences.skipOutro,
  ])

  if (detailLoading || (!playback && playError === null)) {
    return (
      <PageLoading
        label={`Подготавливаем серию ${ep}`}
        detail="Плеер откроется, когда загрузятся сведения и видеопоток"
      />
    )
  }
  if (!t) {
    return (
      <p className="mx-auto max-w-[1440px] px-8 py-24 text-center text-[#9aa0b0]">
        {detailError ?? "Фильм не найден."}
      </p>
    )
  }

  const total = t.episodes
  const isSeries = total > 1
  const activeNextEpisode =
    playback && playback.episode < t.airedEpisodes
      ? playback.episode + 1
      : null
  const switchingEpisode =
    playback !== null &&
    playback.episodeKey !== episodeKey &&
    pendingEpisodeKey === episodeKey &&
    playError === null
  const episodePagination = getEpisodePagination(total, episodePage)
  const pool = (catalog?.titles ?? []).filter((x) => x.id !== t.id)
  // 「换一批」:在同一批候选里轮换 8 部,避免洗牌造成的跳动。
  const related = Array.from(
    { length: Math.min(8, pool.length) },
    (_, i) => pool[(relOffset + i) % pool.length],
  )
  const updatePreferences = (patch: Partial<PlaybackPreferences>) => {
    setPreferences((current) =>
      savePlaybackPreferences({ ...current, ...patch }),
    )
  }
  const playNext = () => {
    if (activeNextEpisode) onPlay(t.id, activeNextEpisode)
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 lg:px-8">
      <div className="grid gap-4 pt-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {playError ? (
            <div className="grid aspect-video place-items-center rounded-xl bg-black px-6 text-center ring-1 ring-[#e0142c]/25">
              <div>
                <p className="font-medium text-white">Не удалось загрузить видеопоток</p>
                <p className="mt-2 text-sm text-[#9aa0b0]">{playError}</p>
                <button
                  onClick={() => {
                    prefetchedSources.current.delete(episodeKey)
                    setPlayError(null)
                    setPendingEpisodeKey(episodeKey)
                    setPlayAttempt((value) => value + 1)
                  }}
                  className="mt-4 rounded-lg bg-[#e0142c] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
                >
                  Повторить
                </button>
              </div>
            </div>
          ) : playback ? (
            <div className="relative">
              <Suspense
                fallback={
                  <div className="grid aspect-video place-items-center rounded-xl bg-black">
                    <PageLoading label="Загружаем плеер" compact />
                  </div>
                }
              >
                <VideoPlayer
                  key={`${id}-${playback.episodeKey}`}
                  sources={playback.sources}
                  poster={t.backdrop}
                  title={
                    isSeries ? `${t.name} 第 ${playback.episode} 集` : t.name
                  }
                  resumePoint={resumePoint}
                  autoPlay={playback.seamless}
                  showWaitingIndicator={!playback.seamless}
                  hasNextEpisode={activeNextEpisode !== null}
                  preferences={preferences}
                  skipIntroSeconds={
                    preferences.skipIntro ? preferences.introSeconds : 0
                  }
                  skipOutroSeconds={
                    preferences.skipOutro && activeNextEpisode
                      ? preferences.outroSeconds
                      : 0
                  }
                  onEnded={
                    preferences.autoNext && activeNextEpisode
                      ? playNext
                      : undefined
                  }
                  onSkipOutro={
                    preferences.skipOutro && activeNextEpisode
                      ? playNext
                      : undefined
                  }
                  onNextEpisode={activeNextEpisode ? playNext : undefined}
                  onPreferencesChange={updatePreferences}
                  onTime={(cur, dur, force) => {
                    if (
                      !Number.isFinite(cur) ||
                      !Number.isFinite(dur) ||
                      dur <= 0 ||
                      cur < 1
                    )
                      return
                    const now = Date.now()
                    if (!force && now - lastSaved.current < 4000) return
                    lastSaved.current = now
                    recordHistory({
                      sourceId: source.id,
                      titleId: t.id,
                      name: t.name,
                      ep: isSeries ? `第 ${playback.episode} 集` : t.latest,
                      episode: playback.episode,
                      progress: Math.min(100, Math.round((cur / dur) * 100)),
                      positionSeconds: Math.min(cur, dur),
                      durationSeconds: dur,
                      img: t.backdrop,
                    })
                  }}
                />
              </Suspense>
              {switchingEpisode && (
                <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/75 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                  Переключение на серию {ep}…
                </span>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={onBack}
              className="text-sm text-[#9aa0b0] transition hover:text-white"
            >
              ← Назад
            </button>
            <h1 className="font-serif text-2xl font-bold text-white">
              {t.name}
              {t.sub && <span className="text-[#e8b23a]">：{t.sub}</span>}
            </h1>
            <span className="rounded bg-[#14161f] px-2 py-1 text-sm text-[#c9ccd6]">
              {isSeries ? `第 ${ep} 集 · ${t.latest}` : t.latest}
            </span>
            <span className="flex items-center gap-1 text-sm font-bold text-[#e8b23a]">
              <IconStar className="h-3.5 w-3.5" /> {ratingLabel(t)}
            </span>
            <button
              onClick={() => onOpen(t.id)}
              className="ml-auto text-sm text-[#9aa0b0] transition hover:text-[#ff3b52]"
            >
              Подробнее →
            </button>
          </div>

          <div className="mt-4 flex gap-6 border-b border-white/6 text-sm">
            {(["选集", "简介", "评论"] as const)
              .filter((x) => x !== "选集" || isSeries)
              .map((x) => (
                <button
                  key={ruLabel(x)}
                  onClick={() => setTab(x)}
                  className={`relative pb-3 ${
                    tab === x ? "font-bold text-white" : "text-[#9aa0b0]"
                  }`}
                >
                  {ruLabel(x)}
                  {tab === x && (
                    <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-[#e0142c]" />
                  )}
                </button>
              ))}
          </div>

          <div className="mt-4">
            {tab === "选集" && isSeries && (
              <div>
                <EpisodePager
                  total={total}
                  page={episodePagination.page}
                  onPageChange={setEpisodePage}
                  className="mb-3"
                />
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-10">
                  {episodePagination.episodes.map((e) => {
                    const aired = e <= t.airedEpisodes
                    return (
                      <button
                        key={e}
                        disabled={!aired}
                        onClick={() => onPlay(t.id, e)}
                        className={`rounded-md py-2 text-sm font-medium transition ${
                          e === ep
                            ? "bg-[#e0142c] text-white"
                            : aired
                              ? "bg-[#14161f] text-[#c9ccd6] hover:bg-white/10"
                              : "cursor-not-allowed bg-[#0e1018] text-[#3a3f52]"
                        }`}
                      >
                        {e}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {(tab === "简介" || (tab === "选集" && !isSeries)) && (
              <div>
                <p className="text-sm leading-relaxed text-[#c9ccd6]">
                  {t.synopsis}
                </p>
                <p className="mt-3 text-xs text-[#5a5f70]">
                  В ролях: {t.cast.join(" / ")} · {t.region} · {t.year}
                </p>
              </div>
            )}
            {tab === "评论" && <Comments />}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {isSeries && (
            <div className="rounded-xl border border-white/6 bg-[#0e1018]">
              <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
                <h3 className="font-serif text-base font-bold text-white">
                  Список серий
                </h3>
                <span className="text-xs text-[#5a5f70]">
                  Доступно серий: {t.airedEpisodes} из {total}
                </span>
              </div>
              <EpisodePager
                total={total}
                page={episodePagination.page}
                onPageChange={setEpisodePage}
                className="px-2 pt-2"
              />
              <ol className="no-scrollbar max-h-[360px] space-y-1 overflow-y-auto p-2">
                {episodePagination.episodes.map((e) => {
                  const aired = e <= t.airedEpisodes
                  return (
                    <li key={e}>
                      <button
                        disabled={!aired}
                        onClick={() => onPlay(t.id, e)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                          e === ep
                            ? "bg-[#e0142c]/15 text-[#ff3b52] ring-1 ring-[#e0142c]/30"
                            : aired
                              ? "text-[#c9ccd6] hover:bg-white/5"
                              : "cursor-not-allowed text-[#3a3f52]"
                        }`}
                      >
                        <span className="tabular-nums">
                          {String(e).padStart(2, "0")}
                        </span>
                        <span className="flex-1 truncate">
                          Серия {e} {e === ep ? "· Сейчас воспроизводится" : ""}
                        </span>
                        {e === ep && <IconPlay className="h-3.5 w-3.5" />}
                        {!aired && <span className="text-[10px]">Скоро</span>}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif text-base font-bold text-white">
                Вам также понравится
              </h3>
              <button
                onClick={() =>
                  setRelOffset((o) => (o + 8) % Math.max(1, pool.length))
                }
                className="flex items-center gap-1 text-xs text-[#9aa0b0] transition hover:text-[#ff3b52]"
              >
                Другие варианты <IconChevron className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {related.map((r) => (
                <PosterCard key={r.id} t={r} onOpen={onOpen} />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Comments() {
  const list = [
    { u: "Зритель", t: "Неожиданный поворот и отличный темп сюжета!", l: 328 },
    { u: "Киноман", t: "Сильная актёрская игра и очень эмоциональная сцена.", l: 194 },
    { u: "Любитель кино", t: "Отличное качество изображения.", l: 156 },
  ]
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e0142c] to-[#7a0a18] text-sm font-bold text-white">
          Я
        </div>
        <input
          placeholder="Оставьте доброжелательный комментарий…"
          className="flex-1 rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
        <button className="rounded-lg bg-[#e0142c] px-4 text-sm font-medium text-white">
          Отправить
        </button>
      </div>
      {list.map((c) => (
        <div key={c.u} className="flex gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#14161f] text-sm text-[#9aa0b0]">
            {c.u[0]}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{c.u}</p>
            <p className="mt-0.5 text-sm text-[#c9ccd6]">{c.t}</p>
            <p className="mt-1 text-xs text-[#5a5f70]">❤️ {c.l} · Ответить</p>
          </div>
        </div>
      ))}
    </div>
  )
}
