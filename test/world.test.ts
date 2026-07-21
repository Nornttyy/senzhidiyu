import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { countOf } from '../src/sim/inventory'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'
import { nearestNodeIdx, stepWorld } from '../src/sim/world'
import { DT, I } from './helpers'
import type { IntentInput, ItemKind, SimEvent, SimState } from '../src/sim/types'

function runTicks(s: SimState, inp: IntentInput, n: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = stepWorld(s, inp, DT)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

/** 一轮完整挥砍：首 tick interact 边沿，之后空输入直到循环结束 */
function chop(s: SimState, n: number): { state: SimState; events: SimEvent[] } {
  let events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    const first = stepWorld(s, I({ interact: true }), DT)
    const rest = runTicks(first.state, I(), 45)
    s = rest.state
    events = [...events, ...first.events, ...rest.events]
  }
  return { state: s, events }
}

/** 0 号格换成指定物品（null=空手） */
const withSel = (s: SimState, kind: ItemKind | null): SimState => ({
  ...s,
  world: { ...s.world, slots: s.world.slots.map((x, i) => (i === 0 ? (kind ? { kind, count: 1 } : null) : x)) },
})

describe('初始世界', () => {
  const w = initialSim(20, 20.8).world
  it('出生地保留手摆的 9 个分档节点，外围区块另有程序资源', () => {
    const fixed = w.nodes.filter((n) => typeof n.id === 'number')
    const trees = fixed.filter((n) => n.kind === 'tree')
    const ores = fixed.filter((n) => n.kind === 'ore')
    expect(trees.map((t) => t.tier).sort()).toEqual([0, 0, 1, 1, 2, 2])
    expect(ores.map((t) => t.tier).sort()).toEqual([0, 0, 1])
    expect(trees.every((n) => n.charges === CONFIG.tiers.tree[n.tier]!.charges)).toBe(true)
    expect(fixed).toHaveLength(9)
    expect(new Set(w.nodes.map((n) => n.id)).size).toBe(w.nodes.length)
    expect(w.nodes.some((n) => typeof n.id === 'string')).toBe(true)
    expect(w.nextId).toBe(9)
  })
  it('开局：斧头在 0 号并选中、hp 满、无掉落物无种植', () => {
    expect(w.slots[0]).toEqual({ kind: 'axe', count: 1 })
    expect(w.slots.filter(Boolean)).toHaveLength(2) // 斧 + 开局火把
    expect(w.selected).toBe(0)
    expect(w.hp).toBe(CONFIG.hp.max)
    expect(w.drops).toEqual([])
    expect(w.plantings).toEqual([])
  })
})

describe('命中与破坏（挖完才掉）', () => {
  // 树0 在 (12.5,13)，中档 tier1：4 次
  const nearTree = () => initialSim(12.5, 14.1)

  it('一轮挥砍：nodeHit 一次、charges-1、不再有直接收益', () => {
    const { state, events } = chop(nearTree(), 1)
    expect(events.filter((e) => e.type === 'nodeHit')).toHaveLength(1)
    expect(state.world.nodes[0]!.charges).toBe(CONFIG.tiers.tree[1]!.charges - 1)
    expect(state.world.slots.filter(Boolean)).toHaveLength(2) // 斧头与开局火把,无新增
  })
  it('非斧头选中不结算，也不进入挥砍姿态（无假反馈）', () => {
    const start = withSel(nearTree(), null)
    const first = stepWorld(start, I({ interact: true }), DT)
    expect(first.state.player.gathering).toBe(false) // 空手点击不起手
    const { state, events } = chop(withSel(nearTree(), 'sapling'), 1)
    expect(events.filter((e) => e.type === 'nodeHit')).toHaveLength(0)
    expect(state.world.nodes[0]!.charges).toBe(4)
  })
  it('第 4 轮破坏：节点移除 + nodeBroken(kind/tier)', () => {
    const startCount = nearTree().world.nodes.length
    const r3 = chop(nearTree(), 3)
    const r4 = chop(r3.state, 1)
    const broken = r4.events.filter((e) => e.type === 'nodeBroken')
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ kind: 'tree', tier: 1, nodeId: 0 })
    expect(r4.state.world.nodes.find((n) => n.id === 0)).toBeUndefined()
    expect(r4.state.world.nodes).toHaveLength(startCount - 1)
  })
  it('边走边砍不打断：命中时刻仍在范围内则照常结算（契约移植）', () => {
    const first = stepWorld(nearTree(), I({ interact: true }), DT)
    const r = runTicks(first.state, I({ moveX: 1, interact: true }), 14)
    expect(r.events.filter((e) => e.type === 'nodeHit')).toHaveLength(1)
  })
  it('命中时刻已走出交互范围则无收益（契约移植）', () => {
    const first = stepWorld(nearTree(), I({ interact: true }), DT)
    const r = runTicks(first.state, I({ moveX: -1, moveY: -1, interact: true }), 45)
    expect(r.events.filter((e) => e.type === 'nodeHit').length).toBeLessThanOrEqual(1)
    const r2 = runTicks(r.state, I({ moveX: -1, moveY: -1, interact: true }), 36)
    expect(r2.events.filter((e) => e.type === 'nodeHit')).toHaveLength(0)
  })
  it('长按连砍：两循环两次 nodeHit、charges-2（契约移植）', () => {
    const first = stepWorld(nearTree(), I({ interact: true }), DT)
    const r = runTicks(first.state, I({ interact: true }), 72)
    expect(r.events.filter((e) => e.type === 'nodeHit')).toHaveLength(2)
    expect(r.state.world.nodes[0]!.charges).toBe(2)
  })
  it('小矿三轮即破', () => {
    const { state, events } = chop(initialSim(7.5, 17.6), 3) // 矿0 tier0：3 次
    const broken = events.filter((e) => e.type === 'nodeBroken')
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ kind: 'ore', tier: 0 })
    expect(state.world.nodes.some((n) => n.kind === 'ore' && n.pos.x === 7.5)).toBe(false)
  })
  it('数字键选格立即生效', () => {
    const r = stepWorld(initialSim(20, 20.8), I({ selectSlot: 4 }), DT)
    expect(r.state.world.selected).toBe(4)
  })
  it('nearestNodeIdx 取最近未耗尽节点', () => {
    const w = initialSim(20, 20).world
    const nodes = [
      { ...w.nodes[0]!, pos: { x: 20, y: 21.5 } },
      { ...w.nodes[1]!, pos: { x: 20, y: 21 } },
      { ...w.nodes[2]!, pos: { x: 20, y: 20.5 }, charges: 0 },
    ]
    expect(nearestNodeIdx(nodes, { x: 20, y: 20 }, 1.6)).toBe(1)
    expect(nearestNodeIdx(nodes, { x: 5, y: 5 }, 1.6)).toBe(-1)
  })
})

describe('掉落物理与拾取', () => {
  const nearTree = () => initialSim(12.5, 14.1) // 树0 中档：4 次 4 木
  const woodTotal = (s: SimState) =>
    countOf(s.world.slots, 'wood') + s.world.drops.filter((d) => d.kind === 'wood').length

  it('破坏散出 4 木：地上+包内守恒', () => {
    const { state } = chop(nearTree(), 4)
    expect(woodTotal(state)).toBe(4)
  })
  it('掉落物滑停；走过掉落堆全部吸入', () => {
    let { state, events } = chop(nearTree(), 4)
    const settled = runTicks(state, I(), 30) // 1 秒滑停
    state = settled.state
    events = [...events, ...settled.events]
    for (const d of state.world.drops) {
      expect(Math.hypot(d.vel.x, d.vel.y)).toBeLessThan(0.05)
      expect(Number.isFinite(d.pos.x)).toBe(true)
      expect(Number.isFinite(d.pos.y)).toBe(true)
    }
    // 穿过树位向北再折返，扫掉整片掉落（散射半径 ≤0.6m，路径覆盖）
    const sweep1 = runTicks(state, I({ moveY: -1 }), 20)
    const sweep2 = runTicks(sweep1.state, I({ moveX: -1 }), 8)
    const sweep3 = runTicks(sweep2.state, I({ moveX: 1 }), 16)
    state = sweep3.state
    events = [...events, ...sweep1.events, ...sweep2.events, ...sweep3.events]
    const pickedWood = events.filter((e) => e.type === 'pickup' && e.kind === 'wood').length
    expect(pickedWood).toBeGreaterThan(0)
    expect(countOf(state.world.slots, 'wood')).toBe(pickedWood)
    expect(woodTotal(state)).toBe(4) // 地上+包内守恒
  })
  it('背包全满掉落物滞留并节流 invFull', () => {
    let s = nearTree()
    // 0 号留斧头，其余全塞满
    s = {
      ...s,
      world: {
        ...s.world,
        slots: s.world.slots.map((x, i) => (i === 0 ? x : { kind: 'fluorite' as const, count: 99 })),
      },
    }
    const r = chop(s, 4)
    const after = runTicks(r.state, I({ moveY: -1 }), 20) // 走进掉落堆触发拾取尝试
    const stay = runTicks(after.state, I(), 70)           // 原地 ~2.3 秒持续尝试
    expect(stay.state.world.drops.length).toBeGreaterThan(0)
    const fulls = [...r.events, ...after.events, ...stay.events].filter((e) => e.type === 'invFull')
    expect(fulls.length).toBeGreaterThanOrEqual(1)
    expect(fulls.length).toBeLessThanOrEqual(2) // ~3 秒窗口 3s 节流
  })
  it('树苗掉落种子确定：同种子同结果，且中档只 roll 一次', () => {
    const saps = (seed: number) => {
      const { state, events } = chop(initialSim(12.5, 14.1, seed), 4)
      const ground = state.world.drops.filter((d) => d.kind === 'sapling').length
      const picked = events.filter((e) => e.type === 'pickup' && e.kind === 'sapling').length
      return ground + picked
    }
    expect(saps(7)).toBe(saps(7))
    expect([0, 1]).toContain(saps(7))
  })
})

describe('Sim 事件聚合', () => {
  it('advance 聚合多步事件，drainEvents 取走后清空', () => {
    const sim = new Sim(initialSim(12.5, 14.1))
    sim.advance(DT, I({ interact: true }))
    for (let i = 0; i < 45; i++) sim.advance(DT, I())
    const drained = sim.drainEvents()
    expect(drained.filter((e) => e.type === 'nodeHit')).toHaveLength(1)
    expect(sim.drainEvents()).toHaveLength(0)
  })
})
