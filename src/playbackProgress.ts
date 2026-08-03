export type PlaybackResumePoint = {
  positionSeconds?: number
  progress?: number
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
      ? (storedPosition as number)
      : (duration * progress) / 100
  if (!Number.isFinite(target) || target < 5 || duration - target <= 10) return 0
  return Math.min(target, duration - 0.25)
}
