import { describe, expect, it } from 'vitest'
import {
  applyProbeResult,
  PROBE_TTL_MS,
  probeSourceLines,
  selectProbeBatch,
  shouldProbe,
  type SourceLine,
} from './sourceHealth'

describe('片源探活调度', () => {
  it('快源完成后立即发布，不等慢源收口', async () => {
    const lines: SourceLine[] = [
      { name: '慢源', url: 'https://slow.test/api' },
      { name: '快源', url: 'https://fast.test/api' },
    ]
    let releaseSlow!: (alive: boolean) => void
    const slowResult = new Promise<boolean>((resolve) => {
      releaseSlow = resolve
    })
    let markFastSeen!: () => void
    const fastSeen = new Promise<void>((resolve) => {
      markFastSeen = resolve
    })
    const published: string[] = []

    const pending = probeSourceLines(lines, {
      concurrency: 2,
      probe: (line) =>
        line.name === '慢源' ? slowResult : Promise.resolve(true),
      onResult: (line, alive) => {
        published.push(`${line.name}:${alive}`)
        if (line.name === '快源') markFastSeen()
      },
    })

    await fastSeen
    expect(published).toEqual(['快源:true'])

    releaseSlow(false)
    const result = await pending
    expect(result.live).toEqual(new Set(['https://fast.test/api']))
    expect(result.dead).toEqual(new Set(['https://slow.test/api']))
  })
})

describe('探活节流', () => {
  const now = 1_700_000_000_000

  it('TTL 内跳过整轮探活，首次运行和过期才探', () => {
    expect(shouldProbe(0, now)).toBe(true)
    expect(shouldProbe(Number.NaN, now)).toBe(true)
    expect(shouldProbe(now - PROBE_TTL_MS + 1, now)).toBe(false)
    expect(shouldProbe(now - PROBE_TTL_MS, now)).toBe(true)
    // 本地时钟被改到过去时，宁可重探也不要永久跳过。
    expect(shouldProbe(now + 60_000, now)).toBe(true)
  })

  it('游标环形推进，多轮之后覆盖全部线路', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    const first = selectProbeBatch(lines, 0, 2)
    expect(first).toEqual({ batch: ['a', 'b'], nextCursor: 2 })
    const second = selectProbeBatch(lines, first.nextCursor, 2)
    expect(second).toEqual({ batch: ['c', 'd'], nextCursor: 4 })
    // 末尾折回开头，不会漏掉尾巴上的线路。
    expect(selectProbeBatch(lines, second.nextCursor, 2)).toEqual({
      batch: ['e', 'a'],
      nextCursor: 1,
    })
    expect(selectProbeBatch(lines, 0, 99)).toEqual({
      batch: lines,
      nextCursor: 0,
    })
    expect(selectProbeBatch(lines, -3, 1)).toEqual({
      batch: ['c'],
      nextCursor: 3,
    })
    expect(selectProbeBatch([], 3, 2)).toEqual({ batch: [], nextCursor: 0 })
  })

  it('分批结果只覆盖本轮探过的线路，其余保留既有结论', () => {
    const dead = new Set(['x', 'y'])
    const next = applyProbeResult(dead, new Set(['z']), new Set(['x']))
    expect(next).toEqual(new Set(['y', 'z']))
    expect(dead).toEqual(new Set(['x', 'y']))
  })
})
