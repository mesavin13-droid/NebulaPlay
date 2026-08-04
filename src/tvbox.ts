// ============================================================================
// TVBox 多线路订阅适配层
// ----------------------------------------------------------------------------
// 支持 TVBox 生态的两级配置:
//   1) 多线路订阅(tvboxmuti.json 风格):{ urls: [{ name, url }] } —— 每条「线路」
//      指向一份完整 TVBox 配置。
//   2) 线路配置:{ sites: [...] } —— 站点里只有「苹果CMS 风格 JSON 采集接口」
//      (type 0/1 且 api 为 http(s) 地址)能在浏览器里直接工作;
//      type 3 的 csp_*/dr_py spider 源依赖 TVBox 客户端运行时,自动跳过。
//
// 所有第三方请求都经 Vite 开发服务器的同源代理 /__tvbox?u=<url> 转发,
// 规避浏览器 CORS 限制;m3u8 播放地址同样走代理(代理会重写分片地址)。
// ============================================================================

import {
  DEFAULT_SAMPLE,
  deriveFilters,
  deriveRanking,
  deriveTrend,
  NAV,
  type BrowseFilters,
  type Title,
  type VideoSource,
} from './data'
import {
  cmsApiUrl,
  cmsClassesOf,
  cmsListData,
  isBrowserCmsSite,
  mapCmsVod,
  parseCmsPlayGroups,
  type CmsClass,
  type CmsEpisode,
  type CmsSite,
} from './cmsProfile'
import { fetchDecoded, parseTolerantJson } from './decoder'
import { Paginator } from './pagination'

export type TvboxLine = { name: string; url: string }

// 兼容旧入口:统一解码器里保留了容错 JSON 解析。
export { parseTolerantJson as parseTvboxJson } from './decoder'

// ---- 同源代理 ---------------------------------------------------------------
const PROXY_BASE = '/__tvbox?u='

export const viaProxy = (u: string) => PROXY_BASE + encodeURIComponent(u)

// 直链 mp4/webm 可由 <video> 直接跨域播放;其余(m3u8 / 无明确扩展名)走代理。
const wrapPlayUrl = (u: string) => (/\.(mp4|webm|m4v|mov)($|[?#])/i.test(u) ? u : viaProxy(u))

// 部分「播放页」地址(hhyun 等)其实是 HTML 播放器页,真实流在 <url>/index.m3u8。
export const normalizePlayUrl = (u: string): string => {
  try {
    const url = new URL(u)
    if (
      /^play\.(hhuus|hhdx|xluuss)\.com$/.test(url.hostname) &&
      url.pathname.startsWith('/play/') &&
      !/\.m3u8$/i.test(url.pathname)
    ) {
      return `${url.origin}${url.pathname.replace(/\/$/, '')}/index.m3u8`
    }
  } catch {
    /* 非标准地址原样返回 */
  }
  return u
}

// ---- 多线路订阅解析 ----------------------------------------------------------
export function parseTvboxLines(data: any): TvboxLine[] {
  const arr = Array.isArray(data?.urls) ? data.urls : Array.isArray(data) ? data : data?.url ? [data] : []
  return arr
    .map((x: any): TvboxLine => ({ name: String(x?.name ?? '').trim(), url: String(x?.url ?? '').trim() }))
    .filter((l: TvboxLine) => /^https?:\/\//.test(l.url))
}

async function fetchJson(u: string, timeoutMs = 10000): Promise<any> {
  const doc = await fetchDecoded(viaProxy(u), { timeoutMs })
  return doc.data
}

// 拉取多线路订阅,返回全部线路。
export async function fetchTvboxLines(subscribeUrl: string): Promise<TvboxLine[]> {
  const lines = parseTvboxLines(await fetchJson(subscribeUrl, 15000))
  if (!lines.length) throw new Error('订阅内容里没有可用线路(urls 为空)')
  return lines
}

// ---- 站点筛选与接口拼接(类型 / URL 拼接收敛到 cmsProfile) ------------------
const mapVod = (v: any) => mapCmsVod(v, { posterUrl: viaProxy })
const apiUrl = cmsApiUrl

// ---- 线路 → VideoSource -------------------------------------------------------
// 一条线路一份 VideoSource:首次取数时拉取线路配置,顺序探测浏览器可用站点,
// 命中后缓存;目录 = 首页推荐 + 前几个分类的首页(去重,上限约百部)。

// 上次探测成功的站点,按线路 URL 持久化 —— 下次打开免探测,直接命中。
const SITE_CACHE_KEY = 'nebulaplay:tvbox-site:v1'
const readSiteCache = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SITE_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}
const writeSiteCache = (lineUrl: string, api: string) => {
  try {
    const m = readSiteCache()
    m[lineUrl] = api
    localStorage.setItem(SITE_CACHE_KEY, JSON.stringify(m))
  } catch {
    /* 存储不可用时跳过 */
  }
}

export function makeTvboxLineSource(line: TvboxLine): VideoSource {
  let site: (CmsSite & { api: string }) | null = null
  let siteInflight: Promise<CmsSite & { api: string }> | null = null
  let acList = 'videolist'
  let classes: CmsClass[] = []
  // 站点探测已拿到一页有效目录；交给 loadAll 消费，避免成功后立刻重拉同一 URL。
  let handshakeListResponse: unknown
  let catalog: Title[] | null = null
  let inflight: Promise<Title[]> | null = null
  const details = new Map<string, Title>()
  const detailInflight = new Map<string, Promise<Title | undefined>>()
  const playGroups = new Map<string, { from: string[]; groups: CmsEpisode[][] }>()
  // 海报渐进补齐:列表接口常不带 vod_pic,后台拉详情补图并通知视图刷新。
  const listeners = new Set<() => void>()
  let notifyTimer: ReturnType<typeof setTimeout> | null = null
  const notify = () => {
    if (notifyTimer) return
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      listeners.forEach((f) => f())
    }, 150)
  }
  let enrichGen = 0
  // 分页状态:按分类 key 记录下一页页码与是否还有更多。
  // key = '_' 表示首页/推荐;其余为 type_id 字符串。
  const paginator = new Paginator()
  // 分页状态:按「组合 key + typeId」记录下一页与是否到底。
  // combinedKey 由分类+筛选签名组成,typeId 为展开后的每个叶子分类。
  type ChildState = { next: number; done: boolean }
  const queryStates = new Map<string, Map<string, ChildState>>()
  // 串行链:快速连续切换筛选时查询按序执行,避免 in-flight 去重把新查询吞掉。
  let moreChain: Promise<unknown> = Promise.resolve()

  // 探测站点:上次成功的优先,前 4 个并行竞速,首个返回 list 的胜出。
  type Win = {
    s: CmsSite & { api: string }
    ac: string
    classes: CmsClass[]
    listResponse: unknown
  }

  const adoptSite = (win: Win) => {
    site = win.s
    acList = win.ac
    classes = win.classes
    handshakeListResponse = win.listResponse
    writeSiteCache(line.url, win.s.api)
    return site
  }

  // URL 本身可能是「单站苹果 CMS 采集接口」(如 .../api.php/provide/vod),
  // 不带 TVBox 的 sites 配置,直接按 CMS API 探测。
  async function probeDirectApi(baseResponse?: unknown): Promise<Win | null> {
    // 先取 base URL 拿 class 列表（videolist 响应通常不含 class）。
    let baseClasses = cmsClassesOf(baseResponse)
    if (baseResponse === undefined) {
      try {
        const baseResp = await fetchJson(line.url, 6000)
        baseClasses = cmsClassesOf(baseResp)
      } catch { /* base URL 不可达时忽略 */ }
    }

    for (const ac of ['videolist', 'vod_list', 'list'] as const) {
      try {
        const j = await fetchJson(apiUrl(line.url, { ac }), 6000)
        if (cmsListData(j)) {
          const classes = cmsClassesOf(j)
          return {
            s: { api: line.url, name: line.name },
            ac,
            classes: classes.length ? classes : baseClasses,
            listResponse: j,
          }
        }
      } catch {
        /* 换接口风格再试 */
      }
    }
    return null
  }

  async function resolveSite(): Promise<CmsSite & { api: string }> {
    let cfg: any = null
    try {
      cfg = await fetchJson(line.url, 15000)
    } catch {
      // 配置拉不到,URL 本身可能是采集接口。
      const direct = await probeDirectApi()
      if (direct) return adoptSite(direct)
      throw new Error(`线路「${line.name}」无法访问(网络受限或接口已失效)`)
    }
    const sites: CmsSite[] = Array.isArray(cfg?.sites) ? cfg.sites : []
    const usable = sites.filter(isBrowserCmsSite)
    if (!usable.length) {
      if (!sites.length) {
        // 没有 sites:URL 本身可能是单站采集接口。
        const direct = await probeDirectApi(cfg)
        if (direct) return adoptSite(direct)
      }
      throw new Error(
        sites.length
          ? `线路「${line.name}」的 ${sites.length} 个站点均为 spider 私有协议,只能在 TVBox 客户端使用`
          : `线路「${line.name}」没有可用的 CMS 接口`,
      )
    }
    const cachedApi = readSiteCache()[line.url]
    const ordered = [...usable].sort((a, b) =>
      a.api === cachedApi ? -1 : b.api === cachedApi ? 1 : 0,
    )
    const tryOne = async (s: CmsSite & { api: string }): Promise<Win> => {
      // 先取 base URL 拿 class 列表（videolist 响应通常不含 class）。
      let baseClasses: CmsClass[] = []
      try {
        const baseResp = await fetchJson(s.api, 6000)
        baseClasses = cmsClassesOf(baseResp)
      } catch { /* base URL 不可达时忽略 */ }

      for (const ac of ['videolist', 'vod_list', 'list'] as const) {
        try {
          const j = await fetchJson(apiUrl(s.api, { ac }), 6000)
          if (cmsListData(j)) {
            const classes = cmsClassesOf(j)
            return { s, ac, classes: classes.length ? classes : baseClasses, listResponse: j }
          }
        } catch {
          /* 该站点不可达,换接口风格再试 */
        }
      }
      throw new Error('unusable')
    }

    let win: Win | null = null
    try {
      win = await firstSuccess(ordered.slice(0, 4).map((s) => tryOne(s)))
    } catch {
      // 前 4 个全失败,顺序补试后面的
      for (const s of ordered.slice(4, 10)) {
        try {
          win = await tryOne(s)
          break
        } catch {
          /* 继续下一个 */
        }
      }
    }
    if (!win) {
      throw new Error(`线路「${line.name}」的站点均无法访问(网络受限或接口已失效)`)
    }
    return adoptSite(win)
  }

  function ensureSite(): Promise<CmsSite & { api: string }> {
    if (site) return Promise.resolve(site)
    if (siteInflight) return siteInflight
    siteInflight = resolveSite().finally(() => {
      siteInflight = null
    })
    return siteInflight
  }

// Promise.any 的轻量替代(项目 tsconfig lib 低于 es2021)。
function firstSuccess<T>(ps: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = ps.length
    if (!pending) return reject(new Error('empty'))
    ps.forEach((p) =>
      p.then(resolve, () => {
        if (--pending === 0) reject(new Error('all failed'))
      }),
    )
  })
}

  function pushList(list: unknown, into: Map<string, Title>): number {
    if (!Array.isArray(list)) return 0
    let added = 0
    for (const v of list) {
      const t = mapVod(v)
      if (!t) continue
      if (!into.has(t.id)) {
        into.set(t.id, t)
        added++
      }
      // 同步写入全局目录缓存
      if (catalog) {
        const existing = catalog.find((x) => x.id === t.id)
        if (existing) Object.assign(existing, { poster: existing.poster || t.poster, backdrop: existing.backdrop || t.backdrop })
        else catalog.push(t)
      }
    }
    return added
  }

  // XML 响应里 list 是对象而非数组,统一走 cmsListData 数条数。
  const notePage = (key: string, page: number, resp: any) =>
    paginator.noteList(key, page, (cmsListData(resp) ?? []).length, Number(resp?.pagecount), Number(resp?.total))

  // 条件查询 → CMS 参数。key 里带上筛选签名,每个组合各自维护分页游标。
  const EMPTY_FILTERS: BrowseFilters = {}
  const filterValue = (v: string | undefined) => (v && v !== '全部' ? v.trim() : '')
  const sortBy = (sort?: string) => {
    if (sort === '最新') return 'time'
    if (sort === '评分最高' || sort === '好评优先') return 'score'
    if (sort === '最热') return 'hits'
    return ''
  }
  const queryKey = (catKey: string, f: BrowseFilters) =>
    [catKey, filterValue(f.region), f.year && f.year !== '全部' && f.year !== '更早' ? f.year.trim() : '', sortBy(f.sort)].join('|')
  const classByGenre = (f: BrowseFilters) => {
    const genre = filterValue(f.genre)
    if (!genre) return undefined
    return classes.find((c) => String(c.type_name).trim() === genre)
  }

  // ---- 侧栏分类 → 实际查询的 type_id 列表 ------------------------------------
  // CMS 的 t 参数只对叶子分类有效:父分类(如「电影」「连续剧」)往往只挂零星
  // 几条数据,直接 t=父id 等于查不到东西。这里把父分类展开成它的叶子分类,
  // 多路并行查询后合并。父子关系优先用 class 的 type_pid 字段,缺失时按名称
  // 启发式归组(动作片/喜剧片…属电影,国产剧/日剧…属剧集)。
  type TypeQuery = { id: string; name: string }

  const findSidebarParent = (cat: string): CmsClass | undefined =>
    classes.find((c) => {
      const n = String(c.type_name).trim()
      if (n === cat) return true
      if (cat === '电影') return /电影|影片|院线/.test(n)
      if (cat === '剧集') return /剧|连续剧|电视剧|美剧|韩剧|日剧|港剧|台剧/.test(n) && !/片$|综艺|动漫|动画|纪录/.test(n)
      if (cat === '动漫') return /动漫|动画|番|漫画/.test(n)
      if (cat === '综艺') return /综艺|真人秀|脱口秀|访谈/.test(n)
      if (cat === '纪录片') return /纪录|纪实/.test(n)
      return false
    })

  const heuristicChildren = (cat: string, parent: CmsClass): CmsClass[] =>
    classes.filter((c) => {
      if (String(c.type_id) === String(parent.type_id)) return false
      const n = String(c.type_name).trim()
      if (cat === '电影') return /片$/.test(n) && !/动漫|纪录/.test(n)
      if (cat === '剧集') return /剧$/.test(n)
      if (cat === '动漫') return /动漫|动画/.test(n)
      if (cat === '综艺') return /综艺|真人秀|脱口秀/.test(n)
      if (cat === '纪录片') return /纪录|纪实/.test(n)
      return false
    })

  // 顶部导航/侧栏展示的大类,来自所选源真实返回的分类:
  // 有 type_pid 层级时取顶层分类;扁平分类表按伞形启发式归到 电影/剧集/动漫/综艺/纪录片。
  // 成人向类目不进导航与类型筛选。
  const BLOCKED_CLASS = /伦理|成人|福利|午夜|里番/i
  const topLevelClasses = (): CmsClass[] => {
    if (!classes.length) return []
    const isTop = (c: CmsClass) =>
      c.type_pid == null || String(c.type_pid) === '' || String(c.type_pid) === '0'
    if (classes.some((c) => c.type_pid != null)) {
      const tops = classes.filter((c) => isTop(c) && !BLOCKED_CLASS.test(String(c.type_name)))
      if (tops.length) return tops
    }
    const out: CmsClass[] = []
    for (const cat of ['电影', '剧集', '动漫', '综艺', '纪录片']) {
      const p = findSidebarParent(cat)
      if (p && !BLOCKED_CLASS.test(String(p.type_name)) && !out.some((o) => String(o.type_id) === String(p.type_id))) out.push(p)
    }
    return out
  }

  function sidebarTypeQueries(category?: string): TypeQuery[] {
    const cat = (category ?? '').trim()
    if (!cat || cat === '推荐' || cat === '首页' || cat === '经典重温') return [{ id: '_', name: '' }]
    const parent = findSidebarParent(cat)
    if (!parent) return [{ id: '_', name: '' }]
    let kids: CmsClass[] = []
    if (classes.some((c) => c.type_pid != null)) {
      kids = classes.filter((c) => String(c.type_pid) === String(parent.type_id))
    }
    if (!kids.length) kids = heuristicChildren(cat, parent)
    // 父分类本身也参与查询:部分站点父分类直接挂内容,重复由 id 去重。
    return [parent, ...kids].map((c) => ({ id: String(c.type_id), name: String(c.type_name).trim() }))
  }

  // 「类型」筛选项(chip)对应的查询列表:
  // 叶子分类 → 精确单路;父分类 → 与侧栏相同的展开逻辑,避免 t=父id 查不到数据。
  function typeQueriesForClass(cls: CmsClass): TypeQuery[] {
    if (classes.some((c) => c.type_pid != null)) {
      const kids = classes.filter((c) => String(c.type_pid) === String(cls.type_id))
      if (kids.length) {
        return [cls, ...kids].map((c) => ({ id: String(c.type_id), name: String(c.type_name).trim() }))
      }
    }
    for (const cat of ['电影', '剧集', '动漫', '综艺', '纪录片']) {
      const p = findSidebarParent(cat)
      if (p && String(p.type_id) === String(cls.type_id)) return sidebarTypeQueries(cat)
    }
    return [{ id: String(cls.type_id), name: String(cls.type_name).trim() }]
  }

  async function loadAll(): Promise<Title[]> {
    if (catalog) return catalog
    if (inflight) return inflight
    inflight = (async () => {
      const s = await ensureSite()
      const merged = new Map<string, Title>()
      const home = handshakeListResponse ?? await fetchJson(apiUrl(s.api, { ac: acList }))
      handshakeListResponse = undefined
      pushList(cmsListData(home), merged)
      notePage(queryKey('_', EMPTY_FILTERS), 1, home)
      // 首页通常只有「最近更新」,再补前 3 个分类的首页,目录更饱满。
      await Promise.all(
        classes.slice(0, 3).map(async (c) => {
          try {
            const j = await fetchJson(apiUrl(s.api, { ac: acList, t: c.type_id, pg: 1 }), 8000)
            pushList(cmsListData(j), merged)
            notePage(queryKey(String(c.type_id), EMPTY_FILTERS), 1, j)
          } catch {
            /* 单个分类失败不影响整体 */
          }
        }),
      )
      catalog = [...merged.values()]
      // 列表接口常不带 vod_pic:后台分批拉详情补海报(顺带预热详情缓存)。
      // 不 await —— 目录先渲染,图片渐进出现。
      const gen = ++enrichGen
      void enrichPosters(catalog, gen)
      return catalog
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  // 拉取指定分类的下一页。侧栏父分类已展开为多个叶子 typeId,并行查询后
  // round-robin 合并(各分类交错出现);每个 typeId 各自维护分页游标,
  // 任一未到底则 hasMore。返回本轮 items,视图直接展示接口结果。
  async function doLoadMore(
    category: string | undefined,
    filters: BrowseFilters,
  ): Promise<{ added: number; hasMore: boolean; items: Title[] }> {
    // 有筛选条件时跳过 loadAll（避免加载无过滤的全量数据污染目录）。
    const hasActiveFilters = !!(filterValue(filters.genre) || filterValue(filters.region) ||
      (filters.year && filters.year !== '全部' && filters.year !== '更早') || sortBy(filters.sort))
    if (hasActiveFilters) await ensureSite()
    else await loadAll()
    const s = await ensureSite()

    const genreCls = classByGenre(filters)
    const typeQueries: TypeQuery[] = genreCls
      ? typeQueriesForClass(genreCls)
      : sidebarTypeQueries(category)
    const key = queryKey(genreCls ? `t${genreCls.type_id}` : `c:${category ?? '_'}`, filters)
    let state = queryStates.get(key)
    if (!state) {
      state = new Map()
      queryStates.set(key, state)
    }
    const bucket = state
    const active = typeQueries.filter((q) => {
      let st = bucket.get(q.id)
      if (!st) {
        st = { next: 1, done: false }
        bucket.set(q.id, st)
      }
      return !st.done
    })
    if (!active.length) return { added: 0, hasMore: false, items: [] }

    const area = filterValue(filters.region)
    const year = filters.year && filters.year !== '全部' && filters.year !== '更早' ? filters.year.trim() : ''
    const by = sortBy(filters.sort)

    const results = await Promise.all(
      active.map(async (q) => {
        const st = bucket.get(q.id)!
        const params: Record<string, string | number> = { ac: acList, pg: st.next }
        if (q.id !== '_') params.t = q.id
        if (area) params.area = area
        if (year) params.year = year
        if (by) {
          params.by = by
          params.order = 'desc'
        }
        try {
          const j = await fetchJson(apiUrl(s.api, params), 10000)
          const list = cmsListData(j) ?? []
          const pagecount = Number(j?.pagecount)
          const cur = st.next
          st.next += 1
          if (!list.length || (Number.isFinite(pagecount) && pagecount > 0 && cur >= pagecount)) st.done = true
          return list
        } catch {
          st.done = true // 单路失败标记到底,避免反复打挂掉的分支
          return []
        }
      }),
    )

    const queues = results.map((list) => [...list])
    const seen = new Set<string>()
    const catalogIds = new Set((catalog ?? []).map((t) => t.id))
    const items: Title[] = []
    let added = 0
    const genreLabel = genreCls ? String(genreCls.type_name).trim() : ''
    for (;;) {
      let progressed = false
      for (const queue of queues) {
        const v = queue.shift()
        if (v == null) continue
        progressed = true
        const t = mapVod(v)
        if (!t || seen.has(t.id)) continue
        seen.add(t.id)
        // 列表接口常缺 type_name,补上查询分类,让详情/筛选能看到来源分类。
        if (genreLabel && !t.genres.includes(genreLabel)) {
          t.genres = [genreLabel, ...t.genres.filter((g) => g !== '其他')]
        }
        items.push(t)
        if (!catalogIds.has(t.id)) {
          catalogIds.add(t.id)
          catalog = catalog ?? []
          catalog.push(t)
          added++
        } else {
          const existing = catalog!.find((x) => x.id === t.id)
          if (existing) Object.assign(existing, { poster: existing.poster || t.poster, backdrop: existing.backdrop || t.backdrop })
        }
      }
      if (!progressed) break
    }

    if (items.length) {
      const gen = ++enrichGen
      void enrichPosters(items, gen)
      notify()
    }
    const hasMore = typeQueries.some((q) => !bucket.get(q.id)?.done)
    return { added, hasMore, items }
  }

  function loadMore(
    category?: string,
    filters: BrowseFilters = EMPTY_FILTERS,
  ): Promise<{ added: number; hasMore: boolean; items: Title[] }> {
    const p = moreChain.then(() => doLoadMore(category, filters))
    moreChain = p.catch(() => {})
    return p
  }

  // CMS 关键词搜索:ac=list&wd=。结果合并进目录,方便详情/播放复用。
  async function search(query: string): Promise<Title[]> {
    const q = query.trim()
    if (!q) return []
    const s = await ensureSite()
    // 部分 CMS 用 ac=list + wd;也有用 ac=vod_list。两种都试。
    let j: any = null
    for (const ac of [acList, 'videolist', 'vod_list', 'list']) {
      try {
        j = await fetchJson(apiUrl(s.api, { ac, wd: q, pg: 1 }), 10000)
        if (cmsListData(j)) break
      } catch {
        j = null
      }
    }
    const found = cmsListData(j)
    if (!found) return []
    const out: Title[] = []
    const seen = new Set<string>()
    for (const v of found) {
      const t = mapVod(v)
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
      if (catalog) {
        const existing = catalog.find((x) => x.id === t.id)
        if (existing) Object.assign(existing, { poster: existing.poster || t.poster, backdrop: existing.backdrop || t.backdrop })
        else catalog.push(t)
      }
    }
    if (out.length) {
      const gen = ++enrichGen
      void enrichPosters(out, gen)
      notify()
    }
    return out
  }

  // 海报补齐:6 路并发,逐部拉详情取 vod_pic,每补上一部就通知视图刷新。
  async function enrichPosters(titles: Title[], gen: number) {
    const queue = titles.filter((t) => !t.poster).slice(0, 36)
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length && gen === enrichGen) {
        const t = queue.shift()!
        try {
          const d = await ensureDetail(t.id)
          if (gen !== enrichGen) return
          // 注意:fetchDetail 已经 Object.assign 把海报写回目录项,
          // 这里不能再拿「与目录项不同」当条件 —— 详情有图就通知刷新。
          if (d?.poster) notify()
        } catch {
          /* 单部失败忽略 */
        }
      }
    })
    await Promise.all(workers)
  }

  // 详情接口带播放地址:补齐集数 / 简介,并把播放线路分组缓存起来。
  // inflight 去重:Player 同帧的 loadDetail + loadPlaySources 只发一次请求。
  function ensureDetail(id: string): Promise<Title | undefined> {
    const hit = details.get(id)
    if (hit) return Promise.resolve(hit)
    const pending = detailInflight.get(id)
    if (pending) return pending
    const p = fetchDetail(id).finally(() => detailInflight.delete(id))
    detailInflight.set(id, p)
    return p
  }

  async function fetchDetail(id: string): Promise<Title | undefined> {
    const base = catalog?.find((t) => t.id === id)
    try {
      const s = await ensureSite()
      // 注意:详情固定用 ac=detail —— 部分 CMS 在 ac=vod_detail 下不返回 vod_play_url。
      const j = await fetchJson(apiUrl(s.api, { ac: 'detail', ids: id.replace(/^v/, '') }))
      const v = cmsListData(j)?.[0]
      if (!v) return base
      const mapped = mapVod(v) ?? base
      if (!mapped) return undefined
      const { from, groups } = parseCmsPlayGroups(v.vod_play_url, v.vod_play_from)
      const count = Math.max(1, ...groups.map((g) => g.length))
      const t: Title = {
        ...mapped,
        episodes: count,
        airedEpisodes: count,
        latest: mapped.latest !== '正片' ? mapped.latest : count > 1 ? `全 ${count} 集` : '正片',
      }
      details.set(id, t)
      playGroups.set(id, { from, groups })
      // 就地更新目录缓存,Player / Detail 经 catalog.byId 也能看到完整集数。
      if (catalog) {
        const existing = catalog.find((x) => x.id === id)
        if (existing) Object.assign(existing, t)
        else catalog.push(t)
      }
      return t
    } catch {
      return base
    }
  }

  return {
    id: `tvbox-${line.url}`,
    name: line.name || 'TVBox 线路',
    badge: 'TVBox',
    tagline: '多线路订阅 · 自动选择可用站点',
    online: true,
    // 导航类别跟随所选源真实返回的分类;握手完成前回退到默认 NAV。
    get nav() {
      const tops = topLevelClasses()
      if (!tops.length) return NAV
      const names = [...new Set(tops.map((c) => String(c.type_name).trim()).filter(Boolean))]
      return names.length ? ['首页', ...names, '我的片单'] : NAV
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    get filters() {
      const base = catalog && catalog.length
        ? deriveFilters(catalog)
        : { genres: ['全部'], regions: ['全部'], years: ['全部'] }
      // 分类接口比目录先拿到,把 class 名并入类型筛选项,条件查询才有完整选项。
      if (!classes.length) return base
      const genres = [
        ...new Set(
          [...base.genres, ...classes.map((c) => String(c.type_name).trim())].filter(
            (g) => g && !BLOCKED_CLASS.test(g),
          ),
        ),
      ]
      return { ...base, genres }
    },
    loadCatalog: loadAll,
    search,
    loadMore,
    genresForCategory(category: string) {
      if (!classes.length) return undefined
      const cat = (category ?? '').trim()
      if (!cat || cat === '推荐' || cat === '首页' || cat === '经典重温') return undefined
      const parent = findSidebarParent(cat)
      if (!parent) return undefined
      // 类型行只列子类型;父分类本身等于当前大类,不重复占位。
      const childNames = sidebarTypeQueries(cat).slice(1).map((q) => q.name)
      return childNames.length ? childNames : [String(parent.type_name).trim()]
    },
    async loadHero() {
      return (await loadAll())[0]
    },
    async loadRanking() {
      return deriveRanking(await loadAll())
    },
    async loadHistory() {
      return []
    },
    loadDetail: ensureDetail,
    async loadRatingTrend(id) {
      const t = await ensureDetail(id)
      return t ? deriveTrend(t) : []
    },
    async loadPlayUrl(id, ep) {
      const list = await this.loadPlaySources(id, ep)
      return list[0]?.url ?? DEFAULT_SAMPLE
    },
    async loadPlaySources(id, ep) {
      await ensureDetail(id)
      const pg = playGroups.get(id)
      if (!pg || !pg.groups.length) return [{ label: '标清', url: DEFAULT_SAMPLE }]
      return pg.groups.map((g, gi) => {
        const item = g[Math.min(Math.max(ep - 1, 0), g.length - 1)]
        const from = pg.from[gi]
        return { label: from || `线路 ${gi + 1}`, url: wrapPlayUrl(normalizePlayUrl(item.url)) }
      })
    },
  }
}
