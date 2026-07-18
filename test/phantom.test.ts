import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { stepPhantom } from '../src/sim/phantom'
import { initialSim } from '../src/sim/types'
import { dist } from '../src/sim/vec'
import { stepWorld } from '../src/sim/world'
import type { IntentInput, PhantomState, Vec2 } from '../src/sim/types'

const DT = 1 / 30
const P = CONFIG.phantom
const I = (): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false })
const ph = (o: Partial<PhantomState> = {}): PhantomState => ({
  pos: { x: 32, y: 32 }, mode: 'wander', modeT: 0, alpha: 1, target: { x: 32, y: 32 }, ...o,
})
const far: Vec2 = { x: 2, y: 2 } // 始终在触发范围外的玩家位

function runPh(p: PhantomState, playerPos: Vec2, seed: number, n: number) {
  let sighs = 0
  for (let i = 0; i < n; i++) {
    const r = stepPhantom(p, playerPos, seed, DT)
    p = r.phantom; seed = r.seed; if (r.sigh) sighs++
  }
  return { p, seed, sighs }
}

describe('幻影状态机', () => {
  it('确定性：同种子轨迹一致', () => {
    const a = runPh(ph(), far, 99, 300)
    const b = runPh(ph(), far, 99, 300)
    expect(a.p.pos).toEqual(b.p.pos)
  })
  it('wander 600 tick 始终在世界界内', () => {
    let p = ph(); let seed = 7
    for (let i = 0; i < 600; i++) {
      const r = stepPhantom(p, far, seed, DT)
      p = r.phantom; seed = r.seed
      expect(p.pos.x).toBeGreaterThanOrEqual(1)
      expect(p.pos.x).toBeLessThanOrEqual(CONFIG.world.width - 1)
      expect(p.pos.y).toBeGreaterThanOrEqual(1)
      expect(p.pos.y).toBeLessThanOrEqual(CONFIG.world.height - 1)
    }
  })
  it('玩家进 8m 转 stare 且停在原地；8–9m 滞回维持；>9m 回 wander', () => {
    let r = stepPhantom(ph(), { x: 32, y: 32 + 7.5 }, 1, DT)
    expect(r.phantom.mode).toBe('stare')
    const posAtStare = r.phantom.pos
    r = stepPhantom(r.phantom, { x: 32, y: 32 + 8.6 }, r.seed, DT) // 8.6 < 9 维持
    expect(r.phantom.mode).toBe('stare')
    expect(r.phantom.pos).toEqual(posAtStare)
    r = stepPhantom(r.phantom, { x: 32, y: 32 + 9.5 }, r.seed, DT)
    expect(r.phantom.mode).toBe('wander')
  })
  it('进 6m 淡出：sigh 恰一次，fadeDur 后 gone，goneDur 后重生 ≥12m 且淡入', () => {
    const near: Vec2 = { x: 32, y: 32 + 5 }
    const first = stepPhantom(ph(), near, 5, DT)
    expect(first.phantom.mode).toBe('fade')
    let sighs = first.sigh ? 1 : 0
    let p = first.phantom
    let seed = first.seed
    for (let i = 0; i < Math.ceil((P.fadeDur + P.goneDur) / DT) + 2; i++) {
      const rr = stepPhantom(p, near, seed, DT)
      p = rr.phantom; seed = rr.seed; if (rr.sigh) sighs++
    }
    expect(sighs).toBe(1)
    expect(p.mode).toBe('wander')
    expect(dist(p.pos, near)).toBeGreaterThanOrEqual(P.respawnMinDist)
    expect(p.alpha).toBeLessThan(0.5) // 重生后淡入中
  })
  it('stepWorld 集成：靠近发 phantomSigh 事件', () => {
    const s = initialSim(20, 20.8)
    const nearPh: typeof s = {
      ...s,
      world: { ...s.world, phantom: { ...s.world.phantom, pos: { x: 20, y: 20.8 + 5 }, target: { x: 20, y: 20.8 + 5 } } },
    }
    const r = stepWorld(nearPh, I(), DT)
    expect(r.events.some((e) => e.type === 'phantomSigh')).toBe(true)
  })
})
