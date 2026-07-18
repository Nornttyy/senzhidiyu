import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { countOf } from '../src/sim/inventory'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'
import { applyDamage, stepWorld } from '../src/sim/world'
import { DT, I, withSlots } from './helpers'
import type { SimState } from '../src/sim/types'

describe('craft 动作', () => {
  const rich = (s: SimState) => withSlots(s, (i) =>
    i === 0 ? { kind: 'axe', count: 1 } : i === 1 ? { kind: 'wood', count: 10 } : i === 2 ? { kind: 'fluorite', count: 5 } : null)
  it('扣费产出提灯柱并发 crafted', () => {
    const r = stepWorld(rich(initialSim(5, 5)), I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'lanternPost')).toBe(1)
    expect(countOf(r.state.world.slots, 'wood')).toBe(0)
    expect(r.events.some((e) => e.type === 'crafted')).toBe(true)
  })
  it('材料不足不执行', () => {
    const r = stepWorld(initialSim(5, 5), I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'lanternPost')).toBe(0)
    expect(r.events.filter((e) => e.type === 'crafted')).toHaveLength(0)
  })
  it('产出无处安放则整体不执行不扣费，并发 invFull 提示', () => {
    // 从大叠中扣费不清格：扣完 slots 仍全占，产出无处放
    const full = withSlots(initialSim(5, 5), (i) =>
      i === 0 ? { kind: 'wood', count: 99 } : { kind: 'fluorite', count: 99 })
    const r = stepWorld(full, I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'wood')).toBe(99)
    expect(countOf(r.state.world.slots, 'lanternPost')).toBe(0)
    expect(r.events.some((e) => e.type === 'invFull')).toBe(true)
  })
})

describe('move 动作与队列', () => {
  it('clearPendingEdges 丢弃排队中的动作（blur/开合背包）', () => {
    const sim = new Sim(withSlots(initialSim(5, 5), (i) => (i === 0 ? { kind: 'wood', count: 3 } : null)))
    sim.queueAction({ type: 'move', from: 0, to: 10 })
    sim.advance(0.01, I()) // 未步进
    sim.clearPendingEdges()
    sim.advance(0.03, I())
    expect(sim.state.world.slots[0]).toEqual({ kind: 'wood', count: 3 })
    expect(sim.state.world.slots[10]).toBeNull()
  })
  it('Sim.queueAction 缓冲到实际步进帧一次性交付', () => {
    const sim = new Sim(withSlots(initialSim(5, 5), (i) => (i === 0 ? { kind: 'wood', count: 3 } : null)))
    sim.queueAction({ type: 'move', from: 0, to: 10 })
    sim.advance(0.01, I()) // 无步进，动作应保留
    sim.advance(0.03, I())
    expect(sim.state.world.slots[10]).toEqual({ kind: 'wood', count: 3 })
    expect(sim.state.world.slots[0]).toBeNull()
  })
})

describe('hp', () => {
  it('篝火圈内回复并夹紧上限', () => {
    const base = initialSim(20, 20.8)
    let s: SimState = { ...base, world: { ...base.world, hp: 95 } }
    for (let i = 0; i < 30; i++) s = stepWorld(s, I(), DT).state
    expect(s.world.hp).toBe(CONFIG.hp.max)
  })
  it('野外不回复；applyDamage 夹紧 0', () => {
    const base = initialSim(5, 5)
    const wild: SimState = { ...base, world: { ...base.world, hp: 50 } }
    const s = stepWorld(wild, I(), DT).state
    expect(s.world.hp).toBe(50)
    expect(applyDamage(wild.world, 999).hp).toBe(0)
  })
})
