import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { stepPlayer } from '../src/sim/player'
import type { IntentInput, PlayerState } from '../src/sim/types'

const DT = 1 / 30
const idle = (): PlayerState => ({
  pos: { x: 20, y: 20 }, facing: 1, action: 'idle', prevAction: 'idle' as const, actionT: 0, gatherT: 0, pendingFacingT: 0,
})
const input = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, ...o })
const run = (p: PlayerState, inp: IntentInput, ticks: number) => {
  for (let i = 0; i < ticks; i++) p = stepPlayer(p, inp, DT)
  return p
}

describe('移动', () => {
  it('斜向速度归一化为 speed', () => {
    const p = run(idle(), input({ moveX: 1, moveY: 1 }), 30) // 1 秒
    const d = Math.hypot(p.pos.x - 20, p.pos.y - 20)
    expect(d).toBeCloseTo(CONFIG.player.speed, 1)
  })
  it('位置被世界边界收窄', () => {
    const p = run(idle(), input({ moveX: -1 }), 30 * 20)
    expect(p.pos.x).toBeCloseTo(CONFIG.player.radius, 5)
  })
  it('有移动输入时 action=walking，停止后回 idle 且 actionT 归零', () => {
    let p = run(idle(), input({ moveX: 1 }), 3)
    expect(p.action).toBe('walking')
    expect(p.actionT).toBeCloseTo(3 * DT, 5)
    p = stepPlayer(p, input(), DT)
    expect(p.action).toBe('idle')
    expect(p.actionT).toBeCloseTo(DT, 5)
  })
  it('不修改入参（纯函数）', () => {
    const p = idle()
    stepPlayer(p, input({ moveX: 1 }), DT)
    expect(p.pos.x).toBe(20)
    expect(p.action).toBe('idle')
  })
})

describe('朝向防抖', () => {
  it('反向输入需持续 flipDebounce 才翻转', () => {
    let p = idle()
    const ticks = Math.ceil(CONFIG.player.flipDebounce / DT)
    for (let i = 0; i < ticks - 1; i++) {
      p = stepPlayer(p, input({ moveX: -1 }), DT)
      expect(p.facing).toBe(1)
    }
    p = stepPlayer(p, input({ moveX: -1 }), DT)
    expect(p.facing).toBe(-1)
  })
  it('快速交替不翻转', () => {
    let p = idle()
    for (let i = 0; i < 60; i++) p = stepPlayer(p, input({ moveX: i % 2 ? -1 : 1 }), DT)
    expect(p.facing).toBe(1)
  })
})

describe('采集', () => {
  it('E 边沿进入 gathering，1.2s 后自动回 idle', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    expect(p.action).toBe('gathering')
    p = run(p, input(), Math.ceil(CONFIG.gather.duration / DT))
    expect(p.action).toBe('idle')
    expect(p.prevAction).toBe('gathering')
  })
  it('采集中移动输入立即取消回 walking', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    p = stepPlayer(p, input({ moveX: 1 }), DT)
    expect(p.action).toBe('walking')
    expect(p.gatherT).toBe(0)
  })
  it('采集中再按 E 不重置循环', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    const t1 = p.gatherT
    p = stepPlayer(p, input({ interact: true }), DT)
    expect(p.gatherT).toBeGreaterThan(t1)
  })
})
