import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import type { Title, VideoSource } from "./data"
import { useCatalog } from "./useCatalog"

const title: Title = {
  id: "v1",
  name: "真实片源缓存影片",
  poster: "poster.jpg",
  backdrop: "backdrop.jpg",
  year: 2026,
  rating: 8,
  genres: ["电影"],
  region: "中国大陆",
  quality: "1080P",
  episodes: 1,
  airedEpisodes: 1,
  latest: "正片",
  synopsis: "测试",
  cast: [],
}

const makeSource = (pending = false): VideoSource => {
  const never = new Promise<never>(() => {})
  return {
    id: "tvbox-https://source.test/api",
    name: "测试真实源",
    badge: "源",
    tagline: "测试",
    online: true,
    nav: ["首页"],
    filters: { genres: ["全部"], regions: ["全部"], years: ["全部"] },
    loadCatalog: () => (pending ? never : Promise.resolve([title])),
    loadHero: () => (pending ? never : Promise.resolve(title)),
    loadRanking: () => (pending ? never : Promise.resolve([])),
    loadHistory: () => (pending ? never : Promise.resolve([])),
    loadDetail: () => Promise.resolve(title),
    loadRatingTrend: () => Promise.resolve([]),
    loadPlayUrl: () => Promise.resolve("https://example.com/video.mp4"),
    loadPlaySources: () =>
      Promise.resolve([
        { label: "1080P", url: "https://example.com/video.mp4" },
      ]),
  }
}

function CatalogProbe({ source }: { source: VideoSource }) {
  const state = useCatalog(source)
  return createElement(
    "div",
    {
      "data-loading": String(state.loading),
      "data-error": state.error ?? "",
    },
    state.catalog?.titles[0]?.name ?? "无缓存",
  )
}

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

describe("片库首屏加载边界", () => {
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
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("回访时等待当前请求完成，不提前展示旧缓存", async () => {
    await act(async () => {
      root.render(createElement(CatalogProbe, { source: makeSource() }))
      await Promise.resolve()
    })
    expect(container.textContent).toBe(title.name)

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(CatalogProbe, { source: makeSource(true) }))
      await Promise.resolve()
    })

    expect(container.textContent).toBe("无缓存")
    expect(container.querySelector("div")?.getAttribute("data-loading")).toBe(
      "true",
    )
  })

  it("当前请求失败后才使用旧缓存兜底", async () => {
    await act(async () => {
      root.render(createElement(CatalogProbe, { source: makeSource() }))
      await Promise.resolve()
    })
    expect(container.textContent).toBe(title.name)

    act(() => root.unmount())
    root = createRoot(container)
    const failed = makeSource()
    failed.loadCatalog = () => Promise.reject(new Error("网络不可用"))
    await act(async () => {
      root.render(createElement(CatalogProbe, { source: failed }))
      await Promise.resolve()
    })

    expect(container.textContent).toBe(title.name)
    expect(container.querySelector("div")?.getAttribute("data-loading")).toBe(
      "false",
    )
    expect(container.querySelector("div")?.getAttribute("data-error")).toBe(
      "网络不可用",
    )
  })
})
