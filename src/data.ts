// ============================================================================
// NebulaPlay / 星幕 — 可插拔片源架构 (pluggable video-source layer)
// ----------------------------------------------------------------------------
// data.ts 不再导出全局硬编码数据,而是定义一个 VideoSource 接口 + 本地片源工厂。
// 每个片源(本地精选 / 公有领域 / 未来接入的合法远程 API)都实现同一套异步方法,
// UI 只依赖接口,不关心数据来自哪里 —— 这样切换 / 新增片源都不用改视图代码。
// ============================================================================

import { decodeResponse } from "./decoder"

const img = (id: string, w = 480, h = 680) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format`

// ---- 数据模型 --------------------------------------------------------------
export type Title = {
  id: string
  name: string
  sub?: string
  poster: string
  backdrop: string
  year: number
  rating: number
  ratingKnown?: boolean // false 表示后端没有提供评分，UI 不应把占位值伪装成真实评分
  genres: string[]
  region: string
  quality: string
  episodes: number
  airedEpisodes: number
  latest: string
  synopsis: string
  cast: string[]
  playUrl?: string // 真实可播放的视频地址(合法 / CC 授权)
  playSources?: PlaySource[] // 多清晰度可选源(从高到低)
}

// 单一清晰度的可播放源。
export type PlaySource = { label: string; url: string }

export type RankItem = {
  name: string
  hot: number
  up: boolean
  titleId?: string
}
export type HistoryItem = {
  titleId: string
  name: string
  ep: string
  progress: number
  img: string
}
export type Filters = { genres: string[]; regions: string[]; years: string[] }
export type RatingPoint = { d: string; v: number }

// 条件查询:类型 / 地区 / 年份 / 排序。「全部」等占位值在实现里视为未选择。
export type BrowseFilters = {
  genre?: string
  region?: string
  year?: string
  sort?: string
}

export const ratingLabel = (title: Pick<Title, "rating" | "ratingKnown">) =>
  title.ratingKnown === false ? "Нет оценки" : title.rating.toFixed(1)

// ---- 片源接口 --------------------------------------------------------------
// 所有取数方法都是异步的,方便后续用真实的、你有授权的远程 API 直接替换实现。
export interface VideoSource {
  readonly id: string
  readonly name: string
  readonly badge: string // 侧标,如「精选」「公有领域」
  readonly tagline: string // 一句话说明
  readonly online: boolean // 是否需要联网(演示 loading 用)
  readonly nav: string[]
  readonly filters: Filters

  loadCatalog(): Promise<Title[]>
  loadHero(): Promise<Title>
  loadRanking(): Promise<RankItem[]>
  loadHistory(): Promise<HistoryItem[]>
  loadDetail(id: string): Promise<Title | undefined>
  loadRatingTrend(id: string): Promise<RatingPoint[]>
  loadPlayUrl(id: string, ep: number): Promise<string>
  loadPlaySources(id: string, ep: number): Promise<PlaySource[]> // 多清晰度
  // 可选:源内数据被后台补齐(如 TVBox 渐进补海报)时通知视图刷新。
  subscribe?(listener: () => void): () => void
  // 可选:远程关键词搜索(TVBox CMS wd=)。本地源可不实现。
  search?(query: string): Promise<Title[]>
  // 可选:按分类拉取下一页。返回新增条数与是否还有更多。
  // category 为侧栏分类名(电影/剧集/动漫/综艺/推荐…);本地源可不实现。
  // filters 携带当前条件查询状态,远程源应映射为 CMS 的 t/area/year/by 参数。
  // items 为本轮新拉到的影片（远程源分页展示直接用它，而不是从全局目录再过滤）。
  loadMore?(category?: string, filters?: BrowseFilters): Promise<{
    added: number
    hasMore: boolean
    items: Title[]
  }>
  // 可选:返回指定侧栏分类下的子类型名列表(「类型」筛选行按大类收窄)。
  // 返回 undefined 表示不做分类限定,展示全部类型。
  genresForCategory?(category: string): string[] | undefined
}

// 兜底演示片(CC 授权 Big Buck Bunny,任何片源缺地址时回退到它,保证播放器可用)
export const DEFAULT_SAMPLE =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4"

export const NAV = ["首页", "电影", "剧集", "动漫", "综艺", "我的片单"]

export function deriveFilters(titles: Title[]): Filters {
  const genres = new Set<string>()
  const regions = new Set<string>()
  const years = new Set<number>()
  for (const t of titles) {
    t.genres.forEach((g) => genres.add(g))
    // vod_area 常见「中国大陆 / 中国香港」组合值,拆成原子地区才能做筛选项。
    t.region
      .split(/[\/、,，·]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((r) => regions.add(r))
    years.add(t.year)
  }
  const sortedYears = [...years].sort((a, b) => b - a)
  const recent = sortedYears.filter((y) => y >= 2022).map(String)
  const hasOld = sortedYears.some((y) => y < 2022)
  return {
    genres: ["全部", ...genres],
    regions: ["全部", ...regions],
    years: [
      "全部",
      ...(recent.length ? recent : sortedYears.slice(0, 4).map(String)),
      ...(hasOld ? ["更早"] : []),
    ],
  }
}

// 地区筛选选项:拆分组合地区、按出现频次排序、截断到 cap 个,「未知」垫底。
export function deriveRegionOptions(titles: Title[], cap = 14): string[] {
  const freq = new Map<string, number>()
  for (const t of titles) {
    for (const r of t.region
      .split(/[\/、,，·]+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      freq.set(r, (freq.get(r) ?? 0) + 1)
    }
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r)
  const known = sorted.filter((r) => r !== "未知")
  const unknown = sorted.filter((r) => r === "未知")
  return ["全部", ...known.slice(0, cap), ...unknown]
}

// 年份筛选选项:按倒序取最近 cap 年,更早的合并为「更早」。
export function deriveYearOptions(titles: Title[], cap = 8): string[] {
  const years = new Set<number>()
  for (const t of titles) if (t.year > 0) years.add(t.year)
  const desc = [...years].sort((a, b) => b - a)
  const recent = desc.slice(0, cap).map(String)
  const hasOlder = desc.length > cap
  return ["全部", ...recent, ...(hasOlder ? ["更早"] : [])]
}

export function deriveRanking(titles: Title[]): RankItem[] {
  return [...titles]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 8)
    .map((t, i) => ({
      name: t.sub ? `${t.name}：${t.sub}` : t.name,
      hot: Math.round((t.rating * 10 + (8 - i) * 1.6) * 10) / 10,
      up: i % 3 !== 2,
      titleId: t.id,
    }))
}

export function deriveTrend(t: Title): RatingPoint[] {
  const base = t.rating
  const eps = Math.min(7, Math.max(3, t.airedEpisodes))
  const wobble = [-0.5, -0.2, -0.1, 0.05, 0.1, 0.08, 0.12]
  return Array.from({ length: eps }).map((_, i) => ({
    d:
      t.episodes > 1
        ? `第${Math.round(((i + 1) / eps) * t.airedEpisodes)}集`
        : `第${i + 1}幕`,
    v: Math.round(Math.min(10, base + (wobble[i] ?? 0.1)) * 10) / 10,
  }))
}

// ============================================================================
// 片源注册表 —— 默认不再内置任何 mock 演示片库,只保留真实片源:
// 预置 TVBox 采集站(builtinSources.ts,探活后自动过滤失活源) + 用户自定义源。
// ============================================================================
export const SOURCES: VideoSource[] = []

// 首次进入默认选择置顶资源组中的速播；探活确认失效后仍由 App 自动轮换。
export const DEFAULT_SOURCE_ID =
  "tvbox-https://www.subozy.com/api.php/provide/vod"

// ============================================================================
// 自定义片源 —— 用户在界面里手动配置的片源地址(持久化在 customSources.ts)。
// 支持两种合法用法:
//   1) 片库 JSON 地址(catalogUrl):返回一个影片数组的接口(需允许跨域 CORS)。
//   2) 直链播放地址(fallbackPlayUrl):单个可播放的 mp4 / webm / m3u8 直链。
// 也可直接内联一份 titles。
// ============================================================================
export type CustomSourceConfig = {
  id: string
  name: string
  kind?: "tvbox" | "cms" | "cms-api" // TVBox 线路 / 单站 CMS 采集接口 / 旧兼容源
  tagline?: string
  catalogUrl?: string // JSON 片库、TVBox 线路配置或完整 CMS API 端点
  detailUrl?: string // cms-api 可选 HTML 详情站根地址
  fallbackPlayUrl?: string // 直链播放地址 / 兜底播放地址
  titles?: Title[] // 可选:直接内联的片库
}

// 自定义片源条目的占位图(深色街景,与全站暗色主题一致)。
const CUSTOM_IMG_ID = "1548317202-26d94742e8d8"
const CUSTOM_POSTER = img(CUSTOM_IMG_ID)
const CUSTOM_BACKDROP = img(CUSTOM_IMG_ID, 1800, 900)

// 把宽松 / 异构的原始对象归一化为 Title,缺失字段用合理默认值补齐。
// 兼容常见字段别名(含 vod_* 风格),但仅取「直链播放地址」,不解析任何私有协议。
function normalizeTitle(raw: any, i: number, fallbackPlayUrl?: string): Title {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (raw?.[k] != null && raw[k] !== "") return raw[k]
    return undefined
  }
  const rawPlay: unknown = pick(
    "playUrl",
    "url",
    "src",
    "vod_play_url",
    "video",
  )
  // 若是 "标题$地址#标题$地址" 之类的串,取第一个看起来像 URL 的片段。
  let playUrl: string | undefined
  if (typeof rawPlay === "string") {
    const seg = rawPlay.split("#")[0]
    playUrl = (seg.includes("$") ? seg.split("$").pop() : seg)?.trim()
  }
  const genresRaw = pick("genres", "type", "vod_class", "tags")
  const genres = Array.isArray(genresRaw)
    ? genresRaw.map(String)
    : typeof genresRaw === "string"
      ? genresRaw.split(/[,\/、\s]+/).filter(Boolean)
      : ["其他"]
  const castRaw = pick("cast", "actors", "vod_actor")
  const cast = Array.isArray(castRaw)
    ? castRaw.map(String)
    : typeof castRaw === "string"
      ? castRaw.split(/[,\/、\s]+/).filter(Boolean)
      : []
  const poster = pick("poster", "pic", "vod_pic", "cover", "image")
  const backdrop = pick("backdrop", "banner") ?? poster ?? CUSTOM_BACKDROP
  const ratingNum = Number(pick("rating", "score", "vod_score"))
  const yearNum = Number(pick("year", "vod_year"))

  return {
    id: String(pick("id", "vod_id") ?? `x${i}`),
    name: String(pick("name", "title", "vod_name") ?? `Фильм ${i + 1}`),
    sub: pick("sub", "subtitle", "vod_sub")
      ? String(pick("sub", "subtitle", "vod_sub"))
      : undefined,
    poster: poster ? String(poster) : CUSTOM_POSTER,
    backdrop: String(backdrop),
    year:
      Number.isFinite(yearNum) && yearNum > 0
        ? yearNum
        : new Date().getFullYear(),
    rating:
      Number.isFinite(ratingNum) && ratingNum > 0
        ? Math.min(10, ratingNum)
        : 7.5,
    genres: genres.length ? genres : ["其他"],
    region: String(pick("region", "area", "vod_area") ?? "未知"),
    quality: String(pick("quality", "vod_remarks") ?? "自定义"),
    episodes: 1,
    airedEpisodes: 1,
    latest: String(pick("latest", "vod_remarks") ?? "全片"),
    synopsis: String(
      pick("synopsis", "desc", "blurb", "vod_content") ?? "Описание отсутствует.",
    ),
    cast,
    playUrl: playUrl || fallbackPlayUrl || undefined,
  }
}

export function normalizeTitles(
  raw: unknown,
  fallbackPlayUrl?: string,
): Title[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr.map((r, i) => normalizeTitle(r, i, fallbackPlayUrl))
}

// 从各种常见响应结构里取出影片数组。
function extractList(data: any): unknown[] {
  if (Array.isArray(data)) return data
  const rss = data?.rss
  const itemsOf = (node: any) => {
    const item = node?.item
    if (Array.isArray(item)) return item
    if (item && typeof item === "object") return [item]
    return null
  }
  return (
    (Array.isArray(data?.list) ? data.list : itemsOf(data?.list)) ??
    data?.titles ??
    data?.data?.list ??
    data?.data ??
    data?.items ??
    itemsOf(rss?.list) ??
    itemsOf(rss?.channel) ??
    []
  )
}

// 由一份自定义配置构造 VideoSource:内联 titles 直接可用,catalogUrl 则惰性拉取并缓存。
export function makeCustomSource(cfg: CustomSourceConfig): VideoSource {
  const inline =
    cfg.titles && cfg.titles.length
      ? normalizeTitles(cfg.titles, cfg.fallbackPlayUrl)
      : null
  let cache: Title[] | null = inline
  let inflight: Promise<Title[]> | null = null

  const ensure = (): Promise<Title[]> => {
    if (cache) return Promise.resolve(cache)
    if (!cfg.catalogUrl) return Promise.resolve((cache = []))
    if (!inflight) {
      inflight = fetch(cfg.catalogUrl, { mode: "cors" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.text()
        })
        .then((text) => decodeResponse(text).data)
        .then(
          (data) =>
            (cache = normalizeTitles(extractList(data), cfg.fallbackPlayUrl)),
        )
        .catch((e) => {
          inflight = null // 允许下次重试
          throw new Error(
            `片库加载失败:${e instanceof Error ? e.message : String(e)}`,
          )
        })
    }
    return inflight
  }

  const find = async (id: string) => (await ensure()).find((t) => t.id === id)

  return {
    id: cfg.id,
    name: cfg.name,
    badge: "自定义",
    tagline: cfg.tagline ?? "Настраиваемый источник",
    online: !!cfg.catalogUrl,
    nav: NAV,
    get filters() {
      return cache && cache.length
        ? deriveFilters(cache)
        : { genres: ["全部"], regions: ["全部"], years: ["全部"] }
    },
    async loadCatalog() {
      return ensure()
    },
    async loadHero() {
      const t = await ensure()
      return t[0]
    },
    async loadRanking() {
      return deriveRanking(await ensure())
    },
    async loadHistory() {
      return []
    },
    async loadDetail(id) {
      return find(id)
    },
    async loadRatingTrend(id) {
      const t = await find(id)
      return t ? deriveTrend(t) : []
    },
    async loadPlayUrl(id) {
      const t = await find(id)
      return (
        t?.playSources?.[0]?.url ??
        t?.playUrl ??
        cfg.fallbackPlayUrl ??
        DEFAULT_SAMPLE
      )
    },
    async loadPlaySources(id) {
      const t = await find(id)
      if (t?.playSources?.length) return t.playSources
      return [
        {
          label: "标清",
          url: t?.playUrl ?? cfg.fallbackPlayUrl ?? DEFAULT_SAMPLE,
        },
      ]
    },
  }
}
