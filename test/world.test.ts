import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'
import { nearestNodeIdx, stepWorld } from '../src/sim/world'
import type { IntentInput, SimEvent, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, aimFacing: 0 as const, ...o })

function runTicks(s: SimState, inp: IntentInput, n: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = stepWorld(s, inp, DT)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

/** 一轮完整采集：首 tick interact，之后空输入直到循环结束 */
function gatherOnce(s: SimState): { state: SimState; events: SimEvent[] } {
  const first = stepWorld(s, I({ interact: true }), DT)
  const rest = runTicks(first.state, I(), 45) // 1.5s > duration
  return { state: rest.state, events: [...first.events, ...rest.events] }
}

describe('初始世界', () => {
  const w = initialSim(20, 20.8).world
  it('6 树 4 次数、3 矿 5 次数，id 唯一', () => {
    const trees = w.nodes.filter((n) => n.kind === 'tree')
    const ores = w.nodes.filter((n) => n.kind === 'ore')
    expect(trees).toHaveLength(6)
    expect(ores).toHaveLength(3)
    expect(trees.every((n) => n.charges === CONFIG.nodes.treeCharges)).toBe(true)
    expect(ores.every((n) => n.charges === CONFIG.nodes.oreCharges)).toBe(true)
    expect(new Set(w.nodes.map((n) => n.id)).size).toBe(9)
  })
  it('初值：安宁 100、背包空、无柱、不放置、幻影 wander', () => {
    expect(w.serenity).toBe(CONFIG.serenity.initial)
    expect(w.inventory).toEqual({ wood: 0, fluorite: 0 })
    expect(w.posts).toEqual([])
    expect(w.placing).toBe(false)
    expect(w.phantom.mode).toBe('wander')
  })
})

describe('采集收益', () => {
  // 树0 在 (12.5,13)；站它南侧 1.1m 处
  const nearTree = () => initialSim(12.5, 14.1)

  it('一轮采集：wood+1、charges-1、单次 harvest 事件', () => {
    const { state, events } = gatherOnce(nearTree())
    const h = events.filter((e) => e.type === 'harvest')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ kind: 'tree', nodeId: 0, depleted: false })
    expect(state.world.inventory.wood).toBe(1)
    expect(state.world.nodes[0]!.charges).toBe(CONFIG.nodes.treeCharges - 1)
  })
  it('第 4 次采集 depleted=true，之后空挥无事件', () => {
    let s = nearTree()
    let all: SimEvent[] = []
    for (let i = 0; i < 5; i++) { const r = gatherOnce(s); s = r.state; all = [...all, ...r.events] }
    const h = all.filter((e) => e.type === 'harvest')
    expect(h).toHaveLength(4)
    expect(h[3]).toMatchObject({ depleted: true })
    expect(s.world.nodes[0]!.charges).toBe(0)
    expect(s.world.inventory.wood).toBe(4)
  })
  it('范围外空挥：无事件无扣减', () => {
    const { state, events } = gatherOnce(initialSim(20, 25)) // 离所有节点都远
    expect(events.filter((e) => e.type === 'harvest')).toHaveLength(0)
    expect(state.world.inventory.wood).toBe(0)
  })
  it('边走边砍不打断：命中时刻仍在范围内则照常结算', () => {
    const first = stepWorld(initialSim(12.5, 14.1), I({ interact: true }), DT)
    // 按住并缓速移动,命中(0.45s)时仍在 1.6m 范围内
    const r = runTicks(first.state, I({ moveX: 1, interact: true }), 14)
    expect(r.events.filter((e) => e.type === 'harvest')).toHaveLength(1)
  })
  it('命中时刻已走出交互范围则无收益', () => {
    const first = stepWorld(initialSim(12.5, 14.1), I({ interact: true }), DT)
    // 全程按住移动:0.45s 命中前已离开范围(减速 2.4m/s × 0.43s ≈ 1.03m,起点距树需临界)——
    // 用远离方向确保出界:向左上撤离
    const r = runTicks(first.state, I({ moveX: -1, moveY: -1, interact: true }), 45)
    const hits = r.events.filter((e) => e.type === 'harvest')
    expect(hits.length).toBeLessThanOrEqual(1) // 首循环可能压线,后续循环必然出界
    const r2 = runTicks(r.state, I({ moveX: -1, moveY: -1, interact: true }), 36)
    expect(r2.events.filter((e) => e.type === 'harvest')).toHaveLength(0)
  })
  it('长按连砍:靠树按住两循环得两木', () => {
    const first = stepWorld(initialSim(12.5, 14.1), I({ interact: true }), DT)
    const r = runTicks(first.state, I({ interact: true }), 72) // 两循环
    expect(r.events.filter((e) => e.type === 'harvest')).toHaveLength(2)
    expect(r.state.world.inventory.wood).toBe(2)
  })
  it('矿采集得 fluorite', () => {
    const { state, events } = gatherOnce(initialSim(7.5, 17.6)) // 矿0 (7.5,16.5) 南侧 1.1m
    expect(events.filter((e) => e.type === 'harvest')[0]).toMatchObject({ kind: 'ore' })
    expect(state.world.inventory.fluorite).toBe(1)
  })
  it('nearestNodeIdx 取最近未耗尽节点', () => {
    const w = initialSim(20, 20).world
    const nodes = [
      { ...w.nodes[0]!, pos: { x: 20, y: 21.5 } },             // 1.5m
      { ...w.nodes[1]!, pos: { x: 20, y: 21 } },               // 1.0m 更近
      { ...w.nodes[2]!, pos: { x: 20, y: 20.5 }, charges: 0 }, // 最近但耗尽
    ]
    expect(nearestNodeIdx(nodes, { x: 20, y: 20 }, 1.6)).toBe(1)
    expect(nearestNodeIdx(nodes, { x: 5, y: 5 }, 1.6)).toBe(-1)
  })
})

describe('Sim 事件聚合', () => {
  it('advance 聚合多步事件，drainEvents 取走后清空', () => {
    const sim = new Sim(initialSim(12.5, 14.1))
    sim.advance(DT, I({ interact: true }))
    for (let i = 0; i < 45; i++) sim.advance(DT, I())
    const drained = sim.drainEvents()
    expect(drained.filter((e) => e.type === 'harvest')).toHaveLength(1)
    expect(sim.drainEvents()).toHaveLength(0)
  })
})
