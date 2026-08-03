import { useEffect, useState } from "react"
import {
  ratingLabel,
  type RatingPoint,
  type Title,
  type VideoSource,
} from "../data"
import { EpisodePager } from "../EpisodePager"
import { getEpisodePagination } from "../episodePagination"
import { PageLoading } from "../PageLoading"
import type { Catalog } from "../useCatalog"
import {
  IconHeart,
  IconPlay,
  IconPlus,
  IconShare,
  IconStar,
  Img,
  PosterCard,
  QualityBadge,
} from "../ui"

export function Detail({
  id,
  source,
  catalog,
  onOpen,
  onPlay,
}: {
  id: string
  source: VideoSource
  catalog?: Catalog
  onOpen: (id: string) => void
  onPlay: (id: string, ep: number) => void
}) {
  const [fav, setFav] = useState(false)
  const [trend, setTrend] = useState<RatingPoint[]>([])
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [episodePage, setEpisodePage] = useState(0)
  // 在线片源(TVBox 等)的列表数据不含播放集数,进入详情时拉一次完整详情补齐。
  const [fresh, setFresh] = useState<Title | null>(null)

  useEffect(() => {
    let alive = true
    setEpisodePage(0)
    setFresh(null)
    setTrend([])
    setDetailLoading(true)
    setDetailError(null)
    Promise.allSettled([source.loadDetail(id), source.loadRatingTrend(id)])
      .then(([detailResult, trendResult]) => {
        if (!alive) return
        if (detailResult.status === "fulfilled") {
          setFresh(detailResult.value ?? null)
        } else {
          setDetailError(
            detailResult.reason instanceof Error
              ? detailResult.reason.message
              : "详情加载失败",
          )
        }
        setTrend(trendResult.status === "fulfilled" ? trendResult.value : [])
      })
      .finally(() => alive && setDetailLoading(false))
    return () => {
      alive = false
    }
  }, [source, id])

  const t = fresh ?? catalog?.byId(id)
  if (detailLoading) {
    return (
      <PageLoading
        label="正在加载影片详情"
        detail="剧集、评分与演职信息准备完成后将一次展示"
      />
    )
  }
  if (!t) {
    return (
      <p className="mx-auto max-w-[1440px] px-8 py-24 text-center text-[#9aa0b0]">
        {detailError ?? "影片不存在。"}
      </p>
    )
  }

  const total = t.episodes
  const isSeries = total > 1
  const episodePagination = getEpisodePagination(total, episodePage)
  const related = (catalog?.titles ?? [])
    .filter((x) => x.id !== t.id)
    .slice(0, 6)

  return (
    <div>
      <div className="relative">
        <Img
          src={t.backdrop}
          alt={t.name}
          className="h-[380px] w-full lg:h-[460px]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080d] via-[#07080d]/70 to-[#07080d]/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07080d] via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto flex max-w-[1440px] items-end gap-6 px-4 pb-8 lg:px-8">
            <div className="hidden w-40 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 sm:block">
              <Img
                src={t.poster}
                alt={t.name}
                className="aspect-[2/3] w-full"
              />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-3xl font-black text-white lg:text-5xl">
                {t.name}
                {t.sub && <span className="text-[#e8b23a]">：{t.sub}</span>}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#c9ccd6]">
                <span className="flex items-center gap-1 text-lg font-bold text-[#e8b23a]">
                  <IconStar className="h-4 w-4" /> {ratingLabel(t)}
                </span>
                <QualityBadge q={t.quality} />
                <span>{t.year}</span>
                <span>·</span>
                <span>{t.region}</span>
                <span>·</span>
                <span>{t.genres.join(" / ")}</span>
                <span>·</span>
                <span className="text-[#ff3b52]">{t.latest}</span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => onPlay(t.id, 1)}
                  className="flex items-center gap-2 rounded-lg bg-[#e0142c] px-6 py-2.5 font-bold text-white shadow-lg shadow-[#e0142c]/30 transition hover:bg-[#ff3b52]"
                >
                  <IconPlay className="h-5 w-5" /> 立即播放
                </button>
                <button
                  onClick={() => setFav((f) => !f)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 font-medium backdrop-blur transition ${
                    fav
                      ? "border-[#e0142c]/50 bg-[#e0142c]/15 text-[#ff3b52]"
                      : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  <IconHeart className="h-5 w-5" /> {fav ? "已收藏" : "收藏"}
                </button>
                <button className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 font-medium text-white backdrop-blur transition hover:bg-white/10">
                  <IconPlus className="h-5 w-5" /> 片单
                </button>
                <button className="grid h-11 w-11 place-items-center rounded-lg border border-white/20 bg-white/5 text-white transition hover:bg-white/10">
                  <IconShare className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-8 lg:grid-cols-[1fr_320px] lg:px-8">
        <div className="min-w-0">
          {detailError && (
            <p className="mb-5 rounded-lg border border-[#e0142c]/30 bg-[#e0142c]/10 px-4 py-3 text-sm text-[#ff9aaa]">
              可用性查询失败：{detailError}
            </p>
          )}
          <Panel title="剧情简介">
            <p className="text-sm leading-relaxed text-[#c9ccd6]">
              {t.synopsis}
            </p>
          </Panel>

          <Panel title="演职人员">
            <div className="flex flex-wrap gap-3">
              {t.cast.length ? (
                t.cast.map((c) => (
                  <div
                    key={c}
                    className="rounded-lg border border-white/6 bg-[#0e1018] px-3 py-2 text-sm text-[#c9ccd6]"
                  >
                    {c}
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#5a5f70]">
                  后端暂未提供演职人员信息。
                </p>
              )}
            </div>
          </Panel>

          {isSeries ? (
            <Panel title="分集列表" accent={`共 ${total} 集`}>
              <EpisodePager
                total={total}
                page={episodePagination.page}
                onPageChange={setEpisodePage}
                className="mb-3"
              />
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-10">
                {episodePagination.episodes.map((ep) => {
                  const aired = ep <= t.airedEpisodes
                  return (
                    <button
                      key={ep}
                      disabled={!aired}
                      onClick={() => onPlay(t.id, ep)}
                      className={`rounded-md py-2 text-sm font-medium transition ${
                        aired
                          ? "bg-[#14161f] text-[#c9ccd6] hover:bg-[#e0142c] hover:text-white"
                          : "cursor-not-allowed bg-[#0e1018] text-[#3a3f52]"
                      }`}
                    >
                      {ep}
                    </button>
                  )
                })}
              </div>
            </Panel>
          ) : (
            <Panel title="观看">
              <button
                onClick={() => onPlay(t.id, 1)}
                className="flex items-center gap-2 rounded-lg bg-[#14161f] px-4 py-3 text-sm text-[#c9ccd6] transition hover:bg-[#e0142c] hover:text-white"
              >
                <IconPlay className="h-4 w-4" /> 播放正片 · {t.quality}
              </button>
            </Panel>
          )}

          <Panel title="相关推荐">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {related.map((r) => (
                <PosterCard key={r.id} t={r} onOpen={onOpen} />
              ))}
            </div>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          {t.ratingKnown === false ? (
            <UnknownScorePanel />
          ) : (
            <ScorePanel t={t} />
          )}
          {trend.length > 1 && <TrendPanel trend={trend} />}
        </aside>
      </div>
    </div>
  )
}

function UnknownScorePanel() {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0e1018] p-4 text-center">
      <IconStar className="mx-auto h-5 w-5 text-[#5a5f70]" />
      <p className="mt-2 text-sm font-medium text-[#c9ccd6]">暂无评分</p>
      <p className="mt-1 text-xs text-[#5a5f70]">
        后端 canonical work 未提供评分数据。
      </p>
    </div>
  )
}

function Panel({
  title,
  accent,
  children,
}: {
  title: string
  accent?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-3 font-serif text-lg font-bold text-white">
        <span className="h-4 w-1 rounded-full bg-[#e0142c]" />
        {title}
        {accent && (
          <span className="text-sm font-normal text-[#5a5f70]">{accent}</span>
        )}
      </h2>
      {children}
    </section>
  )
}

function ScorePanel({ t }: { t: Title }) {
  const dist = [72, 20, 5, 2, 1]
  return (
    <div className="rounded-xl border border-white/6 bg-[#0e1018] p-4">
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="font-display text-4xl font-bold text-[#e8b23a]">
            {t.rating.toFixed(1)}
          </p>
          <div className="mt-1 flex justify-center text-[#e8b23a]">
            {Array.from({ length: 5 }).map((_, i) => (
              <IconStar
                key={i}
                className={`h-3.5 w-3.5 ${
                  i < Math.round(t.rating / 2) ? "" : "opacity-25"
                }`}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-[#5a5f70]">12.4 万人评价</p>
        </div>
        <div className="flex-1 space-y-1">
          {dist.map((v, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-[#5a5f70]"
            >
              <span className="w-6">{5 - i}星</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[#e8b23a]"
                  style={{ width: `${v}%` }}
                />
              </div>
              <span className="w-8 text-right tabular-nums">{v}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TrendPanel({ trend }: { trend: RatingPoint[] }) {
  const w = 288
  const h = 120
  const pad = 8
  const vals = trend.map((p) => p.v)
  const min = Math.min(...vals) - 0.2
  const max = Math.max(...vals) + 0.1
  const span = max - min || 1
  const pts = trend.map((p, i) => {
    const x = pad + (i / Math.max(1, trend.length - 1)) * (w - pad * 2)
    const y = pad + (1 - (p.v - min) / span) * (h - pad * 2)
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ")
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`

  return (
    <div className="rounded-xl border border-white/6 bg-[#0e1018] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-bold text-white">口碑走势</h3>
        <span className="rounded bg-[#e0142c]/15 px-2 py-0.5 text-xs font-bold text-[#ff3b52]">
          ↑ 持续走高
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e0142c" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#e0142c" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#tg)" />
        <path
          d={line}
          fill="none"
          stroke="#e0142c"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill="#ff3b52" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[#5a5f70]">
        {trend.map((p, i) => (
          <span key={i}>
            {p.d.replace("第", "").replace("集", "").replace("幕", "幕")}
          </span>
        ))}
      </div>
    </div>
  )
}
