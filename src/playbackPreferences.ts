export const PLAYBACK_PREFERENCES_KEY = "nebulaplay:playback-preferences:v1"

export type PlaybackPreferences = {
  autoNext: boolean
  skipIntro: boolean
  introSeconds: number
  skipOutro: boolean
  outroSeconds: number
}

export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  autoNext: true,
  skipIntro: false,
  introSeconds: 90,
  skipOutro: false,
  outroSeconds: 90,
}

const normalizeSeconds = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(600, Math.max(0, Math.round(parsed)))
    : fallback
}

export function normalizePlaybackPreferences(
  value: unknown,
): PlaybackPreferences {
  const input =
    value && typeof value === "object"
      ? value as Partial<PlaybackPreferences>
      : {}
  return {
    autoNext:
      typeof input.autoNext === "boolean"
        ? input.autoNext
        : DEFAULT_PLAYBACK_PREFERENCES.autoNext,
    skipIntro:
      typeof input.skipIntro === "boolean"
        ? input.skipIntro
        : DEFAULT_PLAYBACK_PREFERENCES.skipIntro,
    introSeconds: normalizeSeconds(
      input.introSeconds,
      DEFAULT_PLAYBACK_PREFERENCES.introSeconds,
    ),
    skipOutro:
      typeof input.skipOutro === "boolean"
        ? input.skipOutro
        : DEFAULT_PLAYBACK_PREFERENCES.skipOutro,
    outroSeconds: normalizeSeconds(
      input.outroSeconds,
      DEFAULT_PLAYBACK_PREFERENCES.outroSeconds,
    ),
  }
}

export function loadPlaybackPreferences(): PlaybackPreferences {
  try {
    const raw = localStorage.getItem(PLAYBACK_PREFERENCES_KEY)
    return normalizePlaybackPreferences(raw ? JSON.parse(raw) : undefined)
  } catch {
    return DEFAULT_PLAYBACK_PREFERENCES
  }
}

export function savePlaybackPreferences(value: PlaybackPreferences) {
  const normalized = normalizePlaybackPreferences(value)
  try {
    localStorage.setItem(PLAYBACK_PREFERENCES_KEY, JSON.stringify(normalized))
  } catch {
    /* 隐私模式 / 配额已满时仅失去偏好持久化 */
  }
  return normalized
}
