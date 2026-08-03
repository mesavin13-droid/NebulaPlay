import { useEffect, useMemo, useState } from 'react'
import { BUILTIN_LINES, BUILTIN_TVBOX_SOURCES } from './builtinSources'
import { useSourceHealth } from './sourceHealth'
import { buildCustomSources, useCustomSourceConfigs } from './customSources'
import { DEFAULT_SOURCE_ID, NAV, SOURCES, type VideoSource } from './data'
import { SourceManager } from './SourceManager'
import { TopNav } from './TopNav'
import { useCatalog } from './useCatalog'
import { Browse } from './views/Browse'
import { Detail } from './views/Detail'
import { Home } from './views/Home'
import { Player } from './views/Player'
import { Search } from './views/Search'

type View =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'search'; q: string }
  | { name: 'detail'; id: string }
  | { name: 'player'; id: string; ep: number }

export default function App() {
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID)
  const [view, setView] = useState<View>({ name: 'home' })
  const [nav, setNav] = useState('首页')
  const [manageOpen, setManageOpen] = useState(false)
  const [failedAutoSourceIds, setFailedAutoSourceIds] = useState<Set<string>>(new Set())

  // 内置片源 + 预置 TVBox 源（自动探活过滤失活源）+ 用户自定义源。
  const customConfigs = useCustomSourceConfigs()
  const customSources = useMemo(() => buildCustomSources(customConfigs), [customConfigs])
  const { liveLines, verifiedLiveLines } = useSourceHealth(BUILTIN_LINES)
  const liveUrlSet = useMemo(() => new Set(liveLines.map((l) => l.url)), [liveLines])
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
  const source = useMemo(
    () => {
      const selected = allSources.find((candidate) => candidate.id === sourceId)
      if (selected) return selected
      const candidates = allSources.filter((candidate) => !failedAutoSourceIds.has(candidate.id))
      return (
        candidates.find((candidate) => verifiedSourceIds.has(candidate.id)) ??
        candidates[0] ??
        allSources[0]
      )
    },
    [allSources, sourceId, failedAutoSourceIds, verifiedSourceIds],
  )

  const { catalog, loading, error } = useCatalog(source ?? null)

  useEffect(() => {
    if (sourceId && !allSources.some((candidate) => candidate.id === sourceId))
      setSourceId('')
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [view])

  const openDetail = (id: string) => setView({ name: 'detail', id })
  const play = (id: string, ep: number) => setView({ name: 'player', id, ep })
  const openSearch = (q: string) => {
    setNav('')
    setView({ name: 'search', q })
  }

  const handleNav = (label: string) => {
    setNav(NAV.includes(label) ? label : '电影')
    setView(label === '首页' ? { name: 'home' } : { name: 'browse' })
  }

  const goHome = () => {
    setNav('首页')
    setView({ name: 'home' })
  }

  // 切换片源:回到首页并跟随该片源的默认导航。
  const switchSource = (id: string) => {
    setSourceId(id)
    setNav('首页')
    setView({ name: 'home' })
  }

  return (
    <div className="min-h-screen bg-[#07080d] text-[#eef0f6]">
      <TopNav
        active={nav}
        onNav={handleNav}
        onHome={goHome}
        sources={allSources}
        currentSourceId={source?.id ?? ''}
        onSwitchSource={switchSource}
        onManageSources={() => setManageOpen(true)}
        onSearch={openSearch}
      />

      <main className="min-h-[70vh]">
        {!source ? (
          <LoadingScreen name="真实片源(探活中,失活源自动过滤)" />
        ) : loading || !catalog ? (
          view.name === 'home' ? (
            <Home
              catalog={catalog ?? undefined}
              sourceId={source.id}
              onOpen={openDetail}
              onPlay={play}
              onMore={handleNav}
            />
          ) : (
            <LoadingScreen name={source.name} />
          )
        ) : error && catalog.titles.length === 0 ? (
          <SourceError
            name={source.name}
            error={error}
            onManage={() => setManageOpen(true)}
          />
        ) : catalog.titles.length === 0 && view.name !== 'search' ? (
          <EmptySource
            name={source.name}
            searchable={Boolean(source.search)}
            onSearch={() => openSearch('')}
            onManage={() => setManageOpen(true)}
          />
        ) : (
          <>
            {view.name === 'home' && (
              <Home
                catalog={catalog}
                sourceId={source.id}
                onOpen={openDetail}
                onPlay={play}
                onMore={handleNav}
              />
            )}
            {view.name === 'browse' && (
              <Browse
                catalog={catalog}
                filters={source.filters}
                category={nav}
                sourceId={source.id}
                source={source}
                onOpen={openDetail}
              />
            )}
            {view.name === 'search' && (
              <Search
                titles={catalog.titles}
                query={view.q}
                source={source}
                onQueryChange={(q) => setView({ name: 'search', q })}
                onOpen={openDetail}
              />
            )}
            {view.name === 'detail' && (
              <Detail id={view.id} source={source} catalog={catalog} onOpen={openDetail} onPlay={play} />
            )}
            {view.name === 'player' && (
              <Player
                id={view.id}
                ep={view.ep}
                source={source}
                catalog={catalog}
                onOpen={openDetail}
                onPlay={play}
                onBack={() => setView({ name: 'detail', id: view.id })}
              />
            )}
          </>
        )}
      </main>

      <Footer onNav={handleNav} />

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

function LoadingScreen({ name }: { name: string }) {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-center px-4 py-32">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#e0142c]" />
      <p className="mt-4 text-sm text-[#9aa0b0]">正在接入片源「{name}」…</p>
    </div>
  )
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
      <div className="grid h-14 w-14 place-items-center rounded-full bg-[#e0142c]/12 text-2xl">⚠️</div>
      <h2 className="mt-4 font-serif text-xl font-bold text-white">片源「{name}」加载失败</h2>
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
      <div className="grid h-14 w-14 place-items-center rounded-full bg-white/5 text-2xl">🎬</div>
      <h2 className="mt-4 font-serif text-xl font-bold text-white">片源「{name}」暂无内容</h2>
      <p className="mt-2 text-sm text-[#9aa0b0]">
        {searchable
          ? '该片源不提供首页目录，请输入关键词搜索。'
          : '这个片源没有返回任何影片,试试补全它的配置。'}
      </p>
      <button
        onClick={searchable ? onSearch : onManage}
        className="mt-5 rounded-lg bg-[#e0142c] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        {searchable ? '开始搜索' : '管理片源'}
      </button>
    </div>
  )
}

function Footer({ onNav }: { onNav: (label: string) => void }) {
  return (
    <footer className="border-t border-white/6 bg-[#0a0b12]">
      <div className="mx-auto max-w-[1440px] px-4 py-10 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold text-white">
                Nebula<span className="text-[#e0142c]">Play</span> 星幕
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#5a5f70]">
             星幕是一个非营利性的免费在线视频平台,由志愿者社区共同维护。片源采用可插拔架构。
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[#5a5f70]">
              免责声明:本站所有内容均来自互联网分享站点所提供的公开引用资源,未提供资源上传、存储服务。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-x-12 gap-y-2 text-sm">
            {[
              ['浏览', ['电影', '剧集', '动漫', '综艺']],
              ['关于', ['公益理念', '版权声明', '加入我们', '捐助支持']],
              ['帮助', ['常见问题', '意见反馈', '无障碍', '联系客服']],
            ].map(([head, links]) => (
              <div key={head as string}>
                <p className="mb-3 font-medium text-white">{head}</p>
                <ul className="space-y-2">
                  {(links as string[]).map((l) => (
                    <li key={l}>
                      <button
                        onClick={() => onNav(l)}
                        className="text-[#9aa0b0] transition hover:text-[#ff3b52]"
                      >
                        {l}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-6 text-xs text-[#5a5f70]">
          <span>© 2026 NebulaPlay 星幕 · 非营利公益项目 · 内容仅供学习与交流</span>
          <span>用 ❤️ 与开源精神构建</span>
        </div>
      </div>
    </footer>
  )
}
