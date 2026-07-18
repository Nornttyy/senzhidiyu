import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { stepPlayer } from '../src/sim/player'
import type { IntentInput, PlayerState } from '../src/sim/types'

const DT = 1 / 30
const idle = (): PlayerState => ({
  pos: { x: 20, y: 20 }, facing: 1, action: 'idle', prevAction: 'idle' as const, actionT: 0,
  gathering: false, gatherT: 0, pendingFacingT: 0,
})
const input = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, aimFacing: 0, ...o })
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

describe('采集（与移动正交的独立通道）', () => {
  const CYCLE = Math.ceil(CONFIG.gather.duration / DT)
  it('按住开始采集；移动不打断，位移继续但按系数减速', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    expect(p.gathering).toBe(true)
    const x0 = p.pos.x
    p = stepPlayer(p, input({ moveX: 1, interact: true }), DT)
    expect(p.gathering).toBe(true)
    expect(p.action).toBe('walking')
    expect(p.pos.x - x0).toBeCloseTo(CONFIG.player.speed * CONFIG.gather.moveSpeedFactor * DT, 5)
  })
  it('长按跨过循环末无缝衔接（gatherT 回绕保节拍）', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    for (let i = 0; i < CYCLE; i++) p = stepPlayer(p, input({ interact: true }), DT)
    expect(p.gathering).toBe(true)
    expect(p.gatherT).toBeLessThan(0.05)
  })
  it('采集中持续按住不重置循环相位', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    p = stepPlayer(p, input({ interact: true }), DT)
    const t1 = p.gatherT
    p = stepPlayer(p, input({ interact: true }), DT)
    expect(p.gatherT).toBeGreaterThan(t1)
  })
  it('松开后打完当前循环才停止', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    p = run(p, input(), 10)
    expect(p.gathering).toBe(true)
    p = run(p, input(), CYCLE)
    expect(p.gathering).toBe(false)
    expect(p.gatherT).toBe(0)
  })
  it('点按（单帧边沿）恰好完成一个完整循环', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    p = run(p, input(), CYCLE - 1)
    expect(p.gathering).toBe(true)
    p = run(p, input(), 2)
    expect(p.gathering).toBe(false)
  })
  it('采集结束回到纯移动基态且 prevAction 只记录移动转移', () => {
    let p = stepPlayer(idle(), input({ interact: true }), DT)
    p = run(p, input(), CYCLE + 1)
    expect(p.action).toBe('idle')
    expect(p.prevAction).toBe('idle')
  })
})

describe('挥砍朝向鼠标侧', () => {
  it('起手取 aimFacing 定朝向（无防抖延迟）', () => {
    const p = stepPlayer(idle(), input({ interact: true, aimFacing: -1 }), DT)
    expect(p.gathering).toBe(true)
    expect(p.facing).toBe(-1)
  })
  it('循环中换边不立即翻转，衔接边界重采样', () => {
    let p = stepPlayer(idle(), input({ interact: true, aimFacing: -1 }), DT)
    for (let i = 0; i < 10; i++) p = stepPlayer(p, input({ interact: true, aimFacing: 1 }), DT)
    expect(p.facing).toBe(-1) // 循环内锁定
    for (let i = 0; i < Math.ceil(CONFIG.gather.duration / DT); i++) {
      p = stepPlayer(p, input({ interact: true, aimFacing: 1 }), DT)
    }
    expect(p.facing).toBe(1) // 衔接边界取新侧
  })
  it('采集期间移动不抢朝向（防抖挂起）', () => {
    let p = stepPlayer(idle(), input({ interact: true, aimFacing: -1 }), DT)
    for (let i = 0; i < 10; i++) p = stepPlayer(p, input({ moveX: 1, interact: true, aimFacing: -1 }), DT)
    expect(p.facing).toBe(-1)
  })
  it('aimFacing=0（无指针信息）保持当前朝向', () => {
    const p = stepPlayer(idle(), input({ interact: true, aimFacing: 0 }), DT)
    expect(p.facing).toBe(1)
  })
  it('非采集时移动朝向防抖逻辑不变', () => {
    let p = idle()
    const ticks = Math.ceil(CONFIG.player.flipDebounce / DT)
    for (let i = 0; i < ticks - 1; i++) {
      p = stepPlayer(p, input({ moveX: -1, aimFacing: 1 }), DT)
      expect(p.facing).toBe(1)
    }
    p = stepPlayer(p, input({ moveX: -1, aimFacing: 1 }), DT)
    expect(p.facing).toBe(-1) // aimFacing 不采集时无效
  })
})
