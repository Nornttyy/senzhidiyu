import type { Vec2 } from './types'

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function moveToward(from: Vec2, to: Vec2, step: number): Vec2 {
  const d = dist(from, to)
  if (d <= step || d === 0) return to
  return { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step }
}
