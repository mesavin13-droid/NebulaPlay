import { fetchDecoded } from './decoder'

type ApiSite = {
  api: string
  name?: string
  detail?: string
}

type ProxyAuth = {
  addAuthToProxyUrl(url: string): Promise<string> | string
}

declare global {
  interface Window {
    ProxyAuth?: ProxyAuth
    NEBULA_API_SITES?: Record<string, ApiSite>
  }
}

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || '/__tvbox?u='
const M3U8_PATTERN = /https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*/g

type FetchImpl = typeof window.fetch

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '请求处理失败'
}

function cmsUrl(api: string, params: Record<string, string>): string {
  const url = new URL(api)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.href
}

async function proxiedUrl(target: string): Promise<string> {
  const value = `${PROXY_BASE}${encodeURIComponent(target)}`
  return window.ProxyAuth?.addAuthToProxyUrl
    ? await window.ProxyAuth.addAuthToProxyUrl(value)
    : value
}

async function fetchTarget(fetchImpl: FetchImpl, target: string, asText = false): Promise<any> {
  const doc = await fetchDecoded(await proxiedUrl(target), {
    timeoutMs: 10_000,
    fetchImpl,
    init: { headers: { accept: asText ? 'text/html,*/*' : 'application/json, application/xml, text/xml, */*' } },
  })
  return asText ? doc.raw : doc.data
}

function resolveSite(url: URL): { source: string; site: ApiSite } {
  const source = url.searchParams.get('source') || 'heimuer'
  const customApi = url.searchParams.get('customApi') || ''
  if (source === 'custom') {
    if (!customApi) throw new Error('使用自定义API时必须提供API地址')
    if (!/^https?:\/\//.test(customApi)) throw new Error('无效的自定义API地址')
    return { source, site: { api: customApi, name: '自定义源' } }
  }
  const site = window.NEBULA_API_SITES?.[source]
  if (!site?.api) throw new Error('无效的API来源')
  return { source, site }
}

async function searchCms(fetchImpl: FetchImpl, api: string, query: string): Promise<any[]> {
  let lastError: unknown
  for (const ac of ['detail', 'list', 'vod_list']) {
    try {
      const data = await fetchTarget(fetchImpl, cmsUrl(api, { ac, wd: query }))
      if (Array.isArray(data?.list)) return data.list
      lastError = new Error('API返回的数据格式无效')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('API返回的数据格式无效')
}

function parseEpisodes(detail: any): string[] {
  const firstGroup = String(detail?.vod_play_url ?? '').split('$$$')[0] ?? ''
  const episodes = firstGroup
    .split('#')
    .map((episode) => {
      const parts = episode.split('$')
      return (parts.length > 1 ? parts[parts.length - 1] : '').trim()
    })
    .filter((value) => /^https?:\/\//.test(value))
  if (episodes.length) return episodes
  return String(detail?.vod_content ?? '').match(M3U8_PATTERN) ?? []
}

function videoInfo(detail: any, source: string, name: string) {
  return {
    title: detail?.vod_name,
    cover: detail?.vod_pic,
    desc: detail?.vod_content,
    type: detail?.type_name,
    year: detail?.vod_year,
    area: detail?.vod_area,
    director: detail?.vod_director,
    actor: detail?.vod_actor,
    remarks: detail?.vod_remarks,
    source_name: name,
    source_code: source,
  }
}

async function htmlDetail(fetchImpl: FetchImpl, base: string, id: string, source: string, name: string) {
  const detailUrl = `${base.replace(/\/$/, '')}/index.php/vod/detail/id/${id}.html`
  const html = String(await fetchTarget(fetchImpl, detailUrl, true))
  const episodes = [...new Set((html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)/g) ?? []).map((item) => item.slice(1).split('(')[0]))]
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() ?? ''
  const desc = html
    .match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .trim() ?? ''
  return {
    code: 200,
    episodes,
    detailUrl,
    videoInfo: { title, desc, source_name: name, source_code: source },
  }
}

export async function handleApiRequest(url: URL, fetchImpl: FetchImpl): Promise<Record<string, unknown>> {
  try {
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('wd')?.trim()
      if (!query) throw new Error('缺少搜索参数')
      const { source, site } = resolveSite(url)
      const list = (await searchCms(fetchImpl, site.api, query)).map((item) => ({
        ...item,
        source_name: site.name || source,
        source_code: source,
        ...(source === 'custom' ? { api_url: site.api } : {}),
      }))
      return { code: 200, list }
    }

    if (url.pathname === '/api/detail') {
      const id = url.searchParams.get('id')?.trim()
      if (!id) throw new Error('缺少视频ID参数')
      if (!/^[\w-]+$/.test(id)) throw new Error('无效的视频ID格式')
      const { source, site } = resolveSite(url)
      const customDetail = url.searchParams.get('customDetail')?.trim()
      const specialBase = source === 'custom'
        ? customDetail || (url.searchParams.get('useDetail') === 'true' ? site.api : '')
        : site.detail || ''
      if (specialBase) {
        return await htmlDetail(fetchImpl, specialBase, id, source, site.name || source)
      }

      const detailUrl = cmsUrl(site.api, { ac: 'detail', ids: id })
      const data = await fetchTarget(fetchImpl, detailUrl)
      const detail = Array.isArray(data?.list) ? data.list[0] : undefined
      if (!detail) throw new Error('获取到的详情内容无效')
      return {
        code: 200,
        episodes: parseEpisodes(detail),
        detailUrl,
        videoInfo: videoInfo(detail, source, site.name || source),
      }
    }

    throw new Error('未知的API路径')
  } catch (error) {
    return { code: 400, msg: messageOf(error), list: [], episodes: [] }
  }
}

let installed = false

export function installApiCompatibility(): void {
  if (installed) return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' || input instanceof URL ? input : input.url
    const url = new URL(raw, window.location.origin)
    if (url.pathname !== '/api/search' && url.pathname !== '/api/detail') {
      return nativeFetch(input, init)
    }
    const body = await handleApiRequest(url, nativeFetch)
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
    })
  }
}
