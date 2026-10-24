/**
 * Russian labels for navigation and interface values returned by common catalog APIs.
 * Film titles, people names, descriptions, and user-defined source names are not rewritten.
 */
const LABELS: Record<string, string> = {
  "首页": "Главная",
  "电影": "Фильмы",
  "剧集": "Сериалы",
  "电视剧": "Сериалы",
  "动漫": "Аниме",
  "动画": "Анимация",
  "综艺": "Шоу",
  "纪录片": "Документальные",
  "我的片单": "Мой список",
  "观看历史": "История просмотров",
  "我的收藏": "Избранное",
  "推荐": "Рекомендуем",
  "经典重温": "Классика",
  "为你推荐": "Рекомендации для вас",
  "最热": "Популярное",
  "最新": "Новинки",
  "评分最高": "По рейтингу",
  "好评优先": "Лучшие оценки",
  "全部": "Все",
  "更早": "Ранее",
  "类型": "Жанр",
  "地区": "Страна",
  "年份": "Год",
  "排序": "Сортировка",
  "热播": "В эфире",
  "好评": "Высокие оценки",
  "新番": "Новинки",
  "选集": "Серии",
  "简介": "Описание",
  "评论": "Отзывы",
  "标清": "Стандартное качество",
  "高清": "Высокое качество",
  "超清": "Очень высокое качество",
  "超高清": "Очень высокое качество",
  "蓝光": "Blu-ray",
  "自动": "Авто",
  "清晰度": "Качество",
  "源": "Источник",
  "自定义": "Свой",
  "精选": "Подборка",
  "公有领域": "Общественное достояние",
  "全部分类": "Все категории",
  "其他": "Другое",
  "未知": "Неизвестно",
  "默认": "По умолчанию",
  "正片": "Полный фильм",
  "多线路订阅": "Подписка на несколько источников",
  "自动选择可用站点": "Автоматический выбор доступного источника",
  "中国大陆": "Китай",
  "中国香港": "Гонконг",
  "中国台湾": "Тайвань",
  "中国澳门": "Макао",
  "美国": "США",
  "韩国": "Южная Корея",
  "日本": "Япония",
  "英国": "Великобритания",
  "法国": "Франция",
  "泰国": "Таиланд",
  "印度": "Индия",
  "新加坡": "Сингапур",
  "德国": "Германия",
  "加拿大": "Канада",
  "俄罗斯": "Россия",
  "澳大利亚": "Австралия",
  "全片": "Полный фильм",
  "动作": "Боевики",
  "喜剧": "Комедии",
  "爱情": "Мелодрамы",
  "科幻": "Фантастика",
  "恐怖": "Ужасы",
  "悬疑": "Детективы",
  "惊悚": "Триллеры",
  "战争": "Военные",
  "犯罪": "Криминал",
  "冒险": "Приключения",
  "家庭": "Семейные",
  "剧情": "Драмы",
  "音乐": "Музыкальные",
  "运动": "Спорт",
  "体育": "Спорт",
  "历史": "Исторические",
  "儿童": "Детские",
  "青春": "Молодёжные",
  "奇幻": "Фэнтези",
  "玄幻": "Фэнтези",
  "武侠": "Уся",
  "真人秀": "Реалити-шоу",
  "脱口秀": "Ток-шоу",
  "短剧": "Короткие сериалы",
  "连续剧": "Сериалы",
  "国产剧": "Китайские сериалы",
  "港台剧": "Сериалы Гонконга и Тайваня",
  "欧美剧": "Западные сериалы",
  "日韩剧": "Японские и корейские сериалы",
  "意大利": "Италия",
  "西班牙": "Испания",
};

export function ruLabel(value: string): string {
  if (LABELS[value]) return LABELS[value]
  if (/[\/、,，·]/.test(value)) {
    const parts = value.split(/[\/、,，·]/).map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1 && parts.some((part) => LABELS[part])) {
      return parts.map((part) => LABELS[part] ?? part).join(" / ")
    }
  }
  const episodeUpdate = value.match(/更新至第?\s*([0-9]+)\s*集/)
  if (episodeUpdate) return "Обновление до серии " + episodeUpdate[1]
  const episodeNumber = value.match(/第\s*([0-9]+)\s*集/)
  if (episodeNumber) return "Серия " + episodeNumber[1]
  const episodeCount = value.match(/全\s*([0-9]+)\s*集/)
  if (episodeCount) return "Всего серий: " + episodeCount[1]
  if (/完结|已完结|已结束/.test(value)) return "Завершён"
  if (/更新中/.test(value)) return "Выходит"
  if (/待更新|未更新|即将更新/.test(value)) return "Скоро"
  const lineNumber = value.match(/^线路\s*(\d+)$/)
  if (lineNumber) return "Источник " + lineNumber[1]
  if (/多线路订阅/.test(value) && /自动选择可用站点/.test(value)) {
    return "Подписка на несколько источников · автоматический выбор доступного"
  }
  if (/多线路订阅/.test(value)) return "Подписка на несколько источников"
  if (/自动选择可用站点/.test(value)) return "Автоматический выбор доступного источника"
  if (/中国大陆/.test(value)) return value.replace(/中国大陆/g, "Китай")
  if (/中国香港/.test(value)) return value.replace(/中国香港/g, "Гонконг")
  if (/中国台湾/.test(value)) return value.replace(/中国台湾/g, "Тайвань")
  if (/美国/.test(value)) return value.replace(/美国/g, "США")
  if (/英国/.test(value)) return value.replace(/英国/g, "Великобритания")
  if (/日本/.test(value)) return value.replace(/日本/g, "Япония")
  if (/韩国/.test(value)) return value.replace(/韩国/g, "Южная Корея")
  if (/法国/.test(value)) return value.replace(/法国/g, "Франция")
  if (/德国/.test(value)) return value.replace(/德国/g, "Германия")
  if (/印度/.test(value)) return value.replace(/印度/g, "Индия")
  if (/泰国/.test(value)) return value.replace(/泰国/g, "Таиланд")
  if (/俄罗斯/.test(value)) return value.replace(/俄罗斯/g, "Россия")
  if (/意大利/.test(value)) return value.replace(/意大利/g, "Италия")
  if (/西班牙/.test(value)) return value.replace(/西班牙/g, "Испания")
  if (/加拿大/.test(value)) return value.replace(/加拿大/g, "Канада")
  if (/澳大利亚/.test(value)) return value.replace(/澳大利亚/g, "Австралия")
  if (/新加坡/.test(value)) return value.replace(/新加坡/g, "Сингапур")
  if (/纪录/.test(value)) return "Документальные"
  if (/动漫|动画|番剧|漫画/.test(value)) return "Аниме"
  if (/综艺|真人秀|脱口秀/.test(value)) return "Шоу"
  if (/电影|影片/.test(value)) return "Фильмы"
  if (/电视剧|连续剧|短剧|剧集|剧/.test(value)) return "Сериалы"
  if (/动作/.test(value)) return "Боевики"
  if (/喜剧/.test(value)) return "Комедии"
  if (/爱情/.test(value)) return "Мелодрамы"
  if (/科幻|奇幻|玄幻/.test(value)) return "Фантастика"
  if (/恐怖/.test(value)) return "Ужасы"
  if (/悬疑/.test(value)) return "Детективы"
  if (/惊悚/.test(value)) return "Триллеры"
  if (/战争/.test(value)) return "Военные"
  if (/犯罪/.test(value)) return "Криминал"
  if (/冒险/.test(value)) return "Приключения"
  if (/家庭/.test(value)) return "Семейные"
  if (/剧情/.test(value)) return "Драмы"
  if (/音乐/.test(value)) return "Музыкальные"
  if (/运动|体育/.test(value)) return "Спорт"
  if (/历史/.test(value)) return "Исторические"
  if (/儿童/.test(value)) return "Детские"
  if (/青春/.test(value)) return "Молодёжные"
  return /[\u3400-\u9fff]/.test(value) ? "Без перевода" : value
}


/**
 * Translate technical errors from common Chinese-language catalogue APIs before
 * showing them in the Russian interface. Unknown Chinese error text is replaced
 * with a useful Russian fallback rather than leaking untranslated UI copy.
 */
export function ruMessage(message: string | null | undefined): string {
  const value = (message ?? "").trim()
  if (!value) return "Произошла неизвестная ошибка."
  if (!/[\u3400-\u9fff]/.test(value)) return value

  const line = value.match(/线路「([^」]+)」/)
  const source = value.match(/片源「([^」]+)」/)
  const status = value.match(/(?:API请求失败|API 请求失败)[:： ]*([0-9]{3})/)

  if (/订阅内容里没有可用线路|urls 为空/.test(value)) return "В подписке нет доступных источников."
  if (/所有站点均无法访问|站点均无法访问|线路.*无法访问/.test(value)) {
    return line ? `Источник «${line[1]}» недоступен. Проверьте адрес и подключение.` : "Источники недоступны. Проверьте адреса и подключение."
  }
  if (/没有可用的 CMS 接口|没有可用的 CMS接口/.test(value)) {
    return line ? `У источника «${line[1]}» нет поддерживаемого интерфейса CMS.` : "У источника нет поддерживаемого интерфейса CMS."
  }
  if (/目录加载超时/.test(value)) return source ? `Истекло время ожидания загрузки каталога «${source[1]}».` : "Истекло время ожидания загрузки каталога."
  if (/片源加载失败|片库加载失败/.test(value)) return "Не удалось загрузить каталог. Проверьте источник и повторите попытку."
  if (status) return `Ошибка запроса к API: HTTP ${status[1]}.`
  if (/API请求失败/.test(value)) return "Не удалось выполнить запрос к API."
  if (/API返回的数据格式无效|API返回的数据格式/.test(value)) return "API вернул данные в неподдерживаемом формате."
  if (/端点没有返回任何内容|响应内容为空/.test(value)) return "Источник не вернул данных. Проверьте адрес."
  if (/端点返回了网页而不是配置/.test(value)) return "По этому адресу открывается веб-страница, а не файл конфигурации."
  if (/加密配置.*浏览器无法解密/.test(value)) return "Это зашифрованная конфигурация TVBox. Браузер не может её прочитать."
  if (/XML 解析失败|XML解析失败/.test(value)) return "Не удалось разобрать XML-конфигурацию."
  if (/配置格式无法解析|格式有误/.test(value)) return "Не удалось разобрать данные. Проверьте формат конфигурации."
  if (/请求超时/.test(value)) return "Истекло время ожидания запроса."
  if (/缺少搜索参数/.test(value)) return "Не указан поисковый запрос."
  if (/无效的视频ID|无效的视频 ID/.test(value)) return "Некорректный идентификатор видео."
  if (/没有可播放线路/.test(value)) return "Нет доступных источников для воспроизведения."
  if (/详情加载失败|获取到的详情内容无效/.test(value)) return "Не удалось загрузить информацию о фильме."
  if (/未命名/.test(value)) return "Без названия"
  return "Не удалось выполнить запрос к источнику. Проверьте адрес и формат данных."
}
