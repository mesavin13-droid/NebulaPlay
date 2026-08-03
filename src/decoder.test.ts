import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyBadContent, decodeResponse, fetchDecoded, parseTolerantJson } from './decoder'

const RSS_XML = [
  '<?xml version="1.0"?><rss version="2.0">',
  '<list><item><vod_id>9</vod_id><vod_name>测试片</vod_name>',
  '<vod_play_url>第1集$https://a/1.m3u8</vod_play_url></item>',
  '<item><vod_id>10</vod_id><vod_name>第二部</vod_name></item></list>',
  '</rss>',
].join('')

afterEach(() => {
  vi.useRealTimers()
})

describe('parseTolerantJson', () => {
  it('解析带 BOM / 注释 / 尾逗号 / 字符串内控制字符的配置', () => {
    const j = parseTolerantJson('\uFEFF// 说明\n{ "urls": [ { "name": "A", "url": "https://a", }, ], }')
    expect(j.urls).toEqual([{ name: 'A', url: 'https://a' }])
  })

  it('前面有说明文字时从第一个 { 或 [ 开始重试', () => {
    expect(parseTolerantJson('说明文字 { "list": [1] }')).toEqual({ list: [1] })
  })
})

describe('decodeResponse', () => {
  it('自动识别 JSON', () => {
    const doc = decodeResponse('{ "list": [ { "vod_id": 1 } ] }')
    expect(doc.kind).toBe('json')
    expect(doc.data).toEqual({ list: [{ vod_id: 1 }] })
  })

  it('自动识别 XML 并把根节点展开为子对象', () => {
    const doc = decodeResponse(RSS_XML)
    expect(doc.kind).toBe('xml')
    expect(doc.data).toEqual({
      '@version': '2.0',
      list: {
        item: [
          { vod_id: '9', vod_name: '测试片', vod_play_url: '第1集$https://a/1.m3u8' },
          { vod_id: '10', vod_name: '第二部' },
        ],
      },
    })
  })

  it('空响应与加密配置给出可读错误', () => {
    expect(() => decodeResponse('')).toThrow(/没有返回任何内容/)
    expect(() => decodeResponse('$#encrypted-abc')).toThrow(/加密配置/)
  })
})

describe('classifyBadContent', () => {
  it('识别网页 / 空响应 / 加密配置', () => {
    expect(classifyBadContent('<html><body></body></html>')).toContain('网页')
    expect(classifyBadContent('  ')).toContain('没有返回任何内容')
    expect(classifyBadContent('a'.repeat(70))).toContain('加密配置')
  })
})

describe('fetchDecoded', () => {
  it('成功时返回解码后的文档', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => '{"list":[1]}' }) as unknown as Response,
    )
    const doc = await fetchDecoded('https://x/api', { fetchImpl: fetchImpl as typeof fetch })
    expect(doc.data).toEqual({ list: [1] })
  })

  it('HTTP 非 2xx 抛出状态码', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 500, text: async () => '' }) as unknown as Response,
    )
    await expect(fetchDecoded('https://x/api', { fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(
      'HTTP 500',
    )
  })

  it('超时给出可读错误', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )
    const assertion = expect(
      fetchDecoded('https://slow', {
        timeoutMs: 50,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(60)
    await assertion
  })
})
