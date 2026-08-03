import { useEffect, useState } from 'react'
import type { HistoryItem, RankItem, Title, VideoSource } from './data'

const CACHE_PREFIX = 'nebulaplay:catalog-cache:v1:'
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CATALOG_TIMEOUT_MS = 20_000

export type Catalog = {
  titles: Title[]
  hero?: Title // 自定义 / 空片源可能没有可用的头图
  ranking: RankItem[]
  history: HistoryItem[]
  byId: (id: string) => Title | undefined
}

type CatalogCache = Omit<Catalog, 'byId'> & { savedAt: number }

function materializeCatalog(data: Omit<Catalog, 'byId'>): Catalog {
  const map = new Map(data.titles.map((title) => [title.id, title]))
  return { ...data, byId: (id) => map.get(id) }
}

function readCatalogCache(sourceId: string): Catalog | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${sourceId}`)
    if (!raw) return null
    const cached = JSON.parse(raw) as CatalogCache
    if (
      !Array.isArray(cached.titles) ||
      !cached.titles.length ||
      !Number.isFinite(cached.savedAt) ||
      Date.now() - cached.savedAt > CACHE_MAX_AGE_MS
    )
      return null
    return materializeCatalog({
      titles: cached.titles,
      hero: cached.hero ?? cached.titles[0],
      ranking: Array.isArray(cached.ranking) ? cached.ranking : [],
      history: Array.isArray(cached.history) ? cached.history : [],
    })
  } catch {
    return null
  }
}

function writeCatalogCache(sourceId: string, catalog: Catalog) {
  if (!catalog.titles.length) return
  try {
    const snapshot: CatalogCache = {
      titles: catalog.titles.slice(0, 300),
      hero: catalog.hero,
      ranking: catalog.ranking,
      history: catalog.history,
      savedAt: Date.now(),
    }
    localStorage.setItem(`${CACHE_PREFIX}${sourceId}`, JSON.stringify(snapshot))
  } catch {
    /* 隐私模式 / 配额已满时仅失去首屏缓存 */
  }
}

async function loadCatalog(source: VideoSource): Promise<Catalog> {
  const [titles, hero, ranking, history] = await Promise.all([
    source.loadCatalog(),
    source.loadHero(),
    source.loadRanking(),
    source.loadHistory(),
  ])
  return materializeCatalog({
    titles,
    hero: hero ?? titles[0],
    ranking,
    history,
  })
}

// 根据当前片源异步加载首屏所需的全部数据,并暴露 loading / error 状态。
// 切换片源时会重新拉取 —— 视图只消费返回的 Catalog,不关心数据来源。
export function useCatalog(source: VideoSource | null) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 片源尚未就绪(探活中)时保持 loading,等真实片源出现再拉目录。
    if (!source) {
      setCatalog(null)
      setLoading(true)
      setError(null)
      return
    }
    let alive = true
    const cached = readCatalogCache(source.id)
    setCatalog(cached)
    setLoading(!cached)
    setError(null)
    let timeout: ReturnType<typeof setTimeout> | null = null
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`片源「${source.name}」目录加载超时`)),
        CATALOG_TIMEOUT_MS,
      )
    })
    Promise.race([loadCatalog(source), deadline])
      .then((next) => {
        if (!alive) return
        setCatalog(next)
        writeCatalogCache(source.id, next)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        // 加载失败(常见于自定义源跨域受限):给出空目录 + 错误提示,而非白屏。
        setError(e instanceof Error ? e.message : '片源加载失败')
        if (!cached)
          setCatalog({ titles: [], hero: undefined, ranking: [], history: [], byId: () => undefined })
        setLoading(false)
      })
      .finally(() => {
        if (timeout != null) clearTimeout(timeout)
      })
    return () => {
      alive = false
      if (timeout != null) clearTimeout(timeout)
    }
  }, [source])

  // 源内数据被后台补齐(如 TVBox 渐进补海报)时,浅拷贝触发一次重渲染。
  useEffect(() => {
    if (!source?.subscribe) return
    let alive = true
    const unsubscribe = source.subscribe(() => {
      loadCatalog(source)
        .then((next) => {
          if (!alive) return
          setCatalog(next)
          writeCatalogCache(source.id, next)
        })
        .catch(() => {
          // 后台增量刷新失败不覆盖当前仍可用的 catalog；下一次事件继续重试。
        })
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [source])

  return { catalog, loading, error }
}
