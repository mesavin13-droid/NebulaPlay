import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHistoryRecord, historyEpisode, recordHistory } from './history'
import { resolveResumeSeconds } from './playbackProgress'

const KEY = 'nebulaplay:history:v1'

describe('观看历史与续播', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('保存精确秒数和集数，同一影片只保留最新记录', () => {
    recordHistory({
      sourceId: 'source-a',
      titleId: 'v1',
      name: '测试剧',
      ep: '第 1 集',
      episode: 1,
      progress: 10,
      positionSeconds: 100,
      durationSeconds: 1_000,
      img: 'poster.jpg',
    })
    recordHistory({
      sourceId: 'source-a',
      titleId: 'v1',
      name: '测试剧',
      ep: '第 2 集',
      episode: 2,
      progress: 19.4,
      positionSeconds: 271.5,
      durationSeconds: 1_430,
      img: 'poster.jpg',
    })

    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    expect(stored).toHaveLength(1)
    const record = getHistoryRecord('source-a', 'v1')
    expect(record).toMatchObject({ episode: 2, progress: 19, positionSeconds: 271.5 })
    expect(historyEpisode(record)).toBe(2)
    expect(resolveResumeSeconds(record, 1_430)).toBe(271.5)
  })

  it('兼容只有百分比和集数文本的 v1 旧记录', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          sourceId: 'source-a',
          titleId: 'v2',
          name: '旧记录',
          ep: '第 3 集',
          progress: 19,
          img: 'poster.jpg',
          updatedAt: 1,
        },
      ]),
    )

    const record = getHistoryRecord('source-a', 'v2')
    expect(historyEpisode(record)).toBe(3)
    expect(resolveResumeSeconds(record, 1_000)).toBe(190)
  })

  it('忽略过短或接近片尾的记录', () => {
    expect(resolveResumeSeconds({ positionSeconds: 4, progress: 1 }, 1_000)).toBe(0)
    expect(resolveResumeSeconds({ positionSeconds: 960, progress: 96 }, 1_000)).toBe(0)
    expect(resolveResumeSeconds({ positionSeconds: 995, progress: 94 }, 1_000)).toBe(0)
  })
})
