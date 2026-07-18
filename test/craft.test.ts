import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'
import { canCraft, previewPos, stepWorld } from '../src/sim/world'
import type { IntentInput, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, aimFacing: 0 as const, ...o })
const rich = (s: SimState): SimState => ({
  ...s, world: { ...s.world, inventory: { wood: 10, fluorite: 5 } },
})

describe('canCraft', () => {
  it('资源足且近篝火为真；缺任一为假', () => {
    const atFire = rich(initialSim(20, 20.8)) // 距篝火 1.8m < 2.5m
    expect(canCraft(atFire.world, atFire.player.pos)).toBe(true)
    const farAway = rich(initialSim(5, 5))
    expect(canCraft(farAway.world, farAway.player.pos)).toBe(false)
    const poor = initialSim(20, 20.8)
    expect(canCraft(poor.world, poor.player.pos)).toBe(false)
  })
})

describe('合成与放置', () => {
  it('E 近火足够：扣资源、进放置、crafted 事件', () => {
    const r = stepWorld(rich(initialSim(20, 20.8)), I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(true)
    expect(r.state.world.inventory).toEqual({ wood: 0, fluorite: 0 })
    expect(r.events.some((e) => e.type === 'crafted')).toBe(true)
  })
  it('放置模式再按 E：柱落在前方 1.5m，退出放置，postPlaced 事件', () => {
    let r = stepWorld(rich(initialSim(20, 20.8)), I({ craft: true }), DT)
    r = stepWorld(r.state, I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(false)
    expect(r.state.world.posts).toHaveLength(1)
    const post = r.state.world.posts[0]!
    expect(post.x).toBeCloseTo(20 + CONFIG.craft.placeAheadM, 3) // facing=1
    expect(r.events.some((e) => e.type === 'postPlaced' && e.index === 0)).toBe(true)
  })
  it('previewPos 贴边夹紧', () => {
    const s = initialSim(CONFIG.world.width - 1.2, 20.8)
    expect(previewPos(s.player).x).toBe(CONFIG.world.width - CONFIG.craft.edgeMarginM)
  })
  it('资源不足 E 无效果', () => {
    const r = stepWorld(initialSim(20, 20.8), I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(false)
    expect(r.events).toHaveLength(0)
  })
})
