import { useEffect, useState } from 'react'
import { makeCustomSource, type CustomSourceConfig, type VideoSource } from './data'
import { makeLegacyApiSource } from './legacyApiSource'
import { makeTvboxLineSource } from './tvbox'

// 用户手动配置的片源 —— 持久化到 localStorage,并在同 / 跨标签页间同步。
const KEY = 'nebulaplay:sources:v1'
const EVT = 'nebulaplay:sources-change'

function read(): CustomSourceConfig[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as CustomSourceConfig[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: CustomSourceConfig[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式 / 配额已满时静默降级 */
  }
  window.dispatchEvent(new Event(EVT))
}

// 生成一个稳定且不与内置源冲突的 id。
function makeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// 新增 / 更新一条配置(有 id 则更新,无 id 则新增)。返回最终 id。
export function saveCustomSource(cfg: Omit<CustomSourceConfig, 'id'> & { id?: string }): string {
  const list = read()
  const id = cfg.id ?? makeId()
  const next: CustomSourceConfig = { ...cfg, id }
  const idx = list.findIndex((s) => s.id === id)
  if (idx >= 0) list[idx] = next
  else list.push(next)
  write(list)
  return id
}

export function removeCustomSource(id: string) {
  write(read().filter((s) => s.id !== id))
}

// 订阅自定义片源配置的变化。
export function useCustomSourceConfigs() {
  const [list, setList] = useState<CustomSourceConfig[]>(() => read())
  useEffect(() => {
    const sync = () => setList(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return list
}

// 把配置构建成 VideoSource 实例。用 id+签名 做缓存,避免每次渲染都重建
// (重建会让 useCatalog 的依赖变化而反复拉取)。
const cache = new Map<string, { sig: string; source: VideoSource }>()

export function buildCustomSources(configs: CustomSourceConfig[]): VideoSource[] {
  return configs.map((cfg) => {
    const sig = JSON.stringify(cfg)
    const hit = cache.get(cfg.id)
    if (hit && hit.sig === sig) return hit.source
    // TVBox 线路交给专用适配器(两级配置 + CMS 接口探测),其余走通用自定义源。
    const source = (cfg.kind === 'tvbox' || cfg.kind === 'cms') && cfg.catalogUrl
      ? makeTvboxLineSource({ name: cfg.name, url: cfg.catalogUrl })
      : cfg.kind === 'cms-api' && cfg.catalogUrl
        ? makeLegacyApiSource(cfg)
        : makeCustomSource(cfg)
    cache.set(cfg.id, { sig, source })
    return source
  })
}
