import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cmsListData } from './cmsProfile'
import { fetchDecoded } from './decoder'
import { viaProxy } from './tvbox'

const DEAD_KEY = 'nebulaplay:dead-sources:v1'
const LIVE_KEY = 'nebulaplay:live-sources:v1'
const RUN_KEY = 'nebulaplay:source-health-run:v1'
const TIMEOUT_MS = 8000 // 采集站普遍慢,5s 容易把活源误判成死源
const CONCURRENCY = 4
const START_DELAY_MS = 3000 // 页面渲染完成后再启动探活

// 探活结论的有效期。此前每次打开页面都会把内置线路整轮重探一遍,单次最多
// 上百个请求,既拖慢自己也在反复打第三方接口。TTL 内直接复用上轮结论。
export const PROBE_TTL_MS = 6 * 60 * 60 * 1000
// 单轮最多探多少条。配合游标轮转,多次访问后仍能覆盖全部线路,但任何一次
// 页面加载的后台开销都是有界的。
export const MAX_LINES_PER_RUN = 16

export type SourceLine = { name: string; url: string }
type ProbeRun = { at: number; cursor: number }

export function shouldProbe(
  lastRunAt: number,
  now: number,
  ttlMs: number = PROBE_TTL_MS,
): boolean {
  if (!Number.isFinite(lastRunAt) || lastRunAt <= 0) return true
  // 时钟回拨或本地时间被改时,宁可重探一次也不要永久跳过。
  if (lastRunAt > now) return true
  return now - lastRunAt >= ttlMs
}

// 从 cursor 开始环形取一批,返回下一轮的起点。
export function selectProbeBatch<T>(
  lines: T[],
  cursor: number,
  size: number,
): { batch: T[]; nextCursor: number } {
  if (!lines.length || size <= 0) return { batch: [], nextCursor: 0 }
  const take = Math.min(size, lines.length)
  const start = ((Math.trunc(cursor) % lines.length) + lines.length) % lines.length
  const batch = Array.from(
    { length: take },
    (_, index) => lines[(start + index) % lines.length],
  )
  return { batch, nextCursor: (start + take) % lines.length }
}

// 只覆盖本轮真正探过的线路,未探到的沿用既有结论 —— 分批探活的前提。
export function applyProbeResult(
  current: Set<string>,
  add: Set<string>,
  remove: Set<string>,
): Set<string> {
  const next = new Set(current)
  for (const url of add) next.add(url)
  for (const url of remove) next.delete(url)
  return next
}

function readUrls(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeUrls(key: string, urls: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...urls]))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

function readRun(): ProbeRun {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    if (!raw) return { at: 0, cursor: 0 }
    const parsed = JSON.parse(raw) as Partial<ProbeRun> | null
    const at = Number(parsed?.at)
    const cursor = Number(parsed?.cursor)
    return {
      at: Number.isFinite(at) && at > 0 ? at : 0,
      cursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    }
  } catch {
    return { at: 0, cursor: 0 }
  }
}

function writeRun(run: ProbeRun) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

async function probeOne(line: SourceLine): Promise<boolean> {
  // 两轮探测:第一轮失败只是抖动(采集站常见),复测仍败才判失活。
  for (let round = 0; round < 2; round++) {
    for (const ac of ['videolist', 'vod_list']) {
      try {
        const sep = line.url.includes('?') ? '&' : '?'
        const apiUrl = `${line.url}${sep}ac=${ac}`
        const doc = await fetchDecoded(viaProxy(apiUrl), {
          timeoutMs: TIMEOUT_MS,
          init: { signal: AbortSignal.timeout(TIMEOUT_MS) },
        })
        if (cmsListData(doc.data)) return true
      } catch {
        /* 单个 action 失败继续尝试下一个 */
      }
    }
  }
  return false
}

export async function probeSourceLines(
  lines: SourceLine[],
  options: {
    concurrency?: number
    onResult?: (line: SourceLine, alive: boolean) => void
    probe?: (line: SourceLine) => Promise<boolean>
  } = {},
): Promise<{ dead: Set<string>; live: Set<string> }> {
  const dead = new Set<string>()
  const live = new Set<string>()
  const queue = [...lines]
  const probe = options.probe ?? probeOne
  const worker = async () => {
    while (queue.length) {
      const line = queue.shift()!
      const alive = await probe(line)
      if (alive) live.add(line.url)
      else dead.add(line.url)
      options.onResult?.(line, alive)
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency ?? CONCURRENCY, lines.length) },
      () => worker(),
    ),
  )
  return { dead, live }
}

export function useSourceHealth(lines: SourceLine[]) {
  const [deadUrls, setDeadUrls] = useState<Set<string>>(() => readUrls(DEAD_KEY))
  const [verifiedLiveUrls, setVerifiedLiveUrls] = useState<Set<string>>(() =>
    readUrls(LIVE_KEY),
  )
  const probeRef = useRef<Promise<void> | null>(null)
  const linesSig = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // 分批探活要在"本轮开始前的结论"上做增量,不能读探活途中被 onResult 改过的
  // state,也不能进 useCallback 的依赖(否则每出一个结果就重建一次 doProbe)。
  const deadRef = useRef(deadUrls)
  const liveRef = useRef(verifiedLiveUrls)
  useEffect(() => {
    deadRef.current = deadUrls
    liveRef.current = verifiedLiveUrls
  }, [deadUrls, verifiedLiveUrls])

  const liveLines = useMemo(
    () => lines.filter((l) => !deadUrls.has(l.url)),
    [lines, deadUrls],
  )
  const verifiedLiveLines = useMemo(
    () => lines.filter((line) => verifiedLiveUrls.has(line.url) && !deadUrls.has(line.url)),
    [lines, verifiedLiveUrls, deadUrls],
  )

  const doProbe = useCallback(async (options: { force?: boolean } = {}) => {
    if (probeRef.current) return
    const p = (async () => {
      try {
        const run = readRun()
        // force 是用户主动重探,绕过 TTL 与分批,一次覆盖全部线路。
        const { batch, nextCursor } = options.force
          ? { batch: lines, nextCursor: 0 }
          : selectProbeBatch(lines, run.cursor, MAX_LINES_PER_RUN)
        if (!batch.length) return
        const baseDead = deadRef.current
        const baseLive = liveRef.current
        const result = await probeSourceLines(batch, {
          onResult: (line, alive) => {
            if (!mountedRef.current) return
            if (alive) {
              setVerifiedLiveUrls((current) => new Set(current).add(line.url))
              setDeadUrls((current) => {
                if (!current.has(line.url)) return current
                const next = new Set(current)
                next.delete(line.url)
                return next
              })
            } else {
              setDeadUrls((current) => new Set(current).add(line.url))
              setVerifiedLiveUrls((current) => {
                if (!current.has(line.url)) return current
                const next = new Set(current)
                next.delete(line.url)
                return next
              })
            }
          },
        })
        // 落盘用合并而非覆盖:本轮只探了一批,直接写 result 会把没探到的
        // 线路的既有结论全部抹掉,下次打开页面又要从零判断。
        const nextDead = applyProbeResult(baseDead, result.dead, result.live)
        const nextLive = applyProbeResult(baseLive, result.live, result.dead)
        writeUrls(DEAD_KEY, nextDead)
        writeUrls(LIVE_KEY, nextLive)
        writeRun({ at: Date.now(), cursor: nextCursor })
        if (!mountedRef.current) return
        setDeadUrls(nextDead)
        setVerifiedLiveUrls(nextLive)
      } finally {
        probeRef.current = null
      }
    })()
    probeRef.current = p
    await p
  }, [lines])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const sig = lines.map((l) => l.url).join('|')
    if (linesSig.current === sig) return
    linesSig.current = sig

    // 先从 localStorage 恢复缓存，立即过滤失活源。
    const cachedDead = readUrls(DEAD_KEY)
    const cachedLive = readUrls(LIVE_KEY)
    const knownUrls = new Set(lines.map((l) => l.url))
    const relevantDead = new Set([...cachedDead].filter((url) => knownUrls.has(url)))
    const relevantLive = new Set(
      [...cachedLive].filter((url) => knownUrls.has(url) && !relevantDead.has(url)),
    )
    setDeadUrls(relevantDead)
    setVerifiedLiveUrls(relevantLive)
    deadRef.current = relevantDead
    liveRef.current = relevantLive

    // TTL 内不重复探活:上轮结论仍然有效,省掉每次打开页面的整轮后台请求。
    if (!shouldProbe(readRun().at, Date.now())) return

    // 延迟启动后台探活，避免影响首屏渲染。
    timerRef.current = setTimeout(() => {
      void doProbe()
    }, START_DELAY_MS)

    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [lines, doProbe])

  return {
    liveLines,
    verifiedLiveLines,
    deadCount: deadUrls.size,
    reprobe: () => doProbe({ force: true }),
  }
}
