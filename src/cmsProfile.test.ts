import { describe, expect, it } from 'vitest'
import {
  cmsApiUrl,
  cmsClassesOf,
  cmsListData,
  episodeCountFromRemarks,
  isBrowserCmsSite,
  mapCmsVod,
  parseCmsPlayGroups,
  type CmsVod,
} from './cmsProfile'

describe('isBrowserCmsSite', () => {
  it('type 0/1 或未声明可用,type 3 跳过', () => {
    expect(isBrowserCmsSite({ api: 'https://x/api.php' })).toBe(true)
    expect(isBrowserCmsSite({ type: 0, api: 'https://x/api.php' })).toBe(true)
    expect(isBrowserCmsSite({ type: 1, api: 'https://x/api.php' })).toBe(true)
    expect(isBrowserCmsSite({ type: 3, api: 'https://x/api.php' })).toBe(false)
    expect(isBrowserCmsSite({ api: 'ftp://x' })).toBe(false)
    expect(isBrowserCmsSite({})).toBe(false)
  })
})

describe('cmsApiUrl', () => {
  it('保留已有 query 并编码参数', () => {
    const url = cmsApiUrl('https://x/api.php?ac=list', { t: '电影', pg: 2 })
    expect(url).toBe('https://x/api.php?ac=list&t=%E7%94%B5%E5%BD%B1&pg=2')
  })
})

describe('cmsClassesOf', () => {
  it('兼容数组、XML 单条对象与嵌套 wrapper', () => {
    expect(cmsClassesOf({ class: [{ type_id: 1, type_name: '电影' }] })).toHaveLength(1)
    expect(cmsClassesOf({ class: { item: { type_id: '1', type_name: '电影' } } })).toHaveLength(1)
    expect(cmsClassesOf({ rss: { class: { item: [{ type_id: 2, type_name: '剧集' }] } } })).toHaveLength(1)
    expect(cmsClassesOf({ class: [{ type_id: 1, type_name: '' }] })).toHaveLength(0)
  })
})

describe('cmsListData', () => {
  const vod = (id: number) => ({ vod_id: id, vod_name: `片${id}` })

  it('JSON 直接取 list 数组', () => {
    expect(cmsListData({ list: [vod(1)] })).toEqual([vod(1)])
    expect(cmsListData([vod(1)])).toEqual([vod(1)])
  })

  it('XML 根节点展开后单条 item 归一为数组', () => {
    const data = { list: { item: vod(9) } }
    expect(cmsListData(data)).toEqual([vod(9)])
  })

  it('XML 多条 item 保持数组,兼容 rss / channel wrapper', () => {
    expect(cmsListData({ list: { item: [vod(1), vod(2)] } })).toEqual([vod(1), vod(2)])
    expect(cmsListData({ rss: { list: { item: [vod(3)] } } })).toEqual([vod(3)])
    expect(cmsListData({ rss: { channel: { item: [vod(4)] } } })).toEqual([vod(4)])
  })

  it('无内容返回 null', () => {
    expect(cmsListData({})).toBeNull()
    expect(cmsListData(null)).toBeNull()
  })
})

describe('mapCmsVod', () => {
  it('完整映射,图片可注入改写策略', () => {
    const t = mapCmsVod(
      {
        vod_id: '9',
        vod_name: '测试片',
        vod_pic: '//cdn/x.jpg',
        vod_year: '2024',
        vod_score: '8.8',
        vod_remarks: '1080P',
        vod_area: '中国大陆',
        vod_content: '<p>简介<em>文本</em></p>',
        vod_actor: '张三、李四',
        type_name: '电影',
      },
      { posterUrl: (u) => `/proxy?u=${u}` },
    )
    expect(t).toMatchObject({
      id: 'v9',
      name: '测试片',
      poster: '/proxy?u=https://cdn/x.jpg',
      year: 2024,
      rating: 8.8,
      quality: '1080P',
      region: '中国大陆',
      genres: ['电影'],
      synopsis: '简介文本',
      cast: ['张三', '李四'],
    })
  })

  it('缺失 vod_id 返回 null,评分/年份非法时回退', () => {
    expect(mapCmsVod({} as CmsVod)).toBeNull()
    const t = mapCmsVod({ vod_id: 1, vod_year: 'abc', vod_score: '0' })!
    expect(t.year).toBe(new Date().getFullYear())
    expect(t.rating).toBe(7.5)
  })

  it('剧集优先采用 remarks 集数,推断不出时保留 99 占位', () => {
    const drama = (vod_remarks: string) =>
      mapCmsVod({ vod_id: 2, vod_name: '剧', vod_remarks, type_name: '大陆剧' })!
    expect(drama('第14集')).toMatchObject({ episodes: 14, airedEpisodes: 14 })
    expect(drama('更新至36集')).toMatchObject({ episodes: 36, airedEpisodes: 36 })
    expect(drama('全40集')).toMatchObject({ episodes: 40, airedEpisodes: 40 })
    expect(drama('26集全')).toMatchObject({ episodes: 26, airedEpisodes: 26 })
    expect(drama('HD')).toMatchObject({ episodes: 99, airedEpisodes: 99 })
    expect(drama('')).toMatchObject({ episodes: 99, airedEpisodes: 99 })
  })

  it('电影不受 remarks 集数影响', () => {
    const t = mapCmsVod({ vod_id: 3, vod_name: '片', vod_remarks: '第14集', type_name: '电影' })!
    expect(t).toMatchObject({ episodes: 1, airedEpisodes: 1 })
  })
})

describe('episodeCountFromRemarks', () => {
  it('识别常见集数写法', () => {
    expect(episodeCountFromRemarks('第14集')).toEqual({ total: 14, aired: 14 })
    expect(episodeCountFromRemarks('更新至14集')).toEqual({ total: 14, aired: 14 })
    expect(episodeCountFromRemarks('全36集')).toEqual({ total: 36, aired: 36 })
    expect(episodeCountFromRemarks('共108集')).toEqual({ total: 108, aired: 108 })
    expect(episodeCountFromRemarks('12集全')).toEqual({ total: 12, aired: 12 })
    expect(episodeCountFromRemarks('更新至08期')).toEqual({ total: 8, aired: 8 })
  })

  it('日期期数与无集数写法返回 null', () => {
    expect(episodeCountFromRemarks('第20240801期')).toBeNull()
    expect(episodeCountFromRemarks('HD')).toBeNull()
    expect(episodeCountFromRemarks('1080P')).toBeNull()
    expect(episodeCountFromRemarks('')).toBeNull()
  })
})

describe('parseCmsPlayGroups', () => {
  it('解析多线路与集数,过滤非 http 地址', () => {
    const { from, groups } = parseCmsPlayGroups(
      '第1集$https://a/1.m3u8#第2集$https://a/2.m3u8#坏$javascript:void(0)$$$正片$https://b/1.mp4',
      '线路一$$$线路二',
    )
    expect(from).toEqual(['线路一', '线路二'])
    expect(groups).toEqual([
      [
        { label: '第1集', url: 'https://a/1.m3u8' },
        { label: '第2集', url: 'https://a/2.m3u8' },
      ],
      [{ label: '正片', url: 'https://b/1.mp4' }],
    ])
  })

  it('没有 $ 分隔时整段视为正片地址', () => {
    const { groups } = parseCmsPlayGroups('https://a/movie.mp4', '')
    expect(groups).toEqual([[{ label: '正片', url: 'https://a/movie.mp4' }]])
  })
})
