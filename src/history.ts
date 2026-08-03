import { useEffect, useState } from 'react'

// 本地观看历史 —— 持久化到 localStorage,同标签页内通过自定义事件即时同步。
export type HistoryRecord = {
  sourceId: string
  titleId: string
  name: string
  ep: string
  episode?: number
  progress: number // 0–100
  positionSeconds?: number
  durationSeconds?: number
  img: string
  updatedAt: number
}

const KEY = 'nebulaplay:history:v1'
const MAX = 24
const EVT = 'nebulaplay:history-change'

function read(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as HistoryRecord[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: HistoryRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式 / 配额已满时静默降级 */
  }
  window.dispatchEvent(new Event(EVT))
}

// 记录 / 更新一条历史(按 sourceId+titleId 去重,置顶并限制条数)。
export function recordHistory(entry: Omit<HistoryRecord, 'updatedAt'>) {
  const list = read().filter((h) => !(h.sourceId === entry.sourceId && h.titleId === entry.titleId))
  list.unshift({
    ...entry,
    episode:
      Number.isFinite(entry.episode) && (entry.episode ?? 0) > 0
        ? Math.floor(entry.episode as number)
        : undefined,
    progress: Math.min(100, Math.max(0, Math.round(entry.progress))),
    positionSeconds:
      Number.isFinite(entry.positionSeconds) && (entry.positionSeconds ?? 0) >= 0
        ? entry.positionSeconds
        : undefined,
    durationSeconds:
      Number.isFinite(entry.durationSeconds) && (entry.durationSeconds ?? 0) > 0
        ? entry.durationSeconds
        : undefined,
    updatedAt: Date.now(),
  })
  write(list.slice(0, MAX))
}

export function getHistoryRecord(sourceId: string, titleId: string) {
  return read().find((h) => h.sourceId === sourceId && h.titleId === titleId)
}

// v1 旧记录没有 episode 数字字段，从展示文本兼容迁移。
export function historyEpisode(record: HistoryRecord | undefined): number {
  if (Number.isFinite(record?.episode) && (record?.episode ?? 0) > 0)
    return Math.floor(record!.episode as number)
  const matched = record?.ep.match(/第\s*(\d+)\s*集/)
  return matched ? Math.max(1, Number(matched[1])) : 1
}

export function removeHistory(sourceId: string, titleId: string) {
  write(read().filter((h) => !(h.sourceId === sourceId && h.titleId === titleId)))
}

export function clearHistory() {
  write([])
}

// 订阅历史变化(本标签页自定义事件 + 跨标签页 storage 事件)。
export function useHistory(sourceId?: string) {
  const [list, setList] = useState<HistoryRecord[]>(() => read())

  useEffect(() => {
    const sync = () => setList(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return sourceId ? list.filter((h) => h.sourceId === sourceId) : list
}
