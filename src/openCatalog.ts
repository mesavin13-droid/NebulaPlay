import {
  deriveFilters,
  deriveRanking,
  deriveTrend,
  NAV,
  type Title,
  type VideoSource,
} from "./data"

// Стартовая подборка: только фильм с опубликованной лицензией CC BY 3.0.
// Воспроизведение идёт с официального каталога демо-фильмов Blender.
const BIG_BUCK_BUNNY: Title = {
  id: "open-big-buck-bunny",
  name: "Большой Бак (Big Buck Bunny)",
  sub: "Открытый короткометражный мультфильм",
  poster: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg",
  backdrop: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg",
  year: 2008,
  rating: 0,
  ratingKnown: false,
  genres: ["Анимация", "Комедия", "Короткометражный фильм"],
  region: "Нидерланды",
  quality: "HD",
  episodes: 1,
  airedEpisodes: 1,
  latest: "Полный фильм",
  synopsis:
    "Открытый мультфильм Blender Foundation. Лицензия Creative Commons Attribution 3.0 (CC BY 3.0): разрешено распространение и коммерческое использование при соблюдении атрибуции. При показе полного фильма необходимо сохранить финальные титры. Правообладатель: Blender Foundation. Официальная информация о лицензии: https://peach.blender.org/about/",
  cast: ["Blender Foundation"],
  playUrl:
    "https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4",
}

const TITLES = [BIG_BUCK_BUNNY]

export const OPEN_MOVIES_SOURCE: VideoSource = {
  id: "open-movies-cc-by",
  name: "Открытое кино · CC BY",
  badge: "CC BY 3.0",
  tagline: "Подборка с опубликованной лицензией и указанием правообладателя",
  online: false,
  nav: NAV,
  get filters() {
    return deriveFilters(TITLES)
  },
  async loadCatalog() {
    return TITLES
  },
  async loadHero() {
    return TITLES[0]
  },
  async loadRanking() {
    return deriveRanking(TITLES)
  },
  async loadHistory() {
    return []
  },
  async loadDetail(id) {
    return TITLES.find((title) => title.id === id)
  },
  async loadRatingTrend(id) {
    const title = TITLES.find((item) => item.id === id)
    return title ? deriveTrend(title) : []
  },
  async loadPlayUrl(id) {
    return TITLES.find((title) => title.id === id)?.playUrl ?? TITLES[0].playUrl!
  },
  async loadPlaySources(id) {
    const title = TITLES.find((item) => item.id === id) ?? TITLES[0]
    return [{ label: "Официальный файл · 320×180", url: title.playUrl! }]
  },
}
