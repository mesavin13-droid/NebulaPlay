import { useEffect, useRef, useState } from 'react'
import { NAV, type VideoSource } from './data'
import { IconChevron, IconSearch, Logo } from './ui'

export function TopNav({
  active,
  onNav,
  onHome,
  sources,
  currentSourceId,
  onSwitchSource,
  onManageSources,
  onSearch,
}: {
  active: string
  onNav: (label: string) => void
  onHome: () => void
  sources: VideoSource[]
  currentSourceId: string
  onSwitchSource: (id: string) => void
  onManageSources: () => void
  onSearch: (q: string) => void
}) {
  const [q, setQ] = useState('')
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#07080d]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 lg:gap-6 lg:px-8">
        <Logo onClick={onHome} />

        <SourceSwitcher
          sources={sources}
          currentId={currentSourceId}
        onSwitch={onSwitchSource}
          onManage={onManageSources}
        />

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((label) => (
            <button
              key={label}
              onClick={() => onNav(label)}
              className={`relative rounded px-3 py-2 text-[15px] transition ${
                active === label ? 'text-white' : 'text-[#9aa0b0] hover:text-white'
              }`}
            >
              {label}
              {active === label && (
                <span className="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-[#e0142c]" />
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSearch(q.trim())
            }}
            className="hidden items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-[#9aa0b0] transition focus-within:border-[#e0142c]/50 md:flex"
          >
            <button type="submit" aria-label="搜索" className="transition hover:text-white">
              <IconSearch className="h-4 w-4" />
            </button>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索影片、演员、导演"
              className="w-40 bg-transparent text-white placeholder:text-[#5a5f70] outline-none"
            />
          </form>

          <span className="hidden items-center gap-1.5 rounded-full border border-[#3fbf6a]/30 bg-[#3fbf6a]/10 px-3 py-1.5 text-sm font-medium text-[#7fe3a3] sm:flex">
            免费公益 · 无需登录
          </span>

          <button className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#e0142c] to-[#7a0a18] text-sm font-bold text-white ring-2 ring-white/10">
            星
          </button>
        </div>
      </div>
    </header>
  )
}

// 多源切换 —— 还原「多仓」那种整站换库的手感,新增合法片源即出现在这里。
function SourceSwitcher({
  sources,
  currentId,
  onSwitch,
  onManage,
}: {
  sources: VideoSource[]
  currentId: string
  onSwitch: (id: string) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = sources.find((s) => s.id === currentId) ?? sources[0]

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/5 py-1.5 pl-2.5 pr-2 text-sm text-white transition hover:border-[#e0142c]/40"
      >
        <span className="grid h-4 w-4 place-items-center rounded-sm bg-[#e0142c] text-[9px] font-bold">
          源
        </span>
        <span className="max-w-[7rem] truncate font-medium">{current?.name ?? '片源探测中…'}</span>
        <IconChevron className={`h-4 w-4 text-[#9aa0b0] transition ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-white/8 bg-[#0e1018] shadow-2xl shadow-black/60">
          <p className="border-b border-white/6 px-3 py-2 text-xs text-[#5a5f70]">选择片源（可插拔）</p>
          {/* 片源很多时(如导入 TVBox 多线路)限定固定高度,列表内部滚动,
              overscroll-contain 防止滚到底后带动整页。 */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain">
            {sources.map((s) => {
              const activeSrc = s.id === currentId
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    onSwitch(s.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${
                    activeSrc ? 'bg-[#e0142c]/10' : 'hover:bg-white/5'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                      activeSrc ? 'bg-[#e0142c] text-white' : 'bg-white/8 text-[#9aa0b0]'
                    }`}
                  >
                    {s.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate text-sm font-medium ${activeSrc ? 'text-white' : 'text-[#c9ccd6]'}`}>
                        {s.name}
                      </span>
                      <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-[#9aa0b0]">
                        {s.badge}
                      </span>
                      {s.online && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#3fbf6a]" title="远程片源" />
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[#5a5f70]">{s.tagline}</span>
                  </span>
                  {activeSrc && <span className="mt-1 text-xs text-[#ff3b52]">使用中</span>}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => {
              onManage()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 border-t border-white/6 px-3 py-2.5 text-left text-sm text-[#9aa0b0] transition hover:bg-white/5 hover:text-white"
          >
            <span className="grid h-5 w-5 place-items-center rounded bg-white/8 text-xs">＋</span>
            自定义 / 手动配置片源
          </button>
        </div>
      )}
    </div>
  )
}
