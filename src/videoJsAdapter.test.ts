import { describe, expect, it, vi } from 'vitest'
import type Player from 'video.js/dist/types/player'
import {
  selectVideoJsQuality,
  videoJsSource,
  type VideoJsQualityLevelList,
} from './videoJsAdapter'

describe('videoJsSource', () => {
  it('recognizes proxied and direct HLS URLs', () => {
    expect(videoJsSource('https://cdn.example/video/index.m3u8')).toEqual({
      src: 'https://cdn.example/video/index.m3u8',
      type: 'application/x-mpegURL',
    })
    expect(videoJsSource('/__tvbox?u=https%3A%2F%2Fcdn.example%2Findex.m3u8')).toEqual({
      src: '/__tvbox?u=https%3A%2F%2Fcdn.example%2Findex.m3u8',
      type: 'application/x-mpegURL',
    })
  })

  it('keeps common file MIME types explicit', () => {
    expect(videoJsSource('https://cdn.example/movie.mp4?token=1').type).toBe('video/mp4')
    expect(videoJsSource('https://cdn.example/movie.webm').type).toBe('video/webm')
    expect(videoJsSource('https://cdn.example/play?id=1')).toEqual({
      src: 'https://cdn.example/play?id=1',
    })
  })
})

describe('selectVideoJsQuality', () => {
  const makePlayer = () => {
    const levels = [
      { id: '360', enabled: true },
      { id: '720', enabled: true },
      { id: '1080', enabled: true },
    ] as unknown as VideoJsQualityLevelList
    Object.defineProperties(levels, {
      selectedIndex: { value: 1 },
      on: { value: vi.fn() },
      off: { value: vi.fn() },
    })
    const player = { qualityLevels: () => levels } as unknown as Player
    return { player, levels }
  }

  it('pins one rendition and restores automatic selection', () => {
    const { player, levels } = makePlayer()
    selectVideoJsQuality(player, 1)
    expect(Array.from(levels, (item) => item.enabled)).toEqual([false, true, false])

    selectVideoJsQuality(player, -1)
    expect(Array.from(levels, (item) => item.enabled)).toEqual([true, true, true])
  })
})
