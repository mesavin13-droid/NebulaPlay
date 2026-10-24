import { useEffect, useMemo, useState } from "react"
import {
  Clapperboard,
  Clock3,
  Film,
  Heart,
  House,
  ListVideo,
  Mic2,
  Sparkles,
  Star,
  Tv,
  type LucideIcon,
} from "lucide-react"
import {
  deriveRegionOptions,
  deriveYearOptions,
  ratingLabel,
  type Filters,
  type Title,
  type VideoSource,
} from "../data"
import { useHistory } from "../history"
import { PageLoading } from "../PageLoading"
import { usePlaylist } from "../playlist"
import type { Catalog } from "../useCatalog"
import { IconPlay, IconStar, Img, PosterCard, Pill } from "../ui"
import { ruLabel } from "../localization"

// 侧栏内容类别跟随当前片源返回的分类(推荐/经典重温为本地合成入口,常驻)。
const CONTENT_FALLBACK = ["电影", "剧集", "动漫", "综艺", "纪录片"]

const ICON_RULES: [RegExp, LucideIcon][] = [
  [/动漫|动画|番/, Sparkles],
  [/综艺|真人秀|脱口秀/, Mic2],
  [/纪录/, Film],
  [/剧/, Tv],
  [/电影|片/, Clapperboard],
]

const iconFor = (label: string): LucideIcon =>
  ICON_RULES.find(([re]) => re.test(label))?.[1] ?? Clapperboard

const LOCAL_SIDE: [LucideIcon, string][] = [
  [Clock3, "观看历史"],
  [Heart, "我的收藏"],
  [ListVideo, "我的片单"],
]

const SORTS = ["最热", "最新", "评分最高", "好评优先"]

// 把「导航栏 / 侧栏分类」映射为对影片的判定。返回 null 表示不按内容分类过滤(如推荐)。
// 优先用 CMS 的 type_name（genres[0]）判断，本地源回退到 episodes 推断。
function categoryPredicate(cat: string): ((t: Title) => boolean) | null {
  const firstGenre = (t: Title) => (t.genres[0] ?? "").trim()
  switch (cat) {
    case "电影":
      return (t) => {
        const g = firstGenre(t)
        if (/片$/.test(g) || g === "电影" || g === "预告片") return true
        if (
          /剧$/.test(g) ||
          g === "连续剧" ||
          /动漫/.test(g) ||
          g === "综艺" ||
          g === "纪录片"
        )
          return false
        return t.episodes <= 1
      }
    case "剧集":
      return (t) => {
        const g = firstGenre(t)
        if (/剧$/.test(g) || g === "连续剧") return true
        if (
          /片$/.test(g) ||
          g === "电影" ||
          /动漫/.test(g) ||
          g === "综艺" ||
          g === "纪录片"
        )
          return false
        return t.episodes > 1
      }
    case "动漫":
      return (t) => t.genres.some((g) => /动画|动漫|番|漫/.test(g))
    case "综艺":
      return (t) => t.genres.some((g) => /综艺|真人秀|脱口秀|访谈/.test(g))
    case "纪录片":
      return (t) => t.genres.some((g) => /纪录|纪实/.test(g))
    case "经典重温":
      return (t) => t.year < 2000
    default:
      return null // 推荐 / 全部
  }
}

// 侧栏里这些分类展示的是本地数据(历史 / 片单),而非片库内容。
const LOCAL_TABS = new Set(["观看历史", "我的收藏", "我的片单"])

export function Browse({
  catalog,
  filters,
  category,
  sourceId,
  source,
  onOpen,
}: {
  catalog?: Catalog
  filters: Filters
  category: string
  sourceId: string
  source?: VideoSource
  onOpen: (id: string) => void
}) {
  const [side, setSide] = useState(category === "首页" ? "推荐" : category)
  const [genre, setGenre] = useState("全部")
  const [region, setRegion] = useState("全部")
  const [year, setYear] = useState("全部")
  const [sort, setSort] = useState("最热")
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [hasMore, setHasMore] = useState(!!source?.loadMore)
  const [status, setStatus] = useState<string | null>(null)
  const history = useHistory(sourceId)
  const playlist = usePlaylist(sourceId)

  const isRemote = !!source?.loadMore
  const isLocal = LOCAL_TABS.has(side)

  // 内容类别:远程源用接口返回的真实分类(nav 去掉 首页/我的片单),本地源回退固定大类。
  const sideItems = useMemo<[LucideIcon, string][]>(() => {
    const remoteCats = isRemote
      ? (source?.nav ?? []).filter((l) => l !== "首页" && l !== "我的片单")
      : []
    const cats = remoteCats.length ? remoteCats : CONTENT_FALLBACK
    return [
      [House, "推荐"],
      ...cats.map((c): [LucideIcon, string] => [iconFor(c), c]),
      [Star, "经典重温"],
      ...LOCAL_SIDE,
    ]
  }, [isRemote, source])

  // 远程源:片源 / 侧栏 / 筛选任何变化都重新发 API 查询(第一页),
  // 列表直接展示接口返回,不再从全局目录本地过滤。
  const [remoteItems, setRemoteItems] = useState<Title[]>([])
  const queryKey = [
    source?.id ?? "local",
    side,
    genre,
    region,
    year,
    sort,
  ].join("\u0000")
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null)
  const querying = isRemote && !isLocal && resolvedQueryKey !== queryKey

  useEffect(() => {
    if (!isRemote || isLocal) {
      setRemoteItems([])
      setResolvedQueryKey(queryKey)
      return
    }
    let cancelled = false
    setRemoteItems([])
    setHasMore(true)
    setStatus(null)
    setResolvedQueryKey(null)
    source.loadMore!(side, { genre, region, year, sort })
      .then((r) => {
        if (cancelled) return
        setRemoteItems(r.items)
        setHasMore(r.hasMore)
        if (!r.items.length) setStatus("В этой категории пока нет фильмов")
      })
      .catch((e) => {
        if (cancelled) return
        setStatus(e instanceof Error ? e.message  : "Не удалось загрузить каталог")
      })
      .finally(() => {
        if (!cancelled) setResolvedQueryKey(queryKey)
      })
    return () => {
      cancelled = true
    }
    // isLocal 由 side 派生,随 side 一起变化;列入依赖保证语义完整。
  }, [source, side, genre, region, year, sort, isRemote, isLocal, queryKey])

  // 顶部导航切换分类时,侧栏跟随高亮,并重置筛选,避免落到空结果。
  useEffect(() => {
    if (category && category !== "首页") {
      setSide(category)
      setGenre("全部")
      setRegion("全部")
      setYear("全部")
    }
  }, [category])

  // 远程源展示接口查询结果；本地源在内建片库上做完整的侧栏+筛选过滤。
  const list = useMemo(() => {
    if (isRemote) {
      // 经典重温没有对应的接口分类,在接口结果上按年份收窄。
      if (side === "经典重温") return remoteItems.filter((t) => t.year < 2000)
      return remoteItems
    }
    const inCat = categoryPredicate(side)
    let out = (catalog?.titles ?? []).filter(
      (t) =>
        (!inCat || inCat(t)) &&
        (genre === "全部" || t.genres.includes(genre)) &&
        (region === "全部" || t.region === region) &&
        (year === "全部" ||
          (year === "更早" ? t.year < 2022 : String(t.year) === year)),
    )
    if (sort === "最新") out = [...out].sort((a, b) => b.year - a.year)
    if (sort === "评分最高" || sort === "好评优先")
      out = [...out].sort((a, b) => b.rating - a.rating)
    return out
  }, [isRemote, remoteItems, catalog, side, genre, region, year, sort])

  const spotlight = list.slice(0, 4)

  // 筛选项跟随当前侧栏大类:
  // 类型 = 该大类的子类型(远程源由 genresForCategory 提供);
  // 地区/年份 = 该大类范围内的影片派生(远程源从已加载的同类条目统计)。
  const scopedCatalog = useMemo(() => {
    const all = catalog?.titles ?? []
    if (!isRemote) return all
    const inCat = categoryPredicate(side)
    return inCat ? all.filter(inCat) : all
  }, [isRemote, catalog, side])

  const genreOptions = useMemo(() => {
    if (!isRemote) return filters.genres
    const custom = source?.genresForCategory?.(side)
    return custom && custom.length ? ["全部", ...custom] : filters.genres
  }, [isRemote, source, side, filters.genres])

  const regionOptions = useMemo(
    () => (isRemote ? deriveRegionOptions(scopedCatalog) : filters.regions),
    [isRemote, filters.regions, scopedCatalog],
  )

  const yearOptions = useMemo(
    () => (isRemote ? deriveYearOptions(scopedCatalog) : filters.years),
    [isRemote, filters.years, scopedCatalog],
  )
  const canPage = isRemote && !isLocal

  const loadMore = async () => {
    if (!source?.loadMore || loadingMore || loadingAll) return
    setLoadingMore(true)
    setStatus(null)
    try {
      const r = await source.loadMore(side, { genre, region, year, sort })
      setRemoteItems((prev) => {
        const have = new Set(prev.map((t) => t.id))
        return [...prev, ...r.items.filter((t) => !have.has(t.id))]
      })
      setHasMore(r.hasMore)
      setStatus(
        r.items.length > 0
          ? `Загружено: ${r.items.length}`
          : r.hasMore
            ? "На этой странице новых фильмов нет. Попробуйте загрузить ещё."
            : "Больше результатов нет",
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message  : "Не удалось загрузить каталог")
    } finally {
      setLoadingMore(false)
    }
  }

  const loadAll = async () => {
    if (!source?.loadMore || loadingMore || loadingAll) return
    setLoadingAll(true)
    setStatus(null)
    let total = 0
    let rounds = 0
    try {
      // 全查询:连续翻页,最多 30 轮,避免失控打爆接口。
      while (rounds < 30) {
        const r = await source.loadMore(side, { genre, region, year, sort })
        setRemoteItems((prev) => {
          const have = new Set(prev.map((t) => t.id))
          return [...prev, ...r.items.filter((t) => !have.has(t.id))]
        })
        total += r.items.length
        rounds += 1
        setStatus(`Загрузка всего каталога… добавлено: ${total}`)
        // 只有确认到底才停;前 1-2 轮可能出现「本页都是已加载内容」的重复页。
        if (!r.hasMore) {
          setHasMore(false)
          break
        }
        if (r.items.length === 0 && rounds >= 2) break
      }
      setStatus(total > 0 ? `Загрузка завершена. Добавлено: ${total}` : "Больше результатов нет")
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Не удалось загрузить весь каталог")
    } finally {
      setLoadingAll(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-[1440px] gap-6 px-4 pb-16 lg:px-8">
      <aside className="sticky top-20 hidden h-fit w-[92px] shrink-0 flex-col gap-1 lg:flex">
        {sideItems.map(([Icon, label]) => (
          <button
            key={label}
            onClick={() => {
              setSide(label)
              // 筛选项随大类收窄,旧选择在新大类下可能无意义,统一直置「全部」。
              setGenre("全部")
              setRegion("全部")
              setYear("全部")
            }}
            className={`flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs transition ${
              side === label
                ? "bg-[#e0142c]/12 text-[#ff3b52] ring-1 ring-[#e0142c]/30"
                : "text-[#9aa0b0] hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {ruLabel(label)}
          </button>
        ))}
      </aside>

      <div className="min-w-0 flex-1 pt-5">
        {isLocal ? (
          <LocalTab
            tab={side}
            history={history}
            playlist={playlist}
            onOpen={onOpen}
          />
        ) : querying ? (
          <PageLoading
            compact
            label={`正在加载「${side}」`}
            detail="筛选与影片列表准备完成后将一次展示"
          />
        ) : (
          <>
            <div className="rounded-xl border border-white/6 bg-[#0e1018] p-4">
              <FilterRow
                label="Жанр"
                options={genreOptions}
                value={genre}
                onChange={setGenre}
              />
              <FilterRow
                label="Страна"
                options={regionOptions}
                value={region}
                onChange={setRegion}
              />
              <FilterRow
                label="Год"
                options={yearOptions}
                value={year}
                onChange={setYear}
              />
              <div className="flex items-center gap-2 pt-2">
                <span className="w-10 shrink-0 text-sm text-[#5a5f70]">
                  排序
                </span>
                <div className="flex flex-wrap gap-1">
                  {SORTS.map((s) => (
                    <Pill
                      key={s}
                      active={sort === s}
                      onClick={() => setSort(s)}
                    >
                      {ruLabel(s)}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {spotlight.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="group relative overflow-hidden rounded-lg ring-1 ring-white/6"
                >
                  <Img
                    src={t.backdrop}
                    alt={t.name}
                    className="aspect-[16/10] w-full transition group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                  <div className="absolute inset-x-3 bottom-2 text-left">
                    <p className="flex items-center gap-1 text-xs font-bold text-[#e8b23a]">
                      <IconStar className="h-3 w-3" /> {ratingLabel(t)}
                    </p>
                    <p className="truncate text-sm font-medium text-white">
                      {t.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <div className="mb-4 mt-8 flex items-center gap-3">
              <h2 className="font-serif text-lg font-bold text-white">
                {ruLabel(side === "推荐" ? "为你推荐" : side)}
              </h2>
              <span className="text-sm text-[#5a5f70]">
                Всего: {list.length}
              </span>
            </div>

            {querying && list.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-[#e0142c]" />
              </div>
            ) : list.length === 0 ? (
              <p className="py-16 text-center text-[#5a5f70]">
                В категории «{side}» пока нет фильмов. Попробуйте другой источник или ослабьте фильтры.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {list.map((t) => (
                  <PosterCard key={t.id} t={t} onOpen={onOpen} />
                ))}
              </div>
            )}

            {canPage && (
              <div className="mt-8 flex flex-col items-center gap-3">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore || loadingAll || !hasMore}
                    className="rounded-xl bg-[#e0142c] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#ff3b52] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loadingMore
                      ? "Загрузка…"
                      : hasMore
                        ? "Загрузить ещё"
                        : "Больше нет"}
                  </button>
                  <button
                    onClick={loadAll}
                    disabled={loadingMore || loadingAll || !hasMore}
                    className="rounded-xl border border-white/15 bg-white/5 px-5 py-2 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loadingAll ? "Загружаем всё…" : "Загрузить весь каталог"}
                  </button>
                </div>
                {status && <p className="text-xs text-[#9aa0b0]">{status}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// 本地分类:观看历史 / 我的片单 用本地存储渲染;我的收藏暂为占位空态。
function LocalTab({
  tab,
  history,
  playlist,
  onOpen,
}: {
  tab: string
  history: ReturnType<typeof useHistory>
  playlist: ReturnType<typeof usePlaylist>
  onOpen: (id: string) => void
}) {
  if (tab === "我的收藏") {
    return (
      <EmptyLocal
        icon={Heart}
        title="В избранном пока нет фильмов"
        desc="Нажмите «В избранное» на странице фильма, чтобы он появился здесь."
      />
    )
  }

  if (tab === "我的片单") {
    if (playlist.length === 0) {
      return (
        <EmptyLocal
          icon={ListVideo}
          title="Ваш список фильмов пока пуст"
          desc="Нажмите «В мой список» на главном экране или на карточке фильма."
        />
      )
    }
    return (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-serif text-lg font-bold text-white">我的片单</h2>
          <span className="text-sm text-[#5a5f70]">
            Всего: {playlist.length} · сохранено на устройстве
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {playlist.map((p) => (
            <button
              key={p.titleId}
              onClick={() => onOpen(p.titleId)}
              className="group text-left"
            >
              <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/6">
                <Img
                  src={p.img}
                  alt={p.name}
                  className="h-full w-full transition group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e0142c]/90">
                    <IconPlay className="h-4 w-4 translate-x-px text-white" />
                  </span>
                </div>
              </div>
              <p className="mt-1.5 truncate text-sm text-white">{p.name}</p>
              <p className="text-[11px] text-[#9aa0b0]">{p.latest}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const heading = "История просмотров"
  if (history.length === 0) {
    return (
      <EmptyLocal
        icon={Clock3}
        title={`История просмотров пока пуста`}
        desc="После просмотра фильма запись автоматически сохранится на устройстве и появится здесь."
      />
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-serif text-lg font-bold text-white">{heading}</h2>
        <span className="text-sm text-[#5a5f70]">
          Записей: {history.length} · сохранено на устройстве
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {history.map((h) => (
          <button
            key={h.titleId}
            onClick={() => onOpen(h.titleId)}
            className="group text-left"
          >
            <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/6">
              <Img
                src={h.img}
                alt={h.name}
                className="h-full w-full transition group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e0142c]/90">
                  <IconPlay className="h-4 w-4 translate-x-px text-white" />
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15">
                <div
                  className="h-full bg-[#e0142c]"
                  style={{ width: `${h.progress}%` }}
                />
              </div>
            </div>
            <p className="mt-1.5 truncate text-sm text-white">{h.name}</p>
            <p className="text-[11px] text-[#9aa0b0]">
              {h.ep} · {h.progress}%
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

function EmptyLocal({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon
  title: string
  desc: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-white/5 text-[#9aa0b0]">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 font-serif text-xl font-bold text-white">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-[#9aa0b0]">{desc}</p>
    </div>
  )
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-start gap-2 border-b border-white/5 py-2 last:border-0">
      <span className="w-10 shrink-0 pt-1 text-sm text-[#5a5f70]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Pill key={o} active={value === o} onClick={() => onChange(o)}>
            {o}
          </Pill>
        ))}
      </div>
    </div>
  )
}
