import { CONFIG } from '../config'
import type { PlayerAction } from '../sim/types'

export interface AnimSample {
  action: PlayerAction
  facing: 1 | -1
  actionT: number
  prevActionT: number
  gatherT: number
  prevGatherT: number
  time: number
}
export interface SpriteTransform {
  offsetXPx: number; offsetYPx: number; rotation: number; scaleX: number; scaleY: number
}
export type AnimEvent = 'footstep' | 'gatherHit'

const easeInQuad = (x: number) => x * x
const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x)
const easeInOutQuad = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

function breath(time: number): { scaleX: number; scaleY: number } {
  const s = Math.sin((2 * Math.PI * time) / CONFIG.anim.breathPeriod) * CONFIG.anim.breathAmp
  return { scaleY: 1 + s, scaleX: 1 - s * 0.5 } // 反向补偿保体积
}

export function animate(s: AnimSample): { transform: SpriteTransform; events: AnimEvent[] } {
  const events: AnimEvent[] = []
  const t: SpriteTransform = { offsetXPx: 0, offsetYPx: 0, rotation: 0, ...breath(s.time) }

  if (s.action === 'walking') {
    const rate = CONFIG.player.speed / CONFIG.anim.strideM
    const phase = s.actionT * rate
    const prevPhase = s.prevActionT * rate
    t.offsetYPx = -CONFIG.anim.bobAmpPx * Math.abs(Math.sin(Math.PI * phase))
    t.rotation = CONFIG.anim.lean * s.facing
    // Use small epsilon to handle floating point accumulation in phase crossing detection
    const eps = 1e-8
    if (Math.floor(phase + eps) > Math.floor(prevPhase + eps)) events.push('footstep')
  } else if (s.action === 'gathering') {
    const g = CONFIG.gather
    let angle: number
    if (s.gatherT < g.windup) {
      angle = g.backAngle * easeInQuad(s.gatherT / g.windup)
    } else if (s.gatherT < g.hitAt) {
      angle = g.backAngle + (g.chopAngle - g.backAngle) * easeOutQuad((s.gatherT - g.windup) / g.swing)
    } else {
      angle = g.chopAngle * (1 - easeInOutQuad(Math.min(1, (s.gatherT - g.hitAt) / (g.duration - g.hitAt))))
    }
    t.rotation = angle * s.facing
    if (s.prevGatherT < g.hitAt && s.gatherT >= g.hitAt) events.push('gatherHit')
  } else {
    // idle：从行走停下的 stopRebound 秒内，前倾角衰减回正
    const k = Math.min(1, s.actionT / CONFIG.anim.stopRebound)
    t.rotation = CONFIG.anim.lean * s.facing * (1 - k)
  }
  return { transform: t, events }
}
