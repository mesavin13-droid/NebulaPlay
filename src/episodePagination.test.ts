import { describe, expect, it } from "vitest"
import {
  episodePageFor,
  getEpisodePagination,
  getEpisodeRanges,
} from "./episodePagination"

describe("episode pagination", () => {
  it("builds 100-episode ranges and keeps the final global episode numbers", () => {
    const ranges = getEpisodeRanges(1095)
    expect(ranges).toHaveLength(11)
    expect(ranges[0]).toEqual({ page: 0, start: 1, end: 100 })
    expect(ranges[10]).toEqual({ page: 10, start: 1001, end: 1095 })

    const last = getEpisodePagination(1095, 10)
    expect(last.episodes).toHaveLength(95)
    expect(last.episodes[0]).toBe(1001)
    expect(last.episodes.at(-1)).toBe(1095)
  })

  it("locates the page that contains the current one-based episode", () => {
    expect(episodePageFor(1)).toBe(0)
    expect(episodePageFor(100)).toBe(0)
    expect(episodePageFor(101)).toBe(1)
    expect(episodePageFor(1095)).toBe(10)
  })

  it("clamps invalid page requests without renumbering episodes", () => {
    expect(getEpisodePagination(1095, 99)).toMatchObject({
      page: 10,
      start: 1001,
      end: 1095,
    })
    expect(getEpisodePagination(0, 0)).toEqual({
      page: 0,
      pageCount: 0,
      start: 0,
      end: 0,
      episodes: [],
    })
  })
})
