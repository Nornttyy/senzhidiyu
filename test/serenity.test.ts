import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'
import { serenityRate, stepWorld } from '../src/sim/world'
import type { IntentInput, SimEvent, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, aimFacing: 0 as const })
const S = CONFIG.serenity

function run(s: SimState, n: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) { const r = stepWorld(s, I(), DT); s = r.state; events.push(...r.events) }
  return { state: s, events }
}
/** 修改世界字段构造测试态 */
const withWorld = (s: SimState, w: Partial<SimState['world']>): SimState => ({ ...s, world: { ...s.world, ...w } })

describe('serenityRate 档位', () => {
  it('柱/篝火圈 > 提灯 > 黑暗；注视叠加', () => {
    expect(serenityRate(true, true, false)).toBe(S.zoneRegen)
    expect(serenityRate(false, true, false)).toBe(S.lanternDrain)
    expect(serenityRate(false, false, false)).toBe(S.darkDrain)
    expect(serenityRate(false, true, true)).toBe(S.lanternDrain + S.stareDrain)
    expect(serenityRate(true, true, true)).toBe(S.zoneRegen + S.stareDrain)
  })
})

describe('安宁值结算', () => {
  it('野外提灯下每秒 -0.5', () => {
    const { state } = run(initialSim(5, 5), 30)
    expect(state.world.serenity).toBeCloseTo(S.initial + S.lanternDrain, 3)
  })
  it('营地篝火圈内回升并夹紧上限', () => {
    const low = withWorld(initialSim(20, 20.8), { serenity: 99 }) // 出生点在篝火 6m 圈内
    const { state } = run(low, 30)
    expect(state.world.serenity).toBe(S.max)
  })
  it('提灯柱圈内回升', () => {
    const s = withWorld(initialSim(5, 5), { serenity: 50, posts: [{ x: 5, y: 5 }] })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBeCloseTo(50 + S.zoneRegen, 2)
  })
  it('幻影注视 8m 内额外掉', () => {
    const s = withWorld(initialSim(5, 5), {
      serenity: 50,
      phantom: { pos: { x: 5, y: 12.5 }, mode: 'stare', modeT: 0, alpha: 1, target: { x: 5, y: 12.5 } },
    })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBeCloseTo(50 + S.lanternDrain + S.stareDrain, 2)
  })
  it('注视掉率随 stare 模式滞回：8–9m 滞回带内仍持续掉', () => {
    const s = withWorld(initialSim(5, 5), {
      serenity: 50, // 幻影 8.5m：已进入 stare 后退到滞回带内
      phantom: { pos: { x: 5, y: 13.5 }, mode: 'stare', modeT: 1, alpha: 1, target: { x: 5, y: 13.5 } },
    })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBeCloseTo(50 + S.lanternDrain + S.stareDrain, 2)
  })
  it('夹紧 0 不为负', () => {
    const s = withWorld(initialSim(5, 5), { serenity: 0.01 })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBe(0)
  })
})

describe('迷失滞回', () => {
  it('跌破 30 触发 lostEnter 一次；30–40 间不解除；升至 40 触发 lostExit', () => {
    let s = withWorld(initialSim(5, 5), { serenity: 30.005 })
    let r = run(s, 3) // -0.5/s 很快跌破
    expect(r.events.filter((e) => e.type === 'lostEnter')).toHaveLength(1)
    expect(r.state.world.lost).toBe(true)
    // 30–40 之间维持迷失
    let mid = withWorld(r.state, { serenity: 35 })
    r = run(mid, 3)
    expect(r.state.world.lost).toBe(true)
    expect(r.events.filter((e) => e.type === 'lostExit')).toHaveLength(0)
    // 站到柱圈内回升越过 40 解除
    mid = withWorld(r.state, { serenity: 39.9, posts: [{ x: 5, y: 5 }] })
    r = run(mid, 30)
    expect(r.events.filter((e) => e.type === 'lostExit')).toHaveLength(1)
    expect(r.state.world.lost).toBe(false)
  })
})
