import { describe, expect, it } from 'vitest'
import { deriveHasMore, Paginator } from './pagination'

describe('deriveHasMore', () => {
  it('优先按 pagecount 判断', () => {
    expect(deriveHasMore({ page: 1, pageSize: 20, returned: 20, pagecount: 3 })).toBe(true)
    expect(deriveHasMore({ page: 3, pageSize: 20, returned: 20, pagecount: 3 })).toBe(false)
    expect(deriveHasMore({ page: 2, pageSize: 20, returned: 0, pagecount: 3 })).toBe(true)
  })

  it('没有 pagecount 时按 total 估算', () => {
    expect(deriveHasMore({ page: 1, pageSize: 20, returned: 20, total: 50 })).toBe(true)
    expect(deriveHasMore({ page: 2, pageSize: 20, returned: 20, total: 50 })).toBe(true)
    expect(deriveHasMore({ page: 3, pageSize: 20, returned: 20, total: 50 })).toBe(false)
  })

  it('pagecount=1 但 total 未拉完时退回 total 估算', () => {
    expect(deriveHasMore({ page: 1, pageSize: 12, returned: 12, pagecount: 1, total: 36 })).toBe(true)
    expect(deriveHasMore({ page: 3, pageSize: 12, returned: 12, pagecount: 1, total: 36 })).toBe(false)
  })

  it('都没有时用「本页装满」近似', () => {
    expect(deriveHasMore({ page: 1, pageSize: 20, returned: 20 })).toBe(true)
    expect(deriveHasMore({ page: 1, pageSize: 20, returned: 8 })).toBe(false)
    expect(deriveHasMore({ page: 1, pageSize: 20, returned: 0 })).toBe(false)
  })
})

describe('Paginator', () => {
  it('默认从第 2 页开始', () => {
    const p = new Paginator()
    expect(p.nextPage('a')).toBe(2)
    expect(p.hasMore('a')).toBe(true)
  })

  it('note 后推进游标并记录耗尽状态', () => {
    const p = new Paginator()
    expect(p.note('a', 1, { list: Array.from({ length: 20 }, (_, i) => i), pagecount: 3 })).toBe(true)
    expect(p.nextPage('a')).toBe(2)
    expect(p.hasMore('a')).toBe(true)
    expect(p.note('a', 2, { list: Array.from({ length: 20 }, (_, i) => i), pagecount: 3 })).toBe(true)
    expect(p.note('a', 3, { list: [], pagecount: 3 })).toBe(false)
    expect(p.hasMore('a')).toBe(false)
  })

  it('没有分页元数据时用第一页条数推断每页大小', () => {
    const p = new Paginator()
    expect(p.note('a', 1, { list: Array.from({ length: 12 }, (_, i) => i) })).toBe(true)
    expect(p.note('a', 2, { list: Array.from({ length: 12 }, (_, i) => i) })).toBe(true)
    // 最后一页不满,此时才算到底。
    expect(p.note('a', 3, { list: Array.from({ length: 5 }, (_, i) => i) })).toBe(false)
    expect(p.hasMore('a')).toBe(false)
  })

  it('hasState 区分已播种与全新查询组合', () => {
    const p = new Paginator()
    expect(p.hasState('a')).toBe(false)
    p.note('a', 1, { list: [1, 2] })
    expect(p.hasState('a')).toBe(true)
    expect(p.nextPage('a')).toBe(2)
  })

  it('noteList 接受字符串形式的 pagecount / total', () => {
    const p = new Paginator()
    expect(p.noteList('a', 1, 20, Number('3'))).toBe(true)
    expect(p.noteList('a', 2, 20, Number('3'))).toBe(true)
    expect(p.noteList('a', 3, 20, Number('3'))).toBe(false)
  })

  it('reset 可清空单个 key 或全部', () => {
    const p = new Paginator()
    p.note('a', 1, { list: [], pagecount: 1 })
    p.note('b', 1, { list: [], pagecount: 1 })
    expect(p.hasMore('a')).toBe(false)
    p.reset('a')
    expect(p.hasMore('a')).toBe(true)
    expect(p.nextPage('a')).toBe(2)
    expect(p.hasMore('b')).toBe(false)
    p.reset()
    expect(p.hasMore('b')).toBe(true)
  })
})
