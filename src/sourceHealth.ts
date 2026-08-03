import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cmsListData } from './cmsProfile'
import { fetchDecoded } from './decoder'
import { viaProxy } from './tvbox'

const DEAD_KEY = 'nebulaplay:dead-sources:v1'
const LIVE_KEY = 'nebulaplay:live-sources:v1'
const TIMEOUT_MS = 8000 // 采集站普遍慢,5s 容易把活源误判成死源
const CONCURRENCY = 4
const START_DELAY_MS = 3000 // 页面渲染完成后再启动探活

export type SourceLine = { name: string; url: string }

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

  const liveLines = useMemo(
    () => lines.filter((l) => !deadUrls.has(l.url)),
    [lines, deadUrls],
  )
  const verifiedLiveLines = useMemo(
    () => lines.filter((line) => verifiedLiveUrls.has(line.url) && !deadUrls.has(line.url)),
    [lines, verifiedLiveUrls, deadUrls],
  )

  const doProbe = useCallback(async () => {
    if (probeRef.current) return
    const p = (async () => {
      try {
        const result = await probeSourceLines(lines, {
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
        if (!mountedRef.current) return
        setDeadUrls(result.dead)
        setVerifiedLiveUrls(result.live)
        writeUrls(DEAD_KEY, result.dead)
        writeUrls(LIVE_KEY, result.live)
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

    // 延迟启动后台探活，避免影响首屏渲染。
    timerRef.current = setTimeout(() => {
      doProbe()
    }, START_DELAY_MS)

    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [lines, doProbe])

  return {
    liveLines,
    verifiedLiveLines,
    deadCount: deadUrls.size,
    reprobe: doProbe,
  }
}
