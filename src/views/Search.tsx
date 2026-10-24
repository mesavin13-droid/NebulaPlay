import { useEffect, useMemo, useRef, useState } from "react"
import { Search as SearchIcon, TrendingUp, X } from "lucide-react"
import { ratingLabel, type Title, type VideoSource } from "../data"
import { ruLabel } from "../localization"
import { PageLoading } from "../PageLoading"
import { IconStar, Img, PosterCard } from "../ui"

const RECENT_KEY = "nebulaplay:searches:v1"

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) as string[] : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {
    /* ignore */
  }
}

// 命中评分:名称 > 别名 > 主演 > 类型 / 地区 > 简介,用于结果排序。
function scoreOf(t: Title, q: string): number {
  const kw = q.toLowerCase()
  const name = t.name.toLowerCase()
  if (!kw) return 0
  let s = 0
  if (name === kw) s += 100
  if (name.includes(kw)) s += 40
  if (t.sub?.toLowerCase().includes(kw)) s += 20
  if (t.cast.some((c) => c.toLowerCase().includes(kw))) s += 16
  if (t.genres.some((g) => g.toLowerCase().includes(kw))) s += 10
  if (t.region.toLowerCase().includes(kw)) s += 8
  if (t.synopsis.toLowerCase().includes(kw)) s += 4
  return s
}

export function Search({
  titles,
  query,
  source,
  onQueryChange,
  onOpen,
}: {
  titles: Title[]
  query: string
  source?: VideoSource
  onQueryChange: (q: string) => void
  onOpen: (id: string) => void
}) {
  const [draft, setDraft] = useState(query)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [remoteState, setRemoteState] = useState<{
    key: string
    items: Title[]
    error: string | null
  }>({ key: "", items: [], error: null })
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)
  const searchKey = `${source?.id ?? "local"}:${query.trim()}`
  const shouldSearch = Boolean(query.trim() && source?.search)
  const searching = shouldSearch && remoteState.key !== searchKey
  const remote = remoteState.key === searchKey ? remoteState.items : []
  const searchErr = remoteState.key === searchKey ? remoteState.error : null

  useEffect(() => setDraft(query), [query])
  useEffect(() => inputRef.current?.focus(), [])

  // 有远程搜索能力时:关键词变化即请求 CMS wd= 搜索。
  useEffect(() => {
    const q = query.trim()
    if (!q || !source?.search) {
      reqId.current += 1
      setRemoteState({ key: searchKey, items: [], error: null })
      return
    }
    const id = ++reqId.current
    const timer = setTimeout(() => {
      source.search!(q)
        .then((list) => {
          if (id !== reqId.current) return
          setRemoteState({ key: searchKey, items: list, error: null })
        })
        .catch((e) => {
          if (id !== reqId.current) return
          setRemoteState({
            key: searchKey,
            items: [],
            error: e instanceof Error ? e.message : "Не удалось выполнить поиск",
          })
        })
    }, 280)
    return () => clearTimeout(timer)
  }, [query, source, searchKey])

  // Популярные запросы:从片库出现频次最高的类型里取几个,作为可点的建议词。
  const hot = useMemo(() => {
    const freq = new Map<string, number>()
    for (const t of titles)
      for (const g of t.genres) freq.set(g, (freq.get(g) ?? 0) + 1)
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([g]) => g)
  }, [titles])

  const localResults = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return titles
      .map((t) => ({ t, s: scoreOf(t, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || b.t.rating - a.t.rating)
      .map((r) => r.t)
  }, [titles, query])

  // 合并本地命中 + 远程结果(远程优先补全本地缓存没有的条目)。
  const results = useMemo(() => {
    const map = new Map<string, Title>()
    for (const t of remote) map.set(t.id, t)
    for (const t of localResults) if (!map.has(t.id)) map.set(t.id, t)
    const q = query.trim()
    return [...map.values()].sort(
      (a, b) => scoreOf(b, q) - scoreOf(a, q) || b.rating - a.rating,
    )
  }, [remote, localResults, query])

  const submit = (q: string) => {
    const trimmed = q.trim()
    onQueryChange(trimmed)
    if (trimmed) {
      const next = [trimmed, ...recent.filter((r) => r !== trimmed)].slice(
        0,
        10,
      )
      setRecent(next)
      saveRecent(next)
    }
  }

  const clearRecent = () => {
    setRecent([])
    saveRecent([])
  }

  const active = query.trim().length > 0

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 lg:px-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
        className="flex items-center gap-2 rounded-2xl border border-white/8 bg-[#0e1018] px-4 py-3 focus-within:border-[#e0142c]/50"
      >
        <SearchIcon className="h-5 w-5 shrink-0 text-[#9aa0b0]" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Название фильма, актёр, режиссёр или жанр…"
          className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-[#5a5f70] outline-none"
        />
        {draft && (
          <button
            type="button"
            onClick={() => {
              setDraft("")
              onQueryChange("")
              inputRef.current?.focus()
            }}
            className="grid h-6 w-6 place-items-center rounded-full text-[#9aa0b0] transition hover:bg-white/10 hover:text-white"
            aria-label="Очистить"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-[#e0142c] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
        >
          Найти
        </button>
      </form>

      {!active ? (
        <div className="mt-8 space-y-8">
          {recent.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-bold text-white">
                  История поиска
                </h2>
                <button
                  onClick={clearRecent}
                  className="text-xs text-[#5a5f70] transition hover:text-[#ff3b52]"
                >
                  Очистить
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <Tag key={r} label={r} onClick={() => submit(r)} />
                ))}
              </div>
            </section>
          )}

          {hot.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-1.5 font-serif text-base font-bold text-white">
                <TrendingUp className="h-4 w-4 text-[#e0142c]" /> Популярные запросы
              </h2>
              <div className="flex flex-wrap gap-2">
                {hot.map((g) => (
                  <Tag key={g} label={ruLabel(g)} onClick={() => submit(g)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : searching ? (
        <PageLoading
          compact
          label={`Ищем по всему каталогу: «${query}»`}
          detail="Объединяем результаты из каталога и внешнего источника"
        />
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-white/5 text-[#9aa0b0]">
            <SearchIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 font-serif text-xl font-bold text-white">
            По запросу «{query}» ничего не найдено
          </h2>
          <p className="mt-2 max-w-sm text-sm text-[#9aa0b0]">
            {searchErr
              ? `Ошибка поиска во внешнем источнике: ${searchErr}`
              : "Попробуйте другой запрос или выберите популярную тему ниже."}
          </p>
          {hot.length > 0 && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {hot.slice(0, 6).map((g) => (
                <Tag key={g} label={ruLabel(g)} onClick={() => submit(g)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="font-serif text-lg font-bold text-white">
              Результаты поиска: «{query}»
            </h2>
            <span className="text-sm text-[#5a5f70]">
              Найдено: {results.length}
            </span>
            {source?.search && !searching && remote.length > 0 && (
              <span className="text-xs text-[#5a5f70]">Включены результаты внешнего каталога</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {results.map((t) => (
              <PosterCard key={t.id} t={t} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}

      {!active && (
        <section className="mt-10">
          <h2 className="mb-3 font-serif text-base font-bold text-white">
            Рекомендуем фильмы с высокими оценками
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[...titles]
              .sort((a, b) => b.rating - a.rating)
              .slice(0, 5)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="group relative overflow-hidden rounded-lg ring-1 ring-white/6"
                >
                  <Img
                    src={t.backdrop}
                    alt={t.name}
                    className="aspect-[16/10] w-full transition group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute inset-x-2 bottom-2 text-left">
                    <p className="flex items-center gap-1 text-[11px] font-bold text-[#e8b23a]">
                      <IconStar className="h-3 w-3" /> {ratingLabel(t)}
                    </p>
                    <p className="truncate text-sm text-white">{t.name}</p>
                  </div>
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Tag({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs text-[#c9ccd6] transition hover:border-[#e0142c]/40 hover:bg-[#e0142c]/10 hover:text-white"
    >
      {label}
    </button>
  )
}
