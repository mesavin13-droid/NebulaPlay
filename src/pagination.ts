// ============================================================================
// 统一分页查询契约
// ----------------------------------------------------------------------------
// 各远程片源的分页参数与响应元数据差异很大,但都可以收敛成同一份契约:
//   请求: pg(page) + limit/pageSize(可选)
//   响应: list + page + pagecount + total + limit
// Paginator 按分类 key 维护「下一页页码 / 是否还有更多」,供 TVBox 等适配器复用,
// 也让后续后端契约(Search / Catalog 分页)沿用同一套判断逻辑。
// ============================================================================

export type PageKey = string

export type PagedQuery = {
  pg?: number
  t?: string | number
  wd?: string
  ids?: string | number
  limit?: number
  pageSize?: number
  [key: string]: unknown
}

export type PagedResponse<T> = {
  list?: T[]
  page?: string | number
  pagecount?: string | number
  total?: string | number
  limit?: string | number
}

export type PageMeta = {
  page: number
  pageSize: number
  returned: number
  pagecount?: number
  total?: number
}

// 从响应元数据推导是否还有下一页:
//   1) 站点给了 pagecount 时,以 page < pagecount 为准;
//   2) 否则给了 total 时,按 page * pageSize < total 估算;
//   3) 都没有时,用「本页是否装满」作为近似。
export function deriveHasMore(
  meta: Pick<PageMeta, 'page' | 'pageSize' | 'returned' | 'pagecount' | 'total'>,
): boolean {
  const { page, pageSize, returned, pagecount, total } = meta
  const pages = Number(pagecount)
  const totalItems = Number(total)
  if (Number.isFinite(pages) && pages > 0) {
    if (pages > 1) return page < pages
    // 部分站点把 pagecount 当「每页条数」而不是总页数:pagecount=1 但 total 未拉完时,
    // 退回 total 估算,避免首页 12 条就被误判为没有更多。
    if (Number.isFinite(totalItems) && totalItems > 0 && totalItems > returned) {
      return page * pageSize < totalItems
    }
    return false
  }
  if (Number.isFinite(totalItems) && totalItems > 0) return page * pageSize < totalItems
  return returned >= pageSize && returned > 0
}

export class Paginator {
  private readonly next = new Map<PageKey, number>()
  private readonly exhausted = new Set<PageKey>()
  // 站点不返回 pagecount/total 时,用第一页实际条数推断每页大小。
  private readonly pageSize = new Map<PageKey, number>()

  constructor(private readonly pageSizeHint = 20) {}

  reset(key?: PageKey) {
    if (key === undefined) {
      this.next.clear()
      this.exhausted.clear()
      this.pageSize.clear()
      return
    }
    this.next.delete(key)
    this.exhausted.delete(key)
    this.pageSize.delete(key)
  }

  nextPage(key: PageKey, fallback = 2): number {
    return this.next.get(key) ?? fallback
  }

  hasState(key: PageKey): boolean {
    return this.next.has(key)
  }

  hasMore(key: PageKey): boolean {
    return !this.exhausted.has(key)
  }

  // 记录一页响应并推进游标,返回该分类当前是否还有更多。
  note(key: PageKey, page: number, resp: unknown, pageSizeHint = this.pageSizeHint): boolean {
    const list = Array.isArray((resp as { list?: unknown })?.list) ? (resp as { list: unknown[] }).list : []
    return this.noteList(
      key,
      page,
      list.length,
      Number((resp as { pagecount?: unknown })?.pagecount),
      Number((resp as { total?: unknown })?.total),
      pageSizeHint,
    )
  }

  noteList(
    key: PageKey,
    page: number,
    returned: number,
    pagecount?: number,
    total?: number,
    pageSizeHint = this.pageSizeHint,
  ): boolean {
    const pages = Number(pagecount)
    const totalItems = Number(total)
    if (!(Number.isFinite(pages) && pages > 0) && !(Number.isFinite(totalItems) && totalItems > 0)) {
      if (!this.pageSize.has(key) && returned > 0) {
        this.pageSize.set(key, Math.max(returned, 1))
      }
      pageSizeHint = this.pageSize.get(key) ?? pageSizeHint
    }
    // 空页直接判底:防止站点在 pg 越界后重复返回同一页导致死循环。
    const hasMore = returned > 0 && deriveHasMore({
      page,
      pageSize: pageSizeHint,
      returned,
      pagecount: Number.isFinite(pages) ? pages : undefined,
      total: Number.isFinite(totalItems) ? totalItems : undefined,
    })
    this.next.set(key, page + 1)
    if (hasMore) this.exhausted.delete(key)
    else this.exhausted.add(key)
    return hasMore
  }
}
