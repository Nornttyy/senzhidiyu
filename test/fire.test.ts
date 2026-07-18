import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { campfireLit, campfireRadius, canPlaceAt, stepWorld, torchRadius } from '../src/sim/world'
import { initialSim } from '../src/sim/types'
import type { IntentInput, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput => ({
  moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0, ...o,
})
const run = (s: SimState, inp: IntentInput, ticks: number) => {
  const events = []
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(s, inp, DT)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}
/** 直接改世界状态（测试快捷方式，与 e2e 注入同思路） */
const withWorld = (s: SimState, patch: Partial<SimState['world']>): SimState =>
  ({ ...s, world: { ...s.world, ...patch } })

describe('火把', () => {
  it('选中火把右键插地：扣 1 支、生成实体、发事件', () => {
    let s = withWorld(initialSim(20, 20), { selected: 1 }) // 开局 slots[1]=火把×2
    const aim = { x: 21.5, y: 20 }
    const r = stepWorld(s, I({ place: true, aim }), DT)
    expect(r.state.world.plantedTorches).toHaveLength(1)
    expect(r.state.world.slots[1]).toEqual({ kind: 'torch', count: 1 })
    expect(r.events.some((e) => e.type === 'torchPlanted')).toBe(true)
  })
  it('插地火把 90s 燃尽消失并发事件；半径随余量衰减', () => {
    let s = withWorld(initialSim(20, 20), { selected: 1 })
    s = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 20 } }), DT).state
    const t = s.world.plantedTorches[0]!
    expect(torchRadius(t, s.time)).toBeCloseTo(CONFIG.light.torchPlantedM, 2) // 放置 tick 已燃 1/30s
    expect(torchRadius(t, s.time + CONFIG.fire.torchBurnS / 2))
      .toBeCloseTo((CONFIG.light.torchPlantedM + CONFIG.fire.torchMinM) / 2, 2)
    const { state, events } = run(s, I(), Math.ceil(CONFIG.fire.torchBurnS / DT) + 2)
    expect(state.world.plantedTorches).toHaveLength(0)
    expect(events.filter((e) => e.type === 'torchBurnt')).toHaveLength(1)
  })
})

describe('篝火', () => {
  const withCampfire = () => {
    let s = withWorld(initialSim(20, 20), { selected: 2, slots: (() => {
      const sl = [...initialSim(20, 20).world.slots]
      sl[2] = { kind: 'campfire', count: 1 }
      sl[3] = { kind: 'wood', count: 5 }
      return sl
    })() })
    s = stepWorld(s, I({ place: true, aim: { x: 22, y: 20 } }), DT).state
    return s
  }
  it('放置篝火：实体生成、发事件', () => {
    const s = withCampfire()
    expect(s.world.campfires).toHaveLength(1)
  })
  it('120s 烧成残烬：半径缩至 ember、发一次事件、残烬不回血', () => {
    let s = withCampfire()
    const c0 = s.world.campfires[0]!
    const { state, events } = run(s, I(), Math.ceil(CONFIG.fire.campfireBurnS / DT) + 2)
    const c = state.world.campfires[0]!
    expect(campfireLit(c, state.time)).toBe(false)
    expect(campfireRadius(c, state.time)).toBeCloseTo(CONFIG.fire.campfireEmberM, 3)
    expect(events.filter((e) => e.type === 'campfireEmber')).toHaveLength(1)
    expect(c0.fedAt).toBe(c.fedAt) // 实体保留未重置
  })
  it('持木对篝火右键=添柴：扣 1 木、fedAt 刷新、半径回满', () => {
    let s = withCampfire()
    // 快进到半燃
    s = run(s, I(), Math.ceil(CONFIG.fire.campfireBurnS / 2 / DT)).state
    const before = s.world.campfires[0]!
    expect(campfireRadius(before, s.time)).toBeLessThan(CONFIG.light.campfireM - 0.5)
    const woodSlot = s.world.slots.findIndex((x) => x?.kind === 'wood')
    s = withWorld(s, { selected: woodSlot })
    const r = stepWorld(s, I({ place: true, aim: s.world.campfires[0]!.pos }), DT)
    expect(r.events.some((e) => e.type === 'campfireFed')).toBe(true)
    const after = r.state.world.campfires[0]!
    expect(campfireRadius(after, r.state.time)).toBeCloseTo(CONFIG.light.campfireM, 2)
    expect(r.state.world.slots[woodSlot]!.count).toBe(4)
  })
  it('燃着篝火圈内 hp 回复;残烬圈内不回复', () => {
    let s = withCampfire()
    s = { ...s, world: { ...s.world, hp: 40 } }
    s = run(s, I(), 30).state // 1 秒
    expect(s.world.hp).toBeCloseTo(40 + CONFIG.hp.fireRegen, 1)
    // 快进烧尽成残烬
    s = { ...s, world: { ...s.world, hp: 40, campfires: s.world.campfires.map((c) => ({ ...c, fedAt: c.fedAt - 999 })) } }
    s = run(s, I(), 30).state
    expect(s.world.hp).toBe(40)
  })
  it('放置校验计入火源与古石地标间距', () => {
    const s = withCampfire()
    expect(canPlaceAt(s.world, { x: 20, y: 20 }, s.world.campfires[0]!.pos)).toBe(false)
    expect(canPlaceAt(s.world, { x: 20, y: 19.5 }, CONFIG.landmark)).toBe(false)
  })
})
