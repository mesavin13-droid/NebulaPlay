import {
  DEFAULT_SAMPLE,
  deriveRanking,
  deriveTrend,
  NAV,
  normalizeTitles,
  type CustomSourceConfig,
  type Title,
  type VideoSource,
} from './data'
import { viaProxy } from './tvbox'

type SearchPayload = { code: number; msg?: string; list?: unknown[] }
type DetailPayload = {
  code: number
  msg?: string
  episodes?: string[]
  videoInfo?: Record<string, unknown>
}

async function request<T extends { code: number; msg?: string }>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`API请求失败: ${response.status}`)
  const body = (await response.json()) as T
  if (body.code !== 200) throw new Error(body.msg || 'API请求失败')
  return body
}

function playUrl(value: string): string {
  return /\.(mp4|webm|m4v|mov)($|[?#])/i.test(value) ? value : viaProxy(value)
}

export function makeLegacyApiSource(cfg: CustomSourceConfig): VideoSource {
  const byId = new Map<string, Title>()
  const episodeUrls = new Map<string, string[]>()
  const listeners = new Set<() => void>()

  const query = (path: string, values: Record<string, string | undefined>) => {
    const params = new URLSearchParams({ source: 'custom', customApi: cfg.catalogUrl || '' })
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
    return `${path}?${params}`
  }

  const remember = (titles: Title[]) => {
    for (const title of titles) byId.set(title.id, title)
    listeners.forEach((listener) => listener())
    return titles
  }

  const loadDetail = async (id: string): Promise<Title | undefined> => {
    const body = await request<DetailPayload>(
      query('/api/detail', {
        id,
        customDetail: cfg.detailUrl,
        useDetail: cfg.detailUrl ? 'true' : undefined,
      }),
    )
    const base = byId.get(id)
    const normalized = normalizeTitles([{ id, ...(body.videoInfo ?? {}) }])[0]
    if (!base && !normalized) return undefined
    const episodes = Array.isArray(body.episodes) ? body.episodes.filter((url) => /^https?:\/\//.test(url)) : []
    const title: Title = {
      ...(base ?? normalized!),
      ...(normalized ?? {}),
      id,
      name: normalized?.name || base?.name || '未命名',
      episodes: Math.max(1, episodes.length),
      airedEpisodes: Math.max(1, episodes.length),
      latest: episodes.length > 1 ? `全 ${episodes.length} 集` : base?.latest || '正片',
    }
    episodeUrls.set(id, episodes)
    remember([title])
    return title
  }

  return {
    id: cfg.id,
    name: cfg.name,
    badge: '兼容 API',
    tagline: cfg.tagline || '无后端 · 兼容 /api/search 与 /api/detail',
    online: true,
    nav: NAV,
    filters: { genres: ['全部'], regions: ['全部'], years: ['全部'] },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async loadCatalog() {
      return [...byId.values()]
    },
    async loadHero() {
      return [...byId.values()][0]
    },
    async loadRanking() {
      return deriveRanking([...byId.values()])
    },
    async loadHistory() {
      return []
    },
    loadDetail,
    async loadRatingTrend(id) {
      const title = byId.get(id) ?? (await loadDetail(id))
      return title ? deriveTrend(title) : []
    },
    async loadPlayUrl(id, episode) {
      return (await this.loadPlaySources(id, episode))[0]?.url ?? DEFAULT_SAMPLE
    },
    async loadPlaySources(id, episode) {
      if (!episodeUrls.has(id)) await loadDetail(id)
      const urls = episodeUrls.get(id) ?? []
      const url = urls[Math.min(Math.max(episode - 1, 0), Math.max(0, urls.length - 1))]
      return [{ label: `第 ${episode} 集`, url: url ? playUrl(url) : DEFAULT_SAMPLE }]
    },
    async search(keyword) {
      const body = await request<SearchPayload>(query('/api/search', { wd: keyword }))
      return remember(normalizeTitles(body.list ?? []))
    },
  }
}
