export const EPISODES_PER_PAGE = 100

export type EpisodePagination = {
  page: number
  pageCount: number
  start: number
  end: number
  episodes: number[]
}

const normalizePageSize = (pageSize: number) =>
  Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : EPISODES_PER_PAGE

export function episodePageFor(episode: number, pageSize = EPISODES_PER_PAGE) {
  const size = normalizePageSize(pageSize)
  const safeEpisode = Number.isFinite(episode)
    ? Math.max(1, Math.floor(episode))
    : 1
  return Math.floor((safeEpisode - 1) / size)
}

export function getEpisodePagination(
  total: number,
  requestedPage: number,
  pageSize = EPISODES_PER_PAGE,
): EpisodePagination {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  const size = normalizePageSize(pageSize)
  const pageCount = Math.ceil(safeTotal / size)
  if (!pageCount)
    return { page: 0, pageCount: 0, start: 0, end: 0, episodes: [] }

  const safeRequestedPage = Number.isFinite(requestedPage)
    ? Math.floor(requestedPage)
    : 0
  const page = Math.min(Math.max(0, safeRequestedPage), pageCount - 1)
  const start = page * size + 1
  const end = Math.min(safeTotal, start + size - 1)
  return {
    page,
    pageCount,
    start,
    end,
    episodes: Array.from(
      { length: end - start + 1 },
      (_, index) => start + index,
    ),
  }
}

export function getEpisodeRanges(total: number, pageSize = EPISODES_PER_PAGE) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  const size = normalizePageSize(pageSize)
  const pageCount = Math.ceil(safeTotal / size)
  return Array.from({ length: pageCount }, (_, page) => {
    const start = page * size + 1
    return { page, start, end: Math.min(safeTotal, start + size - 1) }
  })
}
