import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'
import { canPlaceAt, stepWorld } from '../src/sim/world'
import { DT, I } from './helpers'
import type { SimState } from '../src/sim/types'
const withItem = (s: SimState, kind: 'sapling' | 'lanternPost', n = 1): SimState => ({
  ...s,
  world: { ...s.world, slots: s.world.slots.map((x, i) => (i === 0 ? { kind, count: n } : x)), selected: 0 },
})

describe('canPlaceAt', () => {
  const s = initialSim(20, 20.8)
  it('圈内合法、圈外/贴实体/出界非法', () => {
    expect(canPlaceAt(s.world, s.player.pos, { x: 21.5, y: 21 })).toBe(true)
    expect(canPlaceAt(s.world, s.player.pos, { x: 26, y: 21 })).toBe(false)       // 超 3m
    expect(canPlaceAt(s.world, s.player.pos, { x: 20, y: 19.2 })).toBe(false)     // 贴篝火 <0.8m
    expect(canPlaceAt(s.world, { x: 1.2, y: 20 }, { x: 0.5, y: 20 })).toBe(false) // 出界
  })
})

describe('右键放置', () => {
  it('树苗种下：扣物、入 plantings、planted 事件', () => {
    const s = withItem(initialSim(20, 20.8), 'sapling')
    const r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(r.state.world.plantings).toHaveLength(1)
    expect(r.state.world.slots[0]).toBeNull()
    expect(r.events.some((e) => e.type === 'planted')).toBe(true)
  })
  it('提灯柱落地入 posts + postPlaced', () => {
    const s = withItem(initialSim(20, 20.8), 'lanternPost')
    const r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(r.state.world.posts).toHaveLength(1)
    expect(r.events.some((e) => e.type === 'postPlaced' && e.index === 0)).toBe(true)
  })
  it('非法位/非放置物不消耗', () => {
    const bad = stepWorld(withItem(initialSim(20, 20.8), 'sapling'), I({ place: true, aim: { x: 30, y: 21 } }), DT)
    expect(bad.state.world.plantings).toHaveLength(0)
    expect(bad.state.world.slots[0]).toEqual({ kind: 'sapling', count: 1 })
    const axe = stepWorld(initialSim(20, 20.8), I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(axe.state.world.posts).toHaveLength(0)
  })
  it('Sim 缓存 place 边沿且 clearPendingEdges 可清', () => {
    const sim = new Sim(withItem(initialSim(20, 20.8), 'lanternPost'))
    sim.advance(0.01, I({ place: true, aim: { x: 21.5, y: 21 } }))
    sim.advance(0.03, I({ aim: { x: 21.5, y: 21 } }))
    expect(sim.state.world.posts).toHaveLength(1)
    const sim2 = new Sim(withItem(initialSim(20, 20.8), 'lanternPost'))
    sim2.advance(0.01, I({ place: true, aim: { x: 21.5, y: 21 } }))
    sim2.clearPendingEdges()
    sim2.advance(0.03, I({ aim: { x: 21.5, y: 21 } }))
    expect(sim2.state.world.posts).toHaveLength(0)
  })
})

describe('种植生长', () => {
  it('90s 后长成 tier0 小树并发 grown', () => {
    const s = withItem(initialSim(20, 20.8), 'sapling')
    const r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    // 快进：plantedAt 拨回 90 秒前
    const cur: SimState = {
      ...r.state,
      world: {
        ...r.state.world,
        plantings: r.state.world.plantings.map((p) => ({ ...p, plantedAt: r.state.time - CONFIG.growth.durS })),
      },
    }
    const g = stepWorld(cur, I(), DT)
    expect(g.state.world.plantings).toHaveLength(0)
    const born = g.events.find((e) => e.type === 'grown')
    expect(born).toBeTruthy()
    const tree = g.state.world.nodes.find((n) => n.id === (born as { nodeId: number }).nodeId)!
    expect(tree.kind).toBe('tree')
    expect(tree.tier).toBe(0)
    expect(tree.charges).toBe(CONFIG.tiers.tree[0]!.charges)
  })
})
