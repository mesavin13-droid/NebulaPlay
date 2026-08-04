import { describe, expect, it } from 'vitest'
import { enhancementTargetFps } from './anime4kEnhancer'

describe('enhancementTargetFps', () => {
  it('keeps SD and 720p enhancement at 30 fps', () => {
    expect(enhancementTargetFps(896, 504)).toBe(30)
    expect(enhancementTargetFps(1280, 720)).toBe(30)
  })

  it('reduces 1080p work to protect video decoding', () => {
    expect(enhancementTargetFps(1920, 1080)).toBe(24)
  })

  it('caps resolutions above 1080p at 15 fps', () => {
    expect(enhancementTargetFps(2560, 1440)).toBe(15)
    expect(enhancementTargetFps(3840, 2160)).toBe(15)
  })
})
