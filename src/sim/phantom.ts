import { CONFIG } from '../config'
import { nextRand } from './rand'
import { dist, moveToward } from './vec'
import type { PhantomState, Vec2 } from './types'

/** 以玩家为中心在环带内取路标，让幻影能跟随无限探索，而不是被留在出生地。 */
function pickWaypoint(seed: number, center: Vec2): { target: Vec2; seed: number } {
  const r1 = nextRand(seed)
  const r2 = nextRand(r1.seed)
  const P = CONFIG.phantom
  const ang = r1.value * Math.PI * 2
  const rad = P.ringMin + r2.value * (P.ringMax - P.ringMin)
  return {
    target: { x: center.x + Math.cos(ang) * rad, y: center.y + Math.sin(ang) * rad },
    seed: r2.seed,
  }
}

/** 重生点：拒绝采样至距玩家 ≥ respawnMinDist；兜底取背离玩家的环带远点 */
function respawn(seed: number, playerPos: Vec2): { pos: Vec2; seed: number } {
  for (let i = 0; i < 16; i++) {
    const w = pickWaypoint(seed, playerPos)
    seed = w.seed
    if (dist(w.target, playerPos) >= CONFIG.phantom.respawnMinDist) return { pos: w.target, seed }
  }
  return { pos: { x: playerPos.x + CONFIG.phantom.ringMax, y: playerPos.y }, seed }
}

export function stepPhantom(
  ph: PhantomState, playerPos: Vec2, seed: number, dt: number, allowActive = true,
): { phantom: PhantomState; seed: number; sigh: boolean } {
  const P = CONFIG.phantom
  const d = dist(ph.pos, playerPos)
  let { pos, mode, modeT, alpha, target } = ph
  let sigh = false

  // 白昼压制:活动态强制消散(无叹息),gone 停留不返场
  if (!allowActive && (mode === 'wander' || mode === 'stare')) {
    mode = 'fade'; modeT = 0
  }

  // 距离触发的转移（fade/gone 内不响应）
  if (allowActive && (mode === 'wander' || mode === 'stare')) {
    if (d > P.leashM) {
      const r = respawn(seed, playerPos)
      pos = r.pos; seed = r.seed; target = r.pos
      mode = 'wander'; modeT = 0; alpha = 0
    } else if (d <= P.dissolveRange) { mode = 'fade'; modeT = 0; sigh = true }
    else if (mode === 'wander' && d <= P.stareRange) { mode = 'stare'; modeT = 0 }
    else if (mode === 'stare' && d > P.stareExit) { mode = 'wander'; modeT = 0 }
  }

  switch (mode) {
    case 'wander': {
      if (dist(pos, target) < 0.15) {
        const w = pickWaypoint(seed, playerPos)
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
      if (allowActive && modeT >= P.goneDur) { // 白昼压制期不返场,入夜(或黄昏末)才重生
        const r = respawn(seed, playerPos)
        pos = r.pos; seed = r.seed; target = r.pos
        mode = 'wander'; modeT = 0; alpha = 0
      }
      break
    }
  }
  return { phantom: { pos, mode, modeT, alpha, target }, seed, sigh }
}
