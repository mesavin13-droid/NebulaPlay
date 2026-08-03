import { describe, expect, it } from 'vitest'
import { probeSourceLines, type SourceLine } from './sourceHealth'

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
