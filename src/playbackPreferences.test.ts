import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadPlaybackPreferences,
  normalizePlaybackPreferences,
  PLAYBACK_PREFERENCES_KEY,
  savePlaybackPreferences,
} from './playbackPreferences'
import { resolvePlaybackStart, shouldSkipOutro } from './playbackProgress'

describe('连续播放偏好', () => {
  beforeEach(() => localStorage.clear())

  it('默认开启自动下一集，片头片尾跳过由用户主动开启', () => {
    expect(loadPlaybackPreferences()).toEqual({
      autoNext: true,
      loop: false,
      skipIntro: false,
      introSeconds: 90,
      skipOutro: false,
      outroSeconds: 90,
    })
  })

  it('持久化前规范化布尔值与 0-600 秒范围', () => {
    const saved = savePlaybackPreferences(
      normalizePlaybackPreferences({
        autoNext: false,
        skipIntro: true,
        introSeconds: 999,
        skipOutro: true,
        outroSeconds: -4,
      }),
    )

    expect(saved.introSeconds).toBe(600)
    expect(saved.outroSeconds).toBe(0)
    expect(JSON.parse(localStorage.getItem(PLAYBACK_PREFERENCES_KEY) ?? '{}')).toEqual(saved)
    expect(loadPlaybackPreferences()).toEqual(saved)
  })

  it('续播位置在片头后时保留续播，否则跳到片头终点', () => {
    expect(resolvePlaybackStart({ positionSeconds: 35, progress: 3.5 }, 1_000, 90)).toEqual({
      seconds: 90,
      reason: 'intro',
    })
    expect(resolvePlaybackStart({ positionSeconds: 240, progress: 24 }, 1_000, 90)).toEqual({
      seconds: 240,
      reason: 'resume',
    })
    expect(resolvePlaybackStart(undefined, 95, 90)).toEqual({ seconds: 0, reason: null })
  })

  it('只在有效片尾窗口内触发跳过', () => {
    expect(shouldSkipOutro(909, 1_000, 90)).toBe(false)
    expect(shouldSkipOutro(910, 1_000, 90)).toBe(true)
    expect(shouldSkipOutro(5, 95, 90)).toBe(false)
  })
})
