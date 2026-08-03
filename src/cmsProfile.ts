// ============================================================================
// 苹果 CMS Profile —— 采集接口的类型契约与归一化助手
// ----------------------------------------------------------------------------
// 苹果 CMS 是 TVBox 生态最常见的 JSON 采集站点。这里集中定义它的响应结构
// (list / detail / class / vod_play_url),并提供纯函数把原始记录归一化为站内
// Title。解析器不依赖浏览器代理,由调用方通过 posterUrl 注入图片改写策略。
// ============================================================================

import type { Title } from './data'

export type CmsSite = { key?: string; name?: string; type?: number; api?: string }
export type CmsClass = { type_id: string | number; type_name: string; type_pid?: string | number }

export type CmsVod = {
  vod_id: string | number
  vod_name?: string
  vod_pic?: string
  vod_year?: string | number
  vod_score?: string | number
  vod_remarks?: string
  vod_area?: string
  vod_content?: string
  vod_blurb?: string
  vod_actor?: string
  vod_director?: string
  type_name?: string
  [key: string]: unknown
}

export type CmsEpisode = { label: string; url: string }

export type CmsListResponse = {
  list?: CmsVod[]
  class?: CmsClass[] | { item?: CmsClass[] | CmsClass }
  page?: string | number
  pagecount?: string | number
  total?: string | number
  limit?: string | number
}

// ---- 站点可用性 ------------------------------------------------------------
// 只有苹果 CMS 风格 JSON 接口能在浏览器里工作(type 0/1 + http(s) api)。
export const isBrowserCmsSite = (s: CmsSite): s is CmsSite & { api: string } =>
  typeof s?.api === 'string' && /^https?:\/\//.test(s.api) && (s.type == null || s.type === 0 || s.type === 1)

export const isCmsClass = (c: unknown): c is CmsClass =>
  !!c && typeof c === 'object' && (c as CmsClass).type_id != null && !!((c as CmsClass).type_name ?? '')

// 从 JSON / XML 两种解码结果里提取分类数组(XML 里可能是 class.item 数组)。
export function cmsClassesOf(data: unknown): CmsClass[] {
  const unwrap = (node: unknown): CmsClass[] => {
    if (Array.isArray(node)) return node.filter(isCmsClass)
    if (node && typeof node === 'object') {
      const nested = (node as { item?: unknown }).item
      if (Array.isArray(nested)) return nested.filter(isCmsClass)
      if (nested && typeof nested === 'object') {
        const one = nested as Record<string, unknown>
        if (one.type_id != null && one.type_name != null) return [one as unknown as CmsClass]
      }
    }
    return []
  }
  const d = data as CmsListResponse | Record<string, unknown> | null
  const root = unwrap((d as Record<string, unknown> | null)?.class)
  if (root.length) return root
  const rss = (d as Record<string, unknown> | null)?.rss as Record<string, unknown> | undefined
  if (rss) return unwrap(rss.class)
  return []
}

// 从 JSON 或 XML 解码结果里取 vod 数组(XML 常见 rss.list.item / rss.channel.item)。
export function cmsListData(data: unknown): CmsVod[] | null {
  if (Array.isArray(data)) return data as CmsVod[]
  const d = data as Record<string, unknown> | null
  const asItems = (node: unknown): CmsVod[] | null => {
    if (Array.isArray(node)) return node as CmsVod[]
    const item = (node as Record<string, unknown> | undefined)?.item
    if (Array.isArray(item)) return item as CmsVod[]
    if (item && typeof item === 'object') return [item as CmsVod]
    return null
  }
  // XML 解码后根节点(<rss>/<root>)直接展开成子对象:list 可能直接挂在根上。
  const rootList = asItems(d?.list)
  if (rootList) return rootList
  const rss = d?.rss as Record<string, unknown> | undefined
  if (!rss) return null
  const fromList = asItems(rss.list)
  if (fromList) return fromList
  const fromChannel = asItems(rss.channel)
  if (fromChannel) return fromChannel
  return null
}

// ---- 查询 URL 拼接 -----------------------------------------------------------
export const cmsApiUrl = (api: string, params: Record<string, string | number>) => {
  const sep = api.includes('?') ? '&' : '?'
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${api}${sep}${qs}`
}

// ---- 播放地址分组 ------------------------------------------------------------
// 解析 vod_play_url:"集名$地址#集名$地址",多组播放线路之间用 $$$ 分隔。
export function parseCmsPlayGroups(rawUrl: unknown, rawFrom: unknown): {
  from: string[]
  groups: CmsEpisode[][]
} {
  const from = String(rawFrom ?? '')
    .split('$$$')
    .map((s) => s.trim())
  const groups = String(rawUrl ?? '')
    .split('$$$')
    .map((g) =>
      g
        .split('#')
        .map((seg) => {
          const t = seg.trim()
          const i = t.indexOf('$')
          return i >= 0 ? { label: t.slice(0, i).trim(), url: t.slice(i + 1).trim() } : { label: '正片', url: t }
        })
        .filter((e) => /^https?:\/\//.test(e.url)),
    )
    .filter((g) => g.length > 0)
  return { from, groups }
}

// ---- vod → Title ------------------------------------------------------------
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&\w+;/g, ' ').trim()

const absUrl = (u: unknown): string => {
  const s = String(u ?? '').trim()
  if (s.startsWith('//')) return `https:${s}`
  return s
}

export type CmsVodMappingOptions = {
  // 图片改写策略(TVBox 场景走同源代理绕防盗链)。
  posterUrl?: (u: string) => string
}

// 把一条 vod 记录映射为站内 Title;列表接口没有播放地址,集数在详情接口补齐。
export function mapCmsVod(v: CmsVod, opts: CmsVodMappingOptions = {}): Title | null {
  if (!v || v.vod_id == null) return null
  const posterUrl = opts.posterUrl ?? ((u: string) => u)
  const remarks = String(v.vod_remarks ?? '').trim()
  const typeName = String(v.type_name ?? '').trim()
  const quality = /4k/i.test(remarks) ? '4K' : /蓝光|blu-?ray/i.test(remarks) ? '蓝光' : /1080/i.test(remarks) ? '1080P' : 'HD'
  const year = Number(v.vod_year)
  const score = Number(v.vod_score)
  const pic = absUrl(v.vod_pic)
  const poster = pic ? posterUrl(pic) : ''
  return {
    id: `v${v.vod_id}`,
    name: String(v.vod_name ?? '未命名'),
    poster,
    backdrop: poster,
    year: Number.isFinite(year) && year > 0 ? year : new Date().getFullYear(),
    rating: Number.isFinite(score) && score > 0 ? Math.min(10, score) : 7.5,
    genres: v.type_name ? [String(v.type_name)] : ['其他'],
    region: String(v.vod_area ?? '').trim() || '未知',
    quality,
    episodes: /剧$/.test(typeName) || /动漫/.test(typeName) || typeName === '综艺' || typeName === '连续剧' ? 99 : 1,
    airedEpisodes: /剧$/.test(typeName) || /动漫/.test(typeName) || typeName === '综艺' || typeName === '连续剧' ? 99 : 1,
    latest: remarks || '正片',
    synopsis: stripHtml(String(v.vod_content ?? v.vod_blurb ?? '')) || '暂无简介。',
    cast: String(v.vod_actor ?? '')
      .split(/[,/、\s]+/)
      .filter(Boolean)
      .slice(0, 8),
  }
}
