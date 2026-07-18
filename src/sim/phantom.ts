import { CONFIG } from '../config'
import { nextRand } from './rand'
import { dist, moveToward } from './vec'
import type { PhantomState, Vec2 } from './types'

/** 营地环带内取随机路标（环带几何上必在世界界内，见测试） */
function pickWaypoint(seed: number): { target: Vec2; seed: number } {
  const r1 = nextRand(seed)
  const r2 = nextRand(r1.seed)
  const P = CONFIG.phantom
  const ang = r1.value * Math.PI * 2
  const rad = P.ringMin + r2.value * (P.ringMax - P.ringMin)
  return {
    target: { x: CONFIG.campfire.x + Math.cos(ang) * rad, y: CONFIG.campfire.y + Math.sin(ang) * rad },
    seed: r2.seed,
  }
}

/** 重生点：拒绝采样至距玩家 ≥ respawnMinDist；兜底取背离玩家的环带远点 */
function respawn(seed: number, playerPos: Vec2): { pos: Vec2; seed: number } {
  for (let i = 0; i < 16; i++) {
    const w = pickWaypoint(seed)
    seed = w.seed
    if (dist(w.target, playerPos) >= CONFIG.phantom.respawnMinDist) return { pos: w.target, seed }
  }
  const dx = CONFIG.campfire.x - playerPos.x
  const dy = CONFIG.campfire.y - playerPos.y
  const len = Math.hypot(dx, dy) || 1
  const R = CONFIG.phantom.ringMax
  return { pos: { x: CONFIG.campfire.x + (dx / len) * R, y: CONFIG.campfire.y + (dy / len) * R }, seed }
}

export function stepPhantom(
  ph: PhantomState, playerPos: Vec2, seed: number, dt: number,
): { phantom: PhantomState; seed: number; sigh: boolean } {
  const P = CONFIG.phantom
  const d = dist(ph.pos, playerPos)
  let { pos, mode, modeT, alpha, target } = ph
  let sigh = false

  // 距离触发的转移（fade/gone 内不响应）
  if (mode === 'wander' || mode === 'stare') {
    if (d <= P.dissolveRange) { mode = 'fade'; modeT = 0; sigh = true }
    else if (mode === 'wander' && d <= P.stareRange) { mode = 'stare'; modeT = 0 }
    else if (mode === 'stare' && d > P.stareExit) { mode = 'wander'; modeT = 0 }
  }

  switch (mode) {
    case 'wander': {
      if (dist(pos, target) < 0.15) {
        const w = pickWaypoint(seed)
        target = w.target; seed = w.seed
      }
      pos = moveToward(pos, target, P.speed * dt)
      alpha = Math.min(1, alpha + dt / P.fadeInDur)
      modeT += dt
      break
    }
    case 'stare': {
      alpha = Math.min(1, alpha + dt / P.fadeInDur)
      modeT += dt
      break
    }
    case 'fade': {
      modeT += dt
      alpha = Math.max(0, 1 - modeT / P.fadeDur)
      if (modeT >= P.fadeDur) { mode = 'gone'; modeT = 0; alpha = 0 }
      break
    }
    case 'gone': {
      modeT += dt
      if (modeT >= P.goneDur) {
        const r = respawn(seed, playerPos)
        pos = r.pos; seed = r.seed; target = r.pos
        mode = 'wander'; modeT = 0; alpha = 0
      }
      break
    }
  }
  return { phantom: { pos, mode, modeT, alpha, target }, seed, sigh }
}
