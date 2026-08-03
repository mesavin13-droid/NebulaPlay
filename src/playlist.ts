import { useEffect, useState } from 'react'

// 本地片单 —— 持久化到 localStorage,与 history 同样的同步机制。
export type PlaylistRecord = {
  sourceId: string
  titleId: string
  name: string
  latest: string
  img: string
  addedAt: number
}

const KEY = 'nebulaplay:playlist:v1'
const EVT = 'nebulaplay:playlist-change'

function read(): PlaylistRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as PlaylistRecord[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: PlaylistRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式 / 配额已满时静默降级 */
  }
  window.dispatchEvent(new Event(EVT))
}

export function inPlaylist(sourceId: string, titleId: string) {
  return read().some((p) => p.sourceId === sourceId && p.titleId === titleId)
}

// 切换加入 / 移出片单,返回切换后是否在片单内。
export function togglePlaylist(entry: Omit<PlaylistRecord, 'addedAt'>) {
  const list = read()
  const exists = list.some((p) => p.sourceId === entry.sourceId && p.titleId === entry.titleId)
  if (exists) {
    write(list.filter((p) => !(p.sourceId === entry.sourceId && p.titleId === entry.titleId)))
    return false
  }
  write([{ ...entry, addedAt: Date.now() }, ...list])
  return true
}

export function usePlaylist(sourceId?: string) {
  const [list, setList] = useState<PlaylistRecord[]>(() => read())

  useEffect(() => {
    const sync = () => setList(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return sourceId ? list.filter((p) => p.sourceId === sourceId) : list
}
