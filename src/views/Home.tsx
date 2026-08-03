import { useEffect, useState } from 'react'
import { ratingLabel, type Title } from '../data'
import {
  clearHistory,
  historyEpisode,
  removeHistory,
  useHistory,
  type HistoryRecord,
} from '../history'
import { togglePlaylist, usePlaylist } from '../playlist'
import type { Catalog } from '../useCatalog'
import { IconCheck, IconPlay, IconPlus, IconStar, Img, PosterCard, SectionHeader } from '../ui'

export function Home({
  catalog,
  sourceId,
  onOpen,
  onPlay,
  onMore,
}: {
  catalog?: Catalog
  sourceId: string
  onOpen: (id: string) => void
  onPlay: (id: string, ep: number) => void
  onMore: (category: string) => void
}) {
  // Hooks run unconditionally so the guard below never changes hook order.
  const [slide, setSlide] = useState(0)
  const [rankTab, setRankTab] = useState<'热播' | '好评' | '新番'>('热播')
  const history = useHistory(sourceId)
  const continueHistory = history.filter((item) => item.progress > 0 && item.progress < 95)
  const playlist = usePlaylist(sourceId)

  const titles = catalog?.titles ?? []
  const hero = catalog?.hero
  const ranking = catalog?.ranking ?? []
  const heroSlides = hero ? [hero, ...titles.filter((t) => t.id !== hero.id)].slice(0, 4) : []
  const slideCount = Math.max(1, heroSlides.length)

  useEffect(() => {
    setSlide(0)
  }, [catalog])

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % slideCount), 6000)
    return () => clearInterval(t)
  }, [slideCount])

  if (!catalog || !hero)
    return (
      <div className="mx-auto max-w-[1440px] px-4 pb-16 lg:px-8">
        <section className="grid gap-4 pt-5 lg:grid-cols-[1fr_320px]" aria-label="首页内容加载中">
          <div className="aspect-[16/7] animate-pulse rounded-lg bg-[#10121a] ring-1 ring-white/6">
            <div className="flex h-full flex-col justify-end gap-3 p-6">
              <div className="h-7 w-2/5 rounded bg-white/8" />
              <div className="h-4 w-3/5 rounded bg-white/5" />
              <div className="h-10 w-28 rounded bg-[#e0142c]/25" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-72 animate-pulse rounded-lg bg-[#10121a] ring-1 ring-white/6" />
            <div className="h-28 animate-pulse rounded-lg bg-[#10121a] ring-1 ring-white/6" />
          </div>
        </section>
        <ContinueWatching history={continueHistory} onPlay={onPlay} />
        <section className="mt-10" aria-hidden="true">
          <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/8" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-[2/3] animate-pulse rounded-lg bg-[#10121a]" />
            ))}
          </div>
        </section>
      </div>
    )
  const current = heroSlides[slide] ?? hero

  // 热播榜三个 tab 各自取数:热播出片源榜单,好评按评分,新番按年份。
  const rankList = (() => {
    if (rankTab === '热播') return ranking
    const sorted = [...titles].sort((a, b) =>
      rankTab === '好评' ? b.rating - a.rating : b.year - a.year,
    )
    return sorted.slice(0, 8).map((t) => ({
      name: t.name,
      hot: rankTab === '好评' ? ratingLabel(t) : String(t.year),
      titleId: t.id,
    }))
  })()

  const rows = [
    { title: '今日热门电影', cat: '电影', items: titles.slice(1, 9), ranked: false },
    { title: '人气推荐', cat: '推荐', items: [...titles].slice(6).concat(titles.slice(0, 2)), ranked: false },
    { title: '高分榜单', cat: '推荐', items: [...titles].sort((a, b) => b.rating - a.rating).slice(0, 8), ranked: true },
  ]

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 lg:px-8">
      <section className="grid gap-4 pt-5 lg:grid-cols-[1fr_320px]">
        <HeroBanner
          hero={current}
          slide={slide}
          setSlide={setSlide}
          count={heroSlides.length}
          onOpen={onOpen}
          sourceId={sourceId}
          inList={playlist.some((p) => p.titleId === current.id)}
        />

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-white/6 bg-[#0e1018] p-4">
            <div className="mb-3 flex items-center gap-4 border-b border-white/6 pb-2">
              <h3 className="flex items-center gap-2 font-serif text-base font-bold text-white">
                <span className="text-[#e0142c]">🔥</span> 星幕热播榜
              </h3>
              <div className="ml-auto flex gap-2 text-xs">
                {(['热播', '好评', '新番'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRankTab(tab)}
                    className={rankTab === tab ? 'font-bold text-white' : 'text-[#5a5f70]'}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <ol className="space-y-2.5">
              {rankList.map((r, i) => (
                <li key={`${rankTab}-${r.name}`}>
                  <button
                    onClick={() => r.titleId && onOpen(r.titleId)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span
                      className={`w-5 text-center font-display text-lg font-bold italic ${
                        i < 3 ? 'text-[#e0142c]' : 'text-[#4a4f60]'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm text-[#c9ccd6] transition hover:text-white">
                      {r.name}
                    </span>
                    <span className="text-xs tabular-nums text-[#e8b23a]">{r.hot}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl border border-white/6 bg-gradient-to-br from-[#12141d] to-[#0e1018] p-4">
            <h3 className="mb-1 font-serif text-base font-bold text-white">完全免费 · 公益驱动</h3>
            <p className="text-xs leading-relaxed text-[#9aa0b0]">
              星幕由志愿者社区维护,无广告、无会员、无付费墙。所有内容仅接入原创、授权或公有领域片源,人人皆可自由观看。
            </p>
          </div>
        </aside>
      </section>

      <ContinueWatching history={continueHistory} onPlay={onPlay} />

      {rows.map((row) => (
        <Row
          key={row.title}
          title={row.title}
          items={row.items}
          onOpen={onOpen}
          ranked={row.ranked}
          onMore={() => onMore(row.cat)}
        />
      ))}
    </div>
  )
}

function ContinueWatching({
  history,
  onPlay,
}: {
  history: HistoryRecord[]
  onPlay: (id: string, ep: number) => void
}) {
  if (!history.length) return null
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="flex items-center gap-3 font-serif text-xl font-bold text-white">
          <span className="h-5 w-1 rounded-full bg-[#e0142c]" />
          继续观看
          <span className="text-sm font-normal text-[#9aa0b0]">本地保存 · 上次看到这里</span>
        </h2>
        <button
          onClick={() => clearHistory()}
          className="text-sm text-[#9aa0b0] transition hover:text-[#ff3b52]"
        >
          清空历史
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {history.map((item) => (
          <div key={item.titleId} className="group text-left">
            <div
              role="button"
              tabIndex={0}
              aria-label={`继续播放${item.name} ${item.ep}`}
              onClick={() => onPlay(item.titleId, historyEpisode(item))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onPlay(item.titleId, historyEpisode(item))
              }}
              className="relative aspect-video cursor-pointer overflow-hidden rounded-md ring-1 ring-white/5"
            >
              <Img
                src={item.img}
                alt={item.name}
                className="h-full w-full transition group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e0142c]/90">
                  <IconPlay className="h-4 w-4 translate-x-px text-white" />
                </span>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  removeHistory(item.sourceId, item.titleId)
                }}
                aria-label="删除记录"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-[#e0142c] group-hover:opacity-100"
              >
                ×
              </button>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15">
                <div className="h-full bg-[#e0142c]" style={{ width: `${item.progress}%` }} />
              </div>
            </div>
            <p className="mt-1.5 truncate text-sm text-white">{item.name}</p>
            <p className="text-[11px] text-[#9aa0b0]">
              {item.ep} · {item.progress}%
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function HeroBanner({
  hero,
  slide,
  setSlide,
  count,
  onOpen,
  sourceId,
  inList,
}: {
  hero: Title
  slide: number
  setSlide: (n: number) => void
  count: number
  onOpen: (id: string) => void
  sourceId: string
  inList: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/8">
      <Img src={hero.backdrop} alt={hero.name} className="h-[340px] w-full lg:h-[440px]" />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-center gap-4 p-6 lg:p-10">
        <div className="max-w-lg">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-[#e0142c] px-2 py-0.5 text-xs font-bold text-white">
              {hero.quality}
            </span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/90">独家首播</span>
            <span className="flex items-center gap-0.5 text-sm font-bold text-[#e8b23a]">
              <IconStar className="h-3.5 w-3.5" /> {ratingLabel(hero)}
            </span>
          </div>
          <h1 className="font-serif text-4xl font-black leading-tight text-white drop-shadow-lg lg:text-6xl">
            {hero.name}
          </h1>
          {hero.sub && <p className="mt-1 font-serif text-lg text-[#e8b23a] lg:text-2xl">{hero.sub}</p>}
          <p className="mt-3 line-clamp-2 max-w-md text-sm leading-relaxed text-[#c9ccd6]">
            {hero.synopsis}
          </p>
          <p className="mt-2 text-xs text-[#9aa0b0]">
            {hero.genres.join(' · ')} · {hero.region} · {hero.year} · {hero.latest}
          </p>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => onOpen(hero.id)}
              className="flex items-center gap-2 rounded-lg bg-[#e0142c] px-6 py-2.5 font-bold text-white shadow-lg shadow-[#e0142c]/30 transition hover:bg-[#ff3b52]"
            >
              <IconPlay className="h-5 w-5" /> 立即播放
            </button>
            <button
              onClick={() =>
                togglePlaylist({
                  sourceId,
                  titleId: hero.id,
                  name: hero.name,
                  latest: hero.latest,
                  img: hero.backdrop,
                })
              }
              className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium backdrop-blur transition ${
                inList
                  ? 'border-[#e0142c]/50 bg-[#e0142c]/15 text-[#ff3b52]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
              }`}
            >
              {inList ? <IconCheck className="h-5 w-5" /> : <IconPlus className="h-5 w-5" />}
              {inList ? '已在片单' : '加入片单'}
            </button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 right-6 flex gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            onClick={() => setSlide(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === slide ? 'w-6 bg-[#e0142c]' : 'w-1.5 bg-white/40 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function Row({
  title,
  items,
  onOpen,
  ranked,
  onMore,
}: {
  title: string
  items: Title[]
  onOpen: (id: string) => void
  ranked?: boolean
  onMore: () => void
}) {
  if (items.length === 0) return null
  return (
    <section className="mt-10">
      <SectionHeader title={title} more onMore={onMore} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.slice(0, 6).map((t, i) => (
          <PosterCard key={`${t.id}-${i}`} t={t} onOpen={onOpen} index={ranked ? i + 1 : undefined} />
        ))}
      </div>
    </section>
  )
}
