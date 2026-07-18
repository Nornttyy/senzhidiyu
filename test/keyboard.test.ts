import { describe, expect, it } from 'vitest'
import { intentFromKeys, Keyboard } from '../src/input/keyboard'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'

describe('intentFromKeys', () => {
  it('WASD 与方向键映射', () => {
    expect(intentFromKeys(new Set(['KeyW']))).toEqual({ moveX: 0, moveY: -1 })
    expect(intentFromKeys(new Set(['ArrowDown', 'KeyD']))).toEqual({ moveX: 1, moveY: 1 })
  })
  it('对冲键抵消', () => {
    expect(intentFromKeys(new Set(['KeyA', 'KeyD']))).toEqual({ moveX: 0, moveY: 0 })
  })
})

describe('Sim 固定步长', () => {
  const input = { moveX: 1, moveY: 0, interact: false, craft: false }
  it('累积 realDt 按 1/30 整步执行，余量留在 alpha', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.05, input) // 1 步 + 余 0.0167
    expect(sim.state.player.pos.x).toBeCloseTo(20 + 4 / 30, 5)
    expect(sim.alpha()).toBeGreaterThan(0.4)
    expect(sim.alpha()).toBeLessThan(0.6)
  })
  it('prev 保存上一步快照供插值', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(1 / 30, input)
    sim.advance(1 / 30, input)
    expect(sim.prev.player.pos.x).toBeLessThan(sim.state.player.pos.x)
  })
  it('超长帧被钳制不产生螺旋', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(5, input) // 钳到 0.25s => 至多 ~8 步
    expect(sim.state.player.pos.x).toBeLessThan(20 + 4 * 0.3)
  })
  it('interact 边沿只投递给首个 sim 步', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(3 / 30, { moveX: 1, moveY: 0, interact: true, craft: false })
    // 第1步边沿进入采集，第2步移动取消采集回到行走，
    // 第3步若边沿泄漏到后续步会再次进入采集——期望仍为行走
    expect(sim.state.player.action).toBe('walking')
  })
  it('无步帧消费的 interact 边沿被缓存到下一次实际步进', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.01, { moveX: 0, moveY: 0, interact: true, craft: false }) // 累积不足一步
    expect(sim.state.player.action).toBe('idle')
    sim.advance(0.03, { moveX: 0, moveY: 0, interact: false, craft: false }) // 此帧才步进
    expect(sim.state.player.action).toBe('gathering')
  })
})

describe('Keyboard 交互锁存', () => {
  const dispatchKeydown = (target: EventTarget, code: string) =>
    target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }))
  const dispatchPointer = (target: EventTarget, button: number) =>
    target.dispatchEvent(Object.assign(new Event('pointerdown'), { button }))
  const attach = () => {
    const target = new EventTarget() as unknown as Window
    const kb = new Keyboard()
    kb.attach(target)
    return { target, kb }
  }

  it('鼠标左键锁存一次采集边沿', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 0)
    expect(kb.consumeInteract()).toBe(true)
    expect(kb.consumeInteract()).toBe(false)
  })

  it('右键/中键不触发采集', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 2)
    dispatchPointer(target, 1)
    expect(kb.consumeInteract()).toBe(false)
  })

  it('E 键不再触发采集（留给未来合成/放置）', () => {
    const { target, kb } = attach()
    dispatchKeydown(target, 'KeyE')
    expect(kb.consumeInteract()).toBe(false)
  })

  it('首次输入回调兼容鼠标（音频解锁手势）', () => {
    const { target, kb } = attach()
    let fired = 0
    kb.onFirstInput = () => fired++
    dispatchPointer(target, 0)
    dispatchKeydown(target, 'KeyW')
    expect(fired).toBe(1)
  })

  it('blur 清除未消费的 interact 锁存，避免失焦幽灵按键', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 0)
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumeInteract()).toBe(false)
  })
})
