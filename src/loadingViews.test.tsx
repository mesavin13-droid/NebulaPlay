import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import type { Title, VideoSource } from "./data"
import type { Catalog } from "./useCatalog"
import { Browse } from "./views/Browse"
import { Detail } from "./views/Detail"
import { Player } from "./views/Player"
import { Search } from "./views/Search"

const title: Title = {
  id: "v1",
  name: "加载边界测试影片",
  poster: "",
  backdrop: "",
  year: 2026,
  rating: 8,
  genres: ["电影"],
  region: "中国大陆",
  quality: "1080P",
  episodes: 1,
  airedEpisodes: 1,
  latest: "正片",
  synopsis: "测试简介",
  cast: [],
}

const catalog: Catalog = {
  titles: [title],
  hero: title,
  ranking: [],
  history: [],
  byId: (id) => (id === title.id ? title : undefined),
}

function deferred<T>() {
  // Promise 执行器同步运行，两个引用在 return 前必然已赋值。
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// VideoPlayer 走 React.lazy。即使模块已预热,React 解析 lazy 仍要跨任务队列,
// 单纯 await Promise.resolve() 刷不出来,这里让出几轮宏任务。
async function flushLazy(turns = 4) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function makeSource(overrides: Partial<VideoSource> = {}): VideoSource {
  return {
    id: "remote-loading-test",
    name: "测试片源",
    badge: "测",
    tagline: "测试",
    online: true,
    nav: ["首页", "电影"],
    filters: { genres: ["全部"], regions: ["全部"], years: ["全部"] },
    loadCatalog: () => Promise.resolve([title]),
    loadHero: () => Promise.resolve(title),
    loadRanking: () => Promise.resolve([]),
    loadHistory: () => Promise.resolve([]),
    loadDetail: () => Promise.resolve(title),
    loadRatingTrend: () => Promise.resolve([]),
    loadPlayUrl: () => Promise.resolve("https://example.com/video.mp4"),
    loadPlaySources: () =>
      Promise.resolve([
        { label: "1080P", url: "https://example.com/video.mp4" },
      ]),
    ...overrides,
  }
}

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

describe("页面数据完整加载态", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(async () => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true
    // 预热 lazy chunk:模块进过 registry 后,Suspense 只需再刷一轮任务队列。
    await import("./VideoPlayer")
  })

  afterAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false
  })

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => root.unmount())
    container.remove()
  })

  it("Browse 在首轮筛选请求完成前不渲染旧列表", async () => {
    const request = deferred<{
      added: number
      hasMore: boolean
      items: Title[]
    }>()
    const source = makeSource({ loadMore: () => request.promise })

    await act(async () => {
      root.render(
        <Browse
          catalog={catalog}
          filters={source.filters}
          category="电影"
          sourceId={source.id}
          source={source}
          onOpen={() => {}}
        />,
      )
    })

    expect(container.textContent).toContain("正在加载「电影」")
    request.resolve({ added: 1, hasMore: false, items: [title] })
    await act(async () => {
      await request.promise
    })

    expect(container.textContent).not.toContain("正在加载「电影」")
    expect(container.textContent).toContain(title.name)
  })

  it("Search 等远程搜索完成后再合并本地结果", async () => {
    vi.useFakeTimers()
    const request = deferred<Title[]>()
    const source = makeSource({ search: () => request.promise })

    await act(async () => {
      root.render(
        <Search
          titles={[title]}
          query="加载边界"
          source={source}
          onQueryChange={() => {}}
          onOpen={() => {}}
        />,
      )
    })

    expect(container.textContent).toContain("正在全库搜索「加载边界」")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(280)
    })
    request.resolve([])
    await act(async () => {
      await request.promise
    })

    expect(container.textContent).not.toContain("正在全库搜索")
    expect(container.textContent).toContain(title.name)
  })

  it("Detail 等详情与评分趋势都完成后再渲染", async () => {
    const trend = deferred<[]>()
    const source = makeSource({ loadRatingTrend: () => trend.promise })

    await act(async () => {
      root.render(
        <Detail
          id={title.id}
          source={source}
          catalog={catalog}
          onOpen={() => {}}
          onPlay={() => {}}
        />,
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain("正在加载影片详情")
    trend.resolve([])
    await act(async () => {
      await trend.promise
    })

    expect(container.textContent).not.toContain("正在加载影片详情")
    expect(container.querySelector("h1")?.textContent).toContain(title.name)
  })

  it("Player 等详情与播放线路都完成后再渲染", async () => {
    const playSources = deferred<[]>()
    const source = makeSource({ loadPlaySources: () => playSources.promise })

    await act(async () => {
      root.render(
        <Player
          id={title.id}
          ep={1}
          source={source}
          catalog={catalog}
          onOpen={() => {}}
          onPlay={() => {}}
          onBack={() => {}}
        />,
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain("正在准备第 1 集")
    playSources.resolve([])
    await act(async () => {
      await playSources.promise
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain("正在准备第 1 集")
    expect(container.textContent).toContain("播放线路加载失败")
  })

  it("Player 切换下一集时保留播放器且不回到整页 Loading", async () => {
    const seriesTitle = {
      ...title,
      episodes: 3,
      airedEpisodes: 3,
      latest: "更新至第3集",
    }
    const seriesCatalog: Catalog = {
      ...catalog,
      titles: [seriesTitle],
      hero: seriesTitle,
      byId: (targetId) =>
        targetId === seriesTitle.id ? seriesTitle : undefined,
    }
    const episodeTwo = deferred<[{ label: string; url: string }]>()
    const onPlay = vi.fn()
    const source = makeSource({
      loadDetail: () => Promise.resolve(seriesTitle),
      loadPlaySources: (_id, episode) =>
        episode === 1
          ? Promise.resolve([
              { label: "1080P", url: "https://example.com/one.mp4" },
            ])
          : episodeTwo.promise,
    })

    await act(async () => {
      root.render(
        <Player
          id={seriesTitle.id}
          ep={1}
          source={source}
          catalog={seriesCatalog}
          onOpen={() => {}}
          onPlay={onPlay}
          onBack={() => {}}
        />,
      )
      await flushLazy()
    })

    const firstVideo = container.querySelector("video")
    expect(firstVideo).not.toBeNull()
    act(() => firstVideo!.dispatchEvent(new Event("ended", { bubbles: true })))
    expect(onPlay).toHaveBeenCalledWith(seriesTitle.id, 2)

    await act(async () => {
      root.render(
        <Player
          id={seriesTitle.id}
          ep={2}
          source={source}
          catalog={seriesCatalog}
          onOpen={() => {}}
          onPlay={onPlay}
          onBack={() => {}}
        />,
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector("video")).toBe(firstVideo)
    expect(container.textContent).toContain("正在切换至第 2 集")

    episodeTwo.resolve([
      { label: "1080P", url: "https://example.com/two.mp4" },
    ])
    await act(async () => {
      await episodeTwo.promise
      await Promise.resolve()
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).not.toContain("正在切换至第 2 集")
    expect(container.querySelector("[data-source-url]")?.getAttribute("data-source-url")).toContain(
      "two.mp4",
    )
  })
})
