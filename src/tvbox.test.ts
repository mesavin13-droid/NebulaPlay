import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTvboxLineSource } from './tvbox'

// ---- 假苹果 CMS ------------------------------------------------------------
type Vod = {
  vod_id: number
  vod_name: string
  vod_year: string
  vod_score: string
  vod_remarks: string
  vod_area: string
  type_name: string
}

const classId = (v: Vod) => (v.type_name === '电影' ? '1' : v.type_name === '大陆综艺' ? '2' : '3')
const classes = [
  { type_id: 1, type_name: '电影' },
  { type_id: 2, type_name: '大陆综艺' },
  { type_id: 3, type_name: '战争片' },
]

const titles: Vod[] = []
for (let i = 1; i <= 67; i++) {
  titles.push({
    vod_id: i,
    vod_name: `测试影片${String(i).padStart(3, '0')}`,
    vod_year: String(2020 + (i % 8)),
    vod_score: String((i % 10) + 1),
    vod_remarks: 'HD',
    vod_area: ['中国大陆', '日本', '美国'][i % 3],
    type_name: i <= 30 ? '电影' : i <= 55 ? '大陆综艺' : '战争片',
  })
}

const respond = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response

type FakeResult = { status: number; body: Record<string, unknown> }

function rawFetch(target: URL, ua: string): FakeResult {
  if (target.pathname === '/tvbox.json') {
    return {
      status: 200,
      body: { sites: [{ key: 'fake', name: '假站点', type: 0, api: 'http://fake/cms.php' }] },
    }
  }
  if (target.pathname === '/ua-line.json') {
    return {
      status: 200,
      body: { sites: [{ key: 'gate', name: '门控站点', type: 0, api: 'http://fake/ua-gate.php' }] },
    }
  }
  if (target.pathname === '/ua-gate.php') {
    if (ua.includes('okhttp')) return { status: 502, body: { error: 'UA blocked' } }
    return { status: 200, body: { list: [{ vod_id: 999, vod_name: 'UA重试成功' }] } }
  }
  if (target.pathname !== '/cms.php') return { status: 404, body: {} }

  const pg = Number(target.searchParams.get('pg') || 1)
  const t = target.searchParams.get('t')
  const area = target.searchParams.get('area')
  const year = target.searchParams.get('year')
  const by = target.searchParams.get('by')
  const wd = target.searchParams.get('wd')

  if (target.searchParams.get('ac') === 'detail') {
    const id = Number(target.searchParams.get('ids'))
    const detail = titles.find((v) => v.vod_id === id)
    return { status: 200, body: { code: 1, list: detail ? [detail] : [] } }
  }

  let list = titles
  if (wd) list = list.filter((v) => v.vod_name.includes(wd))
  if (t) list = list.filter((v) => classId(v) === String(t))
  if (area) list = list.filter((v) => v.vod_area === area)
  if (year) list = list.filter((v) => v.vod_year === year)
  if (by === 'time') list = [...list].sort((a, b) => Number(b.vod_year) - Number(a.vod_year))
  if (by === 'score' || by === 'hits') list = [...list].sort((a, b) => Number(b.vod_score) - Number(a.vod_score))

  const body: Record<string, unknown> = {
    code: 1,
    page: String(pg),
    pagecount: '',
    limit: '12',
    total: '',
    list: list.slice((pg - 1) * 12, pg * 12),
  }
  // 真实苹果 CMS 常在基础响应返回 class，videolist 只返回 list。
  if (!target.searchParams.has('ac')) body.class = classes
  return { status: 200, body }
}

const calls: string[] = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const u = new URL(raw, 'http://localhost')
      if (u.pathname !== '/__tvbox') return respond(404, {})
      const target = new URL(u.searchParams.get('u') || '')
      calls.push(`${target.pathname}${target.search}`)
      // 模拟 vite 代理:先 okhttp UA,被 5xx 门控时用浏览器 UA 重试一次。
      let result = rawFetch(target, 'okhttp/3.15')
      if (result.status >= 500 && !/\.(m3u8|ts|mp4|webm|m4v|mov|mkv)($|[?#])/i.test(target.href)) {
        calls.push(`${target.pathname}${target.search}#retry-browser`)
        result = rawFetch(target, 'Mozilla/5.0 Chrome')
      }
      return respond(result.status, result.body)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeTvboxLineSource 集成', () => {
  it('直连 CMS 首次目录合并并发握手并复用成功响应', async () => {
    const src = makeTvboxLineSource({ name: '直连假线路', url: 'http://fake/cms.php' })

    await Promise.all([src.loadCatalog(), src.search!('测试影片001')])

    expect(calls.filter((c) => c === '/cms.php')).toHaveLength(1)
    expect(calls.filter((c) => c === '/cms.php?ac=videolist')).toHaveLength(1)
  })

  it('首次目录复用成功握手响应,并发消费者不重复探测站点', async () => {
    const src = makeTvboxLineSource({ name: '假线路', url: 'http://fake/tvbox.json' })

    await Promise.all([src.loadCatalog(), src.search!('测试影片001')])

    expect(calls.filter((c) => c === '/tvbox.json')).toHaveLength(1)
    expect(calls.filter((c) => c === '/cms.php')).toHaveLength(1)
    expect(calls.filter((c) => c === '/cms.php?ac=videolist')).toHaveLength(1)
  })

  it('目录种子加载,分页不再因首页不满就误判到底', async () => {
    const src = makeTvboxLineSource({ name: '假线路', url: 'http://fake/tvbox.json' })
    const catalog = await src.loadCatalog()
    // 首页 12 + 前三个分类各 12(电影与首页重复)去重后 36 部。
    expect(catalog).toHaveLength(36)

    const r1 = await src.loadMore!('电影')
    expect(r1.added).toBe(0)
    expect(r1.hasMore).toBe(true)
    expect(r1.items).toHaveLength(24)
    expect(new Set(r1.items.map((item) => item.id))).toHaveLength(24)

    const r2 = await src.loadMore!('电影')
    expect(r2.added).toBe(12)
    expect(r2.hasMore).toBe(true)
    expect(r2.items).toHaveLength(12)

    const r3 = await src.loadMore!('电影')
    expect(r3.added).toBe(6)
    expect(r3.hasMore).toBe(true)
    expect(r3.items).toHaveLength(6)

    const r4 = await src.loadMore!('电影')
    expect(r4).toEqual({ added: 0, hasMore: false, items: [] })
  })

  it('条件查询映射为 CMS 的 t/area/year/by 参数', async () => {
    const src = makeTvboxLineSource({ name: '假线路', url: 'http://fake/tvbox.json' })
    await src.loadCatalog()

    await src.loadMore!('电影', { genre: '大陆综艺' })
    expect(calls.some((c) => new URLSearchParams(c.split('?')[1] ?? '').get('t') === '2')).toBe(true)

    await src.loadMore!('推荐', { region: '日本', year: '2024', sort: '最新' })
    const combo = calls
      .map((c) => c.split('?')[1] ?? '')
      .map((q) => new URLSearchParams(q))
      .find((p) => p.get('area') === '日本')
    expect(combo?.get('year')).toBe('2024')
    expect(combo?.get('by')).toBe('time')
    expect(combo?.get('order')).toBe('desc')
  })

  it('UA 门控 502 自动用浏览器 UA 重试', async () => {
    const src = makeTvboxLineSource({ name: '门控线路', url: 'http://fake/ua-line.json' })
    const catalog = await src.loadCatalog()
    expect(catalog.map((t) => t.name)).toContain('UA重试成功')
    expect(calls.some((c) => c.endsWith('#retry-browser'))).toBe(true)
  })
})
