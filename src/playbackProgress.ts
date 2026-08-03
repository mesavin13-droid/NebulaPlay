export type PlaybackResumePoint = {
  positionSeconds?: number
  progress?: number
}

export type PlaybackStart = {
  seconds: number
  reason: "resume" | "intro" | null
}

// 过短的进度从头播；接近结束视为已看完，避免续播到片尾。
export function resolveResumeSeconds(
  point: PlaybackResumePoint | undefined,
  duration: number,
): number {
  if (!point || !Number.isFinite(duration) || duration <= 0) return 0
  const progress = Number.isFinite(point.progress)
    ? Math.min(100, Math.max(0, point.progress ?? 0))
    : 0
  if (progress >= 95) return 0

  const storedPosition = point.positionSeconds
  const target =
    Number.isFinite(storedPosition) && (storedPosition ?? 0) > 0
      ? storedPosition as number
      : (duration * progress) / 100
  if (!Number.isFinite(target) || target < 5 || duration - target <= 10)
    return 0
  return Math.min(target, duration - 0.25)
}

// 续播优先保留更靠后的位置；仍处于片头范围时跳到用户设置的片头终点。
// 视频短于「片头 + 10 秒」时不执行，避免错误配置直接跳到片尾。
export function resolvePlaybackStart(
  point: PlaybackResumePoint | undefined,
  duration: number,
  skipIntroSeconds = 0,
): PlaybackStart {
  const resumed = resolveResumeSeconds(point, duration)
  const intro = Number.isFinite(skipIntroSeconds)
    ? Math.min(600, Math.max(0, skipIntroSeconds))
    : 0
  const safeIntro = duration > intro + 10 ? intro : 0
  if (safeIntro > resumed) return { seconds: safeIntro, reason: "intro" }
  if (resumed > 0) return { seconds: resumed, reason: "resume" }
  return { seconds: 0, reason: null }
}

export function shouldSkipOutro(
  current: number,
  duration: number,
  skipOutroSeconds = 0,
): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0)
    return false
  const outro = Number.isFinite(skipOutroSeconds)
    ? Math.min(600, Math.max(0, skipOutroSeconds))
    : 0
  if (outro <= 0 || duration <= outro + 10) return false
  return current > 0 && current >= duration - outro
}
