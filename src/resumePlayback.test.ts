import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Title } from './data'
import { recordHistory } from './history'
import type { Catalog } from './useCatalog'
import { VideoPlayer } from './VideoPlayer'
import { Home } from './views/Home'

const title: Title = {
  id: 'v1',
  name: '测试剧',
  poster: '',
  backdrop: '',
  year: 2026,
  rating: 8,
  genres: ['剧集'],
  region: '中国大陆',
  quality: '1080P',
  episodes: 3,
  airedEpisodes: 3,
  latest: '更新至第3集',
  synopsis: '测试简介',
  cast: [],
}

const catalog: Catalog = {
  titles: [title],
  hero: title,
  ranking: [],
  history: [],
  byId: (id) => (id === title.id ? title : undefined),
}

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

describe('续播 UI 闭环', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false
  })

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('点击继续观看直接进入历史集数', () => {
    recordHistory({
      sourceId: 'source-a',
      titleId: title.id,
      name: title.name,
      ep: '第 2 集',
      episode: 2,
      progress: 19,
      positionSeconds: 271,
      durationSeconds: 1_430,
      img: '',
    })
    const onOpen = vi.fn()
    const onPlay = vi.fn()

    act(() => {
      root.render(
        createElement(Home, {
          catalog,
          sourceId: 'source-a',
          onOpen,
          onPlay,
          onMore: vi.fn(),
        }),
      )
    })

    const resumeCard = container.querySelector<HTMLElement>(
      '[aria-label="继续播放测试剧 第 2 集"]',
    )
    expect(resumeCard).not.toBeNull()
    act(() => resumeCard!.click())
    expect(onPlay).toHaveBeenCalledWith('v1', 2)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('目录未就绪时仍渲染首屏骨架和续播入口', () => {
    recordHistory({
      sourceId: 'source-a',
      titleId: title.id,
      name: title.name,
      ep: '第 2 集',
      episode: 2,
      progress: 19,
      positionSeconds: 271,
      durationSeconds: 1_430,
      img: '',
    })

    act(() => {
      root.render(
        createElement(Home, {
          sourceId: 'source-a',
          onOpen: vi.fn(),
          onPlay: vi.fn(),
          onMore: vi.fn(),
        }),
      )
    })

    expect(container.querySelector('[aria-label="首页内容加载中"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="继续播放测试剧 第 2 集"]')).not.toBeNull()
  })

  it('metadata 就绪后只恢复一次，暂停时强制保存', () => {
    const onTime = vi.fn()
    act(() => {
      root.render(
        createElement(VideoPlayer, {
          sources: [{ label: '1080P', url: 'https://example.com/video.mp4' }],
          poster: '',
          resumePoint: { progress: 19 },
          onTime,
        }),
      )
    })

    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 1_000 })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 0,
      writable: true,
    })

    act(() => video.dispatchEvent(new Event('loadedmetadata', { bubbles: true })))
    expect(video.currentTime).toBe(190)
    expect(container.textContent).toContain('已续播至 03:10')

    video.currentTime = 250
    act(() => video.dispatchEvent(new Event('durationchange', { bubbles: true })))
    expect(video.currentTime).toBe(250)

    act(() => video.dispatchEvent(new Event('pause', { bubbles: true })))
    expect(onTime).toHaveBeenCalledWith(250, 1_000, true)
  })

  it('片头跳过只应用一次', () => {
    act(() => {
      root.render(
        createElement(VideoPlayer, {
          sources: [{ label: '1080P', url: 'https://example.com/video.mp4' }],
          poster: '',
          skipIntroSeconds: 90,
        }),
      )
    })

    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 1_000 })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 0,
      writable: true,
    })

    act(() => video.dispatchEvent(new Event('loadedmetadata', { bubbles: true })))
    expect(video.currentTime).toBe(90)
    expect(container.textContent).toContain('已跳过片头 01:30')

    video.currentTime = 180
    act(() => video.dispatchEvent(new Event('durationchange', { bubbles: true })))
    expect(video.currentTime).toBe(180)
  })

  it('片尾窗口只触发一次，播放结束时通知下一集', () => {
    const onSkipOutro = vi.fn()
    const onEnded = vi.fn()
    act(() => {
      root.render(
        createElement(VideoPlayer, {
          sources: [{ label: '1080P', url: 'https://example.com/video.mp4' }],
          poster: '',
          skipOutroSeconds: 90,
          onSkipOutro,
          onEnded,
        }),
      )
    })

    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 1_000 })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 910,
      writable: true,
    })

    act(() => video.dispatchEvent(new Event('timeupdate', { bubbles: true })))
    act(() => video.dispatchEvent(new Event('timeupdate', { bubbles: true })))
    expect(onSkipOutro).toHaveBeenCalledTimes(1)

    act(() => video.dispatchEvent(new Event('ended', { bubbles: true })))
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})
