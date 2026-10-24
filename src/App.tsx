import { useEffect, useMemo, useState } from "react"
import {
  ExternalLink,
  GitFork,
  Heart,
  Star,
} from "lucide-react"
import { BUILTIN_LINES, BUILTIN_TVBOX_SOURCES } from "./builtinSources"
import { useSourceHealth } from "./sourceHealth"
import { buildCustomSources, useCustomSourceConfigs } from "./customSources"
import { DEFAULT_SOURCE_ID, NAV, SOURCES, type VideoSource } from "./data"
import { SourceManager } from "./SourceManager"
import { ruLabel } from "./localization"
import { TopNav } from "./TopNav"
import { PageLoading } from "./PageLoading"
import { useCatalog } from "./useCatalog"
import { Browse } from "./views/Browse"
import { Detail } from "./views/Detail"
import { Home } from "./views/Home"
import { Player } from "./views/Player"
import { Search } from "./views/Search"

type View =
  | { name: "home" }
  | { name: "browse" }
  | { name: "search"; q: string }
  | { name: "detail"; id: string }
  | { name: "player"; id: string; ep: number }

const SITE_URL = "https://github.com/mesavin13-droid/NebulaPlay"
const REPOSITORY_URL = "https://github.com/mesavin13-droid/NebulaPlay"

const FOOTER_COLUMNS = [
  {
    title: "Проект",
    links: [
      { label: "Репозиторий GitHub", href: REPOSITORY_URL },
      { label: "Исходный код CINEMA", href: SITE_URL },
      { label: "MIT License", href: `${REPOSITORY_URL}/blob/dev/LICENSE` },
      { label: "Как помочь проекту", href: `${REPOSITORY_URL}#readme` },
    ],
  },
  {
    title: "Информация",
    links: [
      { label: "Инструкция", href: `${REPOSITORY_URL}#readme` },
      { label: "Права на контент", href: `${REPOSITORY_URL}#readme` },
      { label: "Сообщить о проблеме", href: `${REPOSITORY_URL}/issues` },
      { label: "Внешний благотворительный ресурс", href: BABY_HOME_URL },
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

  // Встроенные источники отключены; остаются проверенные и добавленные пользователем источники.
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

  // 默认源失败时自动轮换；Сделано с户手动选中的源保留错误页便于诊断。
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
          <NoSourceSetup onManage={() => setManageOpen(true)} />
        ) : loading || !catalog ? (
          <PageLoading
            label={loadingLabel(view)}
            detail={`Загружаем каталог из источника «${source.name}»`}
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
      return "Загружаем главную страницу"
    case "browse":
      return "Загружаем каталог"
    case "search":
      return "Подготавливаем поиск"
    case "detail":
      return "Загружаем информацию о фильме"
    case "player":
      return "Подготавливаем плеер"
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
        Не удалось загрузить источник «{name}»
      </h2>
      <p className="mt-2 text-sm text-[#9aa0b0]">{error}</p>
      <p className="mt-1 text-xs text-[#5a5f70]">
        Проверьте адрес источника и права доступа. Для запросов между доменами используется настроенный прокси.
      </p>
      <button
        onClick={onManage}
        className="mt-5 rounded-lg bg-[#e0142c] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        Проверить настройки источника
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
        В источнике «{name}» пока нет контента
      </h2>
      <p className="mt-2 text-sm text-[#9aa0b0]">
        {searchable
          ? "У этого источника нет главного каталога. Введите ключевые слова для поиска."
          : "Источник не вернул фильмы. Проверьте его настройки."}
      </p>
      <button
        onClick={searchable ? onSearch : onManage}
        className="mt-5 rounded-lg bg-[#e0142c] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        {searchable ? "Начать поиск" : "Управление источниками"}
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

      <div className="mx-auto max-w-[1440px] px-4 py-10 lg:px-8 lg:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16">
          <div className="max-w-xl">
            <span className="font-display text-xl font-bold text-white">
              Nebula<span className="text-[#e0142c]">Play</span>{" "}
              <span className="font-serif text-lg">星幕</span>
            </span>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#9aa0b0]">
              CINEMA — видеокаталог с поиском, карточками фильмов и встроенным плеером. Каталог подключается через настраиваемые источники, а настройки и история просмотров хранятся в этом браузере.
            </p>
            <p className="mt-3 max-w-lg text-xs leading-5 text-[#5a5f70]">
              Сервис не загружает, не хранит и не перекодирует медиафайлы и не предоставляет прав на сторонний контент. Подключайте только собственные материалы, контент с разрешением правообладателя или произведения из общественного достояния.
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
                    Поставить звезду на GitHub
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#5a5f70]">
                    Поддержать развитие CINEMA
                  </span>
                </span>
                <ExternalLink
                  className="ml-1 h-4 w-4 text-[#6b7080] transition group-hover:text-[#e0142c]"
                  aria-hidden="true"
                />
                <span className="sr-only">(откроется в новой вкладке)</span>
              </a>
              <span className="inline-flex items-center gap-1.5 text-xs text-[#5a5f70]">
                <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                Исходный код · лицензия MIT
              </span>
            </div>
          </div>

          <nav
            aria-label="Навигация внизу страницы"
            className="grid grid-cols-2 gap-x-8 gap-y-8 text-sm sm:grid-cols-3 sm:gap-x-12"
          >
            <div>
              <p className="mb-3 font-medium text-white">Разделы</p>
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
            © 2026 CINEMA · Используйте только контент с разрешёнными правами
          </span>
          <span className="inline-flex items-center gap-1.5">
            Сделано с
            <Heart
              className="h-3.5 w-3.5 text-[#e0142c]"
              fill="currentColor"
              aria-hidden="true"
            />
            и открытым исходным кодом
          </span>
        </div>
      </div>
    </footer>
  )
}


function NoSourceSetup({ onManage }: { onManage: () => void }) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-3xl flex-col items-center justify-center px-5 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#e0142c]/25 bg-[#e0142c]/10 text-2xl text-[#ff3b52]">
        ▶
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-[#ff3b52]">CINEMA</p>
      <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Подключим каталог фильмов</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-[#9aa0b0]">
        По умолчанию отключены непроверенные сторонние источники. Добавь каталог или прямую видеоссылку, на использование которой у тебя есть разрешение. Пока источники не подключены, реальные фильмы не отображаются.
      </p>
      <button
        onClick={onManage}
        className="mt-7 rounded-xl bg-[#e0142c] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        Настроить источник
      </button>
      <p className="mt-4 max-w-xl text-xs leading-6 text-[#5a5f70]">
        Следующий этап — подключить стартовый каталог контента с подтверждёнными правами и проверить сборку перед публикацией.
      </p>
    </section>
  )
}
