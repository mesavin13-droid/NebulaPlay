import type Player from 'video.js/dist/types/player'

export type VideoJsSource = { src: string; type?: string }

export type VideoJsQualityLevel = {
  id: string
  width?: number
  height?: number
  bitrate?: number
  enabled: boolean
}

export type VideoJsQualityLevelList = {
  readonly length: number
  readonly selectedIndex: number
  [index: number]: VideoJsQualityLevel
  on: (event: string, listener: () => void) => void
  off: (event: string, listener: () => void) => void
}

type PlayerWithQualityLevels = Player & {
  qualityLevels?: () => VideoJsQualityLevelList
}

export function videoJsSource(url: string): VideoJsSource {
  if (/\.m3u8(?:$|[?#])/i.test(url) || /%2fm3u8|%2em3u8/i.test(url)) {
    return { src: url, type: 'application/x-mpegURL' }
  }
  if (/\.webm(?:$|[?#])/i.test(url)) return { src: url, type: 'video/webm' }
  if (/\.(?:mp4|m4v|mov)(?:$|[?#])/i.test(url)) {
    return { src: url, type: 'video/mp4' }
  }
  return { src: url }
}

export function videoElementOf(player: Player): HTMLVideoElement | null {
  const element = player.tech(true)?.el()
  return element instanceof HTMLVideoElement ? element : null
}

export function qualityLevelsOf(player: Player): VideoJsQualityLevelList | null {
  return (player as PlayerWithQualityLevels).qualityLevels?.() ?? null
}

export function selectVideoJsQuality(player: Player, selectedIndex: number): void {
  const levels = qualityLevelsOf(player)
  if (!levels) return
  for (let index = 0; index < levels.length; index += 1) {
    levels[index].enabled = selectedIndex < 0 || index === selectedIndex
  }
}
