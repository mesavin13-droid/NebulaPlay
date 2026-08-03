import { useEffect, useMemo, useState } from "react"
import {
  ExternalLink,
  GitFork,
  Heart,
  HeartHandshake,
  Star,
} from "lucide-react"
import { BUILTIN_LINES, BUILTIN_TVBOX_SOURCES } from "./builtinSources"
import { useSourceHealth } from "./sourceHealth"
import { buildCustomSources, useCustomSourceConfigs } from "./customSources"
import { DEFAULT_SOURCE_ID, NAV, SOURCES, type VideoSource } from "./data"
import { SourceManager } from "./SourceManager"
import { TopNav } from "./TopNav"
import { PageLoading } from "./PageLoading"
import { useCatalog } from "./useCatalog"
import { Browse } from "./views/Browse"
import { Detail } from "./views/Detail"
import { Home } from "./views/Home"
import { Player } from "./views/Player"
import { Search } from "./views/Search"

type View = { name: "home" } | { name: "browse" } | {
  name: "search"
  q: string
} | { name: "detail" id: string } | { name: "player" id: string ep: number }

const SITE_URL = "https://nebu.life"
const REPOSITORY_URL = "https://github.com/AliceDel66/NebulaPlay"
const BABY_HOME_URL = "https://baobeihuijia.com/"

const FOOTER_COLUMNS = [
  {
    title: "开源",
    links: [
      { label: "GitHub 仓库", href: REPOSITORY_URL },
      { label: "在线站点", href: SITE_URL },
      { label: "MIT License", href: `${REPOSITORY_URL}/blob/dev/LICENSE` },
      { label: "参与贡献", href: `${REPOSITORY_URL}#开发与贡献` },
    ],
  },
  {
    title: "支持",
    links: [
      { label: "使用说明", href: `${REPOSITORY_URL}#readme` },
      { label: "版权与免责", href: `${REPOSITORY_URL}#免责声明` },
      { label: "问题反馈", href: `${REPOSITORY_URL}/issues` },
      { label: "宝贝回家", href: BABY_HOME_URL },
    ],
  },
]

export default function App() {
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID)
  const [view, setView] = useState<View>({ name: "home" })
  const [nav, setNav] = useState("首页")
  const [manageOpen, setManageOpen] = useState(false)
  const [failedAutoSourceIds, setFailedAutoSourceIds] = useState<Set<string>>(
    new Set(),
  )

  // 内置片源 + 预置 TVBox 源（自动探活过滤失活源）+ 用户自定义源。
  const customConfigs = useCustomSourceConfigs()
  const customSources = useMemo(
    () => buildCustomSources(customConfigs),
    [customConfigs],
  )
  const { liveLines, verifiedLiveLines } = useSourceHealth(BUILTIN_LINES)
  const liveUrlSet = useMemo(
    () => new Set(liveLines.map((l) => l.url)),
    [liveLines],
  )
  const verifiedSourceIds = useMemo(
    () => new Set(verifiedLiveLines.map((line) => `tvbox-${line.url}`)),
    [verifiedLiveLines],
  )
  const liveTvboxSources = useMemo(
    () => BUILTIN_TVBOX_SOURCES.filter((s) => liveUrlSet.has(s.id.slice(6))),
    [liveUrlSet],
  )
  const allSources = useMemo<VideoSource[]>(
    () => [...SOURCES, ...liveTvboxSources, ...customSources],
    [liveTvboxSources, customSources],
  )
  const source = useMemo(() => {
    const selected = allSources.find((candidate) => candidate.id === sourceId)
    if (selected) return selected
    const candidates = allSources.filter(
      (candidate) => !failedAutoSourceIds.has(candidate.id),
    )
    return (
      candidates.find((candidate) => verifiedSourceIds.has(candidate.id)) ??
      candidates[0] ??
      allSources[0]
    )
  }, [allSources, sourceId, failedAutoSourceIds, verifiedSourceIds])

  const { catalog, loading, error } = useCatalog(source ?? null)

  useEffect(() => {
    if (sourceId && !allSources.some((candidate) => candidate.id === sourceId))
      setSourceId("")
  }, [allSources, sourceId])

  // 默认源失败时自动轮换；用户手动选中的源保留错误页便于诊断。
  useEffect(() => {
    if (!error || catalog?.titles.length || sourceId || !source) return
    setFailedAutoSourceIds((current) => {
      if (current.has(source.id)) return current
      return new Set(current).add(source.id)
    })
  }, [error, catalog, sourceId, source])

  // 主视图切换时回到顶部。
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [view])

  const openDetail = (id: string) => setView({ name: "detail", id })
  const play = (id: string, ep: number) => setView({ name: "player", id, ep })
  const openSearch = (q: string) => {
    setNav("")
    setView({ name: "search", q })
  }

  const handleNav = (label: string) => {
    // 类别以当前片源返回的导航为准;未匹配项(如 Footer 固定链接)落到浏览页。
    const items = source?.nav?.length ? source.nav : NAV
    setNav(items.includes(label) ? label : "电影")
    setView(label === "首页" ? { name: "home" } : { name: "browse" })
  }

  const goHome = () => {
    setNav("首页")
    setView({ name: "home" })
  }

  // 切换片源:回到首页并跟随该片源的默认导航。
  const switchSource = (id: string) => {
    setSourceId(id)
    setNav("首页")
    setView({ name: "home" })
  }

  return (
    <div className="min-h-screen bg-[#07080d] text-[#eef0f6]">
      <TopNav
        active={nav}
        onNav={handleNav}
        onHome={goHome}
        sources={allSources}
        currentSourceId={source?.id ?? ""}
        onSwitchSource={switchSource}
        onManageSources={() => setManageOpen(true)}
        onSearch={openSearch}
      />

      <main className="min-h-[70vh]">
        {!source ? (
          <PageLoading
            label="正在检测可用片源"
            detail="失活片源会自动跳过，请稍候"
          />
        ) : loading || !catalog ? (
          <PageLoading
            label={loadingLabel(view)}
            detail={`正在从「${source.name}」获取完整数据`}
          />
        ) : error && catalog.titles.length === 0 ? (
          <SourceError
            name={source.name}
            error={error}
            onManage={() => setManageOpen(true)}
          />
        ) : catalog.titles.length === 0 && view.name !== "search" ? (
          <EmptySource
            name={source.name}
            searchable={Boolean(source.search)}
            onSearch={() => openSearch("")}
            onManage={() => setManageOpen(true)}
          />
        ) : (
          <>
            {view.name === "home" && (
              <Home
                catalog={catalog}
                sourceId={source.id}
                onOpen={openDetail}
                onPlay={play}
                onMore={handleNav}
              />
            )}
            {view.name === "browse" && (
              <Browse
                catalog={catalog}
                filters={source.filters}
                category={nav}
                sourceId={source.id}
                source={source}
                onOpen={openDetail}
              />
            )}
            {view.name === "search" && (
              <Search
                titles={catalog.titles}
                query={view.q}
                source={source}
                onQueryChange={(q) => setView({ name: "search", q })}
                onOpen={openDetail}
              />
            )}
            {view.name === "detail" && (
              <Detail
                key={`${source.id}:${view.id}`}
                id={view.id}
                source={source}
                catalog={catalog}
                onOpen={openDetail}
                onPlay={play}
              />
            )}
            {view.name === "player" && (
              <Player
                key={`${source.id}:${view.id}`}
                id={view.id}
                ep={view.ep}
                source={source}
                catalog={catalog}
                onOpen={openDetail}
                onPlay={play}
                onBack={() => setView({ name: "detail", id: view.id })}
              />
            )}
          </>
        )}
      </main>

      <Footer
        categories={(source?.nav?.length ? source.nav : NAV)
          .filter((label) => label !== "首页")
          .slice(0, 4)}
        onNav={handleNav}
      />

      {manageOpen && (
        <SourceManager
          onClose={() => setManageOpen(false)}
          onSaved={(id) => {
            switchSource(id)
            setManageOpen(false)
          }}
        />
      )}
    </div>
  )
}

function loadingLabel(view: View) {
  switch (view.name) {
    case "home":
      return "正在加载首页"
    case "browse":
      return "正在加载分类内容"
    case "search":
      return "正在准备搜索"
    case "detail":
      return "正在加载影片详情"
    case "player":
      return "正在准备播放器"
  }
}

function SourceError({
  name,
  error,
  onManage,
}: {
  name: string
  error: string
  onManage: () => void
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-28 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-[#e0142c]/12 text-2xl">
        ⚠️
      </div>
      <h2 className="mt-4 font-serif text-xl font-bold text-white">
        片源「{name}」加载失败
      </h2>
      <p className="mt-2 text-sm text-[#9aa0b0]">{error}</p>
      <p className="mt-1 text-xs text-[#5a5f70]">
        请检查片源地址与访问权限。跨域请求会使用已配置的前端代理。
      </p>
      <button
        onClick={onManage}
        className="mt-5 rounded-lg bg-[#e0142c] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        检查片源配置
      </button>
    </div>
  )
}

function EmptySource({
  name,
  searchable,
  onSearch,
  onManage,
}: {
  name: string
  searchable: boolean
  onSearch: () => void
  onManage: () => void
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-28 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-white/5 text-2xl">
        🎬
      </div>
      <h2 className="mt-4 font-serif text-xl font-bold text-white">
        片源「{name}」暂无内容
      </h2>
      <p className="mt-2 text-sm text-[#9aa0b0]">
        {searchable
          ? "该片源不提供首页目录，请输入关键词搜索。"
          : "这个片源没有返回任何影片,试试补全它的配置。"}
      </p>
      <button
        onClick={searchable ? onSearch : onManage}
        className="mt-5 rounded-lg bg-[#e0142c] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        {searchable ? "开始搜索" : "管理片源"}
      </button>
    </div>
  )
}

function Footer({
  categories,
  onNav,
}: {
  categories: string[]
  onNav: (label: string) => void
}) {
  return (
    <footer className="border-t border-white/6 bg-[#0a0b12]">
      <section
        className="border-b border-white/6 bg-[#0d0f16]"
        aria-labelledby="baby-home-title"
      >
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-7 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="flex max-w-3xl items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#e0142c]/25 bg-[#e0142c]/10 text-[#ff3b52]">
              <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2
                  id="baby-home-title"
                  className="font-serif text-lg font-bold text-white"
                >
                  宝贝回家
                </h2>
                <span className="text-xs text-[#e8b23a]">公益寻亲官方入口</span>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-[#9aa0b0]">
                让更多团圆被看见。如需寻亲或提供线索，请前往官方平台；本站不收集、不转载寻亲个人信息。
              </p>
            </div>
          </div>
          <a
            href={BABY_HOME_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-medium text-white transition hover:text-[#ff3b52] sm:self-center"
          >
            访问官方网站
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">（在新窗口打开）</span>
          </a>
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-4 py-10 lg:px-8 lg:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16">
          <div className="max-w-xl">
            <span className="font-display text-xl font-bold text-white">
              Nebula<span className="text-[#e0142c]">Play</span>{" "}
              <span className="font-serif text-lg">星幕</span>
            </span>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#9aa0b0]">
              星幕是一个非营利、无账号依赖的开源在线视频客户端。目录、搜索、选集与播放通过可插拔片源接入，配置和观看记录保存在当前浏览器。
            </p>
            <p className="mt-3 max-w-lg text-xs leading-5 text-[#5a5f70]">
              本站不上传、存储或转码媒体文件，也不授予任何第三方内容权利。请仅使用自有、获授权或公有领域内容，完整边界请查看版权与免责声明。
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex w-fit items-center gap-3 rounded-lg bg-white px-4 py-3 text-[#0a0b12] shadow-[0_8px_28px_rgba(0,0,0,0.28)] transition hover:bg-[#f3f4f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3b52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b12]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e0142c] text-white">
                  <Star
                    className="h-5 w-5"
                    fill="currentColor"
                    aria-hidden="true"
                  />
                </span>
                <span className="text-left">
                  <span className="block text-sm font-bold">
                    去 GitHub 点个 Star
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#5a5f70]">
                    支持 NebulaPlay 持续维护
                  </span>
                </span>
                <ExternalLink
                  className="ml-1 h-4 w-4 text-[#6b7080] transition group-hover:text-[#e0142c]"
                  aria-hidden="true"
                />
                <span className="sr-only">（在新窗口打开）</span>
              </a>
              <span className="inline-flex items-center gap-1.5 text-xs text-[#5a5f70]">
                <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                AliceDel66/NebulaPlay · MIT License
              </span>
            </div>
          </div>

          <nav
            aria-label="页脚导航"
            className="grid grid-cols-2 gap-x-8 gap-y-8 text-sm sm:grid-cols-3 sm:gap-x-12"
          >
            <div>
              <p className="mb-3 font-medium text-white">浏览</p>
              <ul className="space-y-2.5">
                {categories.map((label) => (
                  <li key={label}>
                    <button
                      onClick={() => onNav(label)}
                      className="text-[#9aa0b0] transition hover:text-[#ff3b52]"
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {FOOTER_COLUMNS.map(({ title, links }) => (
              <div key={title}>
                <p className="mb-3 font-medium text-white">{title}</p>
                <ul className="space-y-2">
                  {links.map(({ label, href }) => (
                    <li key={label}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#9aa0b0] transition hover:text-[#ff3b52]"
                      >
                        {label}
                        <span className="sr-only">（在新窗口打开）</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-6 text-xs text-[#5a5f70]">
          <span>
            © 2026 NebulaPlay 星幕 · 非营利公益项目 · 内容仅供学习与交流
          </span>
          <span className="inline-flex items-center gap-1.5">
            用
            <Heart
              className="h-3.5 w-3.5 text-[#e0142c]"
              fill="currentColor"
              aria-hidden="true"
            />
            与开源精神构建
          </span>
        </div>
      </div>
    </footer>
  )
}
