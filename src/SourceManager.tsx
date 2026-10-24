import { useState } from 'react'
import type { CustomSourceConfig, Title } from './data'
import { normalizeTitles } from './data'
import { removeCustomSource, saveCustomSource, useCustomSourceConfigs } from './customSources'
import { fetchTvboxLines, type TvboxLine } from './tvbox'

// 手动配置片源的面板 —— 支持直链、JSON 片库、TVBox 与旧 CMS API 请求契约。
export function SourceManager({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const configs = useCustomSourceConfigs()
  const [editing, setEditing] = useState<CustomSourceConfig | null>(null)
  const [mode, setMode] = useState<'list' | 'form'>('list')

  const openForm = (cfg: CustomSourceConfig | null) => {
    setEditing(cfg)
    setMode('form')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="mt-[6vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0e1018] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h2 className="font-serif text-lg font-bold text-white">Мои источники</h2>
            <p className="text-xs text-[#5a5f70]">Настройте адрес источника вручную</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-lg text-[#9aa0b0] transition hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>

        {mode === 'list' ? (
          <>
            <SourceList
              configs={configs}
              onAdd={() => openForm(null)}
              onEdit={openForm}
              onRemove={removeCustomSource}
            />
            <TvboxImport configs={configs} onImported={onSaved} />
          </>
        ) : (
          <SourceForm
            initial={editing}
            onCancel={() => setMode('list')}
            onSubmit={(cfg) => {
              const id = saveCustomSource(cfg)
              onSaved(id)
              setMode('list')
            }}
          />
        )}
      </div>
    </div>
  )
}

function SourceList({
  configs,
  onAdd,
  onEdit,
  onRemove,
}: {
  configs: CustomSourceConfig[]
  onAdd: () => void
  onEdit: (cfg: CustomSourceConfig) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="p-5">
      {configs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-[#5a5f70]">
          Пользовательских источников пока нет. Нажмите «Добавить источник» и вставьте разрешённую ссылку на каталог или видео.
        </p>
      ) : (
        <ul className="space-y-2">
          {configs.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-white/6 bg-[#14161f] px-4 py-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e0142c]/15 text-sm font-bold text-[#ff3b52]">
                {c.name.slice(0, 1) || 'И'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                  {c.name}
                  {c.kind === 'tvbox' && (
                    <span className="shrink-0 rounded bg-[#e8b23a]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#e8b23a]">
                      TVBox
                    </span>
                  )}
                  {c.kind === 'cms-api' && (
                    <span className="shrink-0 rounded bg-[#5c8dff]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#7aa2ff]">
                      Совместимый API
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-[#5a5f70]">
                  {c.catalogUrl || c.fallbackPlayUrl || c.tagline || 'Встроенный каталог'}
                </p>
              </div>
              <button
                onClick={() => onEdit(c)}
                className="rounded-lg px-3 py-1.5 text-xs text-[#9aa0b0] transition hover:bg-white/5 hover:text-white"
              >
                Изменить
              </button>
              <button
                onClick={() => onRemove(c.id)}
                className="rounded-lg px-3 py-1.5 text-xs text-[#9aa0b0] transition hover:bg-[#e0142c]/15 hover:text-[#ff3b52]"
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onAdd}
        className="mt-4 w-full rounded-xl bg-[#e0142c] py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
      >
        ＋ Добавить источник
      </button>
    </div>
  )
}

// 用户本次要接入的 TVBox 多线路订阅(肥猫等多仓聚合),预填在这里方便一键导入。
const DEFAULT_TVBOX_SUB = ''

// 导入 TVBox 多线路订阅:拉取 urls 列表,勾选后批量存为自定义 TVBox 线路。
function TvboxImport({
  configs,
  onImported,
}: {
  configs: CustomSourceConfig[]
  onImported: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(DEFAULT_TVBOX_SUB)
  const [lines, setLines] = useState<TvboxLine[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pull = async () => {
    if (!url.trim()) return setError('Введите адрес подписки.')
    setBusy(true)
    setError(null)
    setLines(null)
    try {
      const list = await fetchTvboxLines(url.trim())
      setLines(list)
      // 已导入过的线路默认不勾选,避免重复。
      const existing = new Set(configs.map((c) => c.catalogUrl))
      setChecked(new Set(list.filter((l) => !existing.has(l.url)).map((l) => l.url)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить подписку')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (u: string) =>
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(u)) next.delete(u)
      else next.add(u)
      return next
    })

  const importSelected = () => {
    if (!lines) return
    const existing = new Set(configs.map((c) => c.catalogUrl))
    let first: string | null = null
    for (const l of lines) {
      if (!checked.has(l.url) || existing.has(l.url)) continue
      const id = saveCustomSource({
        kind: 'tvbox',
        name: l.name || 'Линия TVBox',
        tagline: 'Подписка на несколько линий TVBox',
        catalogUrl: l.url,
      })
      first ??= id
    }
    if (first) onImported(first)
  }

  const selectedCount = lines?.filter((l) => checked.has(l.url)).length ?? 0

  return (
    <div className="border-t border-white/8 p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className={`text-[#9aa0b0] transition ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="text-sm font-medium text-[#c9ccd6]">Импорт подписки TVBox</span>
        <span className="text-[11px] text-[#5a5f70]">Импорт нескольких источников за один раз</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/tvboxmuti.json"
              className="min-w-0 flex-1 rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-xs text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
            />
            <button
              onClick={pull}
              disabled={busy}
              className="shrink-0 rounded-lg bg-white/8 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              {busy ? 'Загрузка…' : 'Получить список'}
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-[#e0142c]/30 bg-[#e0142c]/10 px-3 py-2 text-xs text-[#ff8a9a]">
              {error}
            </p>
          )}

          {lines && (
            <>
              <ul className="no-scrollbar max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/6 bg-[#14161f] p-2">
                {lines.map((l) => (
                  <li key={l.url}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={checked.has(l.url)}
                        onChange={() => toggle(l.url)}
                        className="h-3.5 w-3.5 shrink-0 accent-[#e0142c]"
                      />
                      <span className="min-w-0 flex-1 truncate text-[#c9ccd6]">{l.name || l.url}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                onClick={importSelected}
                disabled={selectedCount === 0}
                className="w-full rounded-lg bg-[#e0142c] py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52] disabled:opacity-40"
              >
                Импортировать выбранные источники ({selectedCount})
              </button>
              <p className="text-[11px] leading-relaxed text-[#5a5f70]">
                Важно: в браузере поддерживаются только интерфейсы CMS. Источники с закрытым протоколом spider пропускаются. Запросы проходят через настроенный прокси.

              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SourceForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: CustomSourceConfig | null
  onCancel: () => void
  onSubmit: (cfg: Omit<CustomSourceConfig, 'id'> & { id?: string }) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<'json' | 'cms-api'>(initial?.kind === 'cms-api' ? 'cms-api' : 'json')
  const [tagline, setTagline] = useState(initial?.tagline ?? '')
  const [catalogUrl, setCatalogUrl] = useState(initial?.catalogUrl ?? '')
  const [detailUrl, setDetailUrl] = useState(initial?.detailUrl ?? '')
  const [fallbackPlayUrl, setFallbackPlayUrl] = useState(initial?.fallbackPlayUrl ?? '')
  const [json, setJson] = useState(initial?.titles ? JSON.stringify(initial.titles, null, 2) : '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    if (!name.trim()) return setError('Укажите название источника.')

    const effectiveKind = initial?.kind === 'tvbox' ? 'tvbox' : kind === 'cms-api' ? 'cms-api' : undefined
    if (effectiveKind === 'cms-api') {
      if (!catalogUrl.trim()) return setError('Укажите полный адрес CMS API.')
      try {
        new URL(catalogUrl.trim())
        if (detailUrl.trim()) new URL(detailUrl.trim())
      } catch {
        return setError('Неверный формат адреса API.')
      }
      onSubmit({
        id: initial?.id,
        kind: 'cms-api',
        name: name.trim(),
        tagline: tagline.trim() || undefined,
        catalogUrl: catalogUrl.trim(),
        detailUrl: detailUrl.trim() || undefined,
      })
      return
    }

    let titles: Title[] | undefined
    if (json.trim()) {
      try {
        const parsed = JSON.parse(json)
        titles = normalizeTitles(Array.isArray(parsed) ? parsed : (parsed?.list ?? parsed?.data ?? []), fallbackPlayUrl.trim() || undefined)
        if (!titles.length) return setError('В JSON не найдено ни одного фильма.')
      } catch {
        return setError('Проверьте формат JSON.')
      }
    }

    if (!catalogUrl.trim() && !fallbackPlayUrl.trim() && !titles) {
      return setError('Укажите адрес каталога, прямую ссылку на видео или JSON с фильмами.')
    }

    // 只填直链、没有片库时，自动合成一部单片，播放器即可直接播放。
    if (!catalogUrl.trim() && !titles && fallbackPlayUrl.trim()) {
      titles = normalizeTitles(
        [{ id: 'single', name: name.trim(), playUrl: fallbackPlayUrl.trim(), synopsis: tagline.trim() || 'Фильм добавлен вручную.' }],
        fallbackPlayUrl.trim(),
      )
    }

    onSubmit({
      id: initial?.id,
      kind: effectiveKind, // 保留 TVBox 线路标记,避免Изменить后退回通用解析
      name: name.trim(),
      tagline: tagline.trim() || undefined,
      catalogUrl: catalogUrl.trim() || undefined,
      fallbackPlayUrl: fallbackPlayUrl.trim() || undefined,
      titles,
    })
  }

  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
      {initial?.kind !== 'tvbox' && (
        <Field label="Способ подключения">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as 'json' | 'cms-api')}
            className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white outline-none focus:border-[#e0142c]/50"
          >
            <option value="json">Каталог JSON / прямая ссылка</option>
            <option value="cms-api">Подключение к CMS API</option>
          </select>
        </Field>
      )}

      <Field label="Название источника" required>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Мой каталог"
          className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
      </Field>

      <Field label="Краткое описание">
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Необязательно: будет показано в списке источников"
          className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
      </Field>

      <Field
        label={kind === 'cms-api' ? 'Полный адрес CMS API' : 'Адрес каталога JSON'}
        hint={kind === 'cms-api' ? 'Например: https://example.com/api.php/provide/vod/' : 'Адрес API, возвращающего список фильмов'}
      >
        <input
          value={catalogUrl}
          onChange={(e) => setCatalogUrl(e.target.value)}
          placeholder={kind === 'cms-api' ? 'https://example.com/api.php/provide/vod/' : 'https://example.com/catalog.json'}
          className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
      </Field>

      {kind === 'cms-api' && (
        <Field label="Базовый адрес сайта с описаниями HTML" hint="Необязательно. Для дополнительной загрузки описаний">
          <input
            value={detailUrl}
            onChange={(event) => setDetailUrl(event.target.value)}
            placeholder="https://example.com"
            className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
          />
        </Field>
      )}

      {kind !== 'cms-api' && <Field label="Прямая ссылка на видео" hint="Ссылка на MP4, WebM или M3U8; также используется, если в каталоге нет ссылки">
        <input
          value={fallbackPlayUrl}
          onChange={(e) => setFallbackPlayUrl(e.target.value)}
          placeholder="https://example.com/movie.mp4"
          className="w-full rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 text-sm text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
      </Field>}

      {kind !== 'cms-api' && <Field label="JSON-каталог (для опытных пользователей)" hint="Вставьте массив фильмов. Он будет использоваться вместо адреса каталога">
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={5}
          placeholder='[{ "name": "Пример фильма", "playUrl": "https://.../video.mp4", "poster": "https://.../poster.jpg" }]'
          className="w-full resize-y rounded-lg border border-white/8 bg-[#14161f] px-3 py-2 font-mono text-xs text-white placeholder:text-[#5a5f70] outline-none focus:border-[#e0142c]/50"
        />
      </Field>}

      {error && (
        <p className="rounded-lg border border-[#e0142c]/30 bg-[#e0142c]/10 px-3 py-2 text-xs text-[#ff8a9a]">
          {error}
        </p>
      )}

      <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-[#5a5f70]">
        Примечание: запросы к CMS API идут через прокси и поддерживают customApi, customDetail и useDetail.
      </p>

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          className="flex-1 rounded-lg bg-[#e0142c] py-2.5 text-sm font-bold text-white transition hover:bg-[#ff3b52]"
        >
          Сохранить
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-5 py-2.5 text-sm text-[#9aa0b0] transition hover:bg-white/5 hover:text-white"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#c9ccd6]">
        {label}
        {required && <span className="text-[#ff3b52]">*</span>}
        {hint && <span className="text-[11px] font-normal text-[#5a5f70]">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
