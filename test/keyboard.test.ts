import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
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
  const input = { moveX: 1, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const }
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
    sim.advance(3 / 30, { moveX: 1, moveY: 0, interact: true, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const })
    // 第1步边沿进入采集，第2步移动取消采集回到行走，
    // 第3步若边沿泄漏到后续步会再次进入采集——期望仍为行走
    expect(sim.state.player.action).toBe('walking')
  })
  it('无步帧消费的 interact 边沿被缓存到下一次实际步进', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.01, { moveX: 0, moveY: 0, interact: true, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const }) // 累积不足一步
    expect(sim.state.player.action).toBe('idle')
    sim.advance(0.03, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const }) // 此帧才步进
    expect(sim.state.player.gathering).toBe(true) // 点按边沿被缓存,起手一个完整循环
  })
  it('循环中点按排队到边界续一循环（连点不吞刀）', () => {
    const sim = new Sim(initialSim(20, 20))
    const off = { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 } as const
    const tap = { ...off, interact: true }
    sim.advance(1 / 30, tap)           // 点按1:起手
    sim.advance(1 / 30, off)
    for (let i = 0; i < 15; i++) sim.advance(1 / 30, off) // 推进到循环中段(~0.57s)
    sim.advance(1 / 30, tap)           // 点按2:落在循环中段,应排队
    sim.advance(1 / 30, off)
    for (let i = 0; i < 20; i++) sim.advance(1 / 30, off) // 跨过 1.2s 边界
    expect(sim.state.player.gathering).toBe(true) // 排队的点按在边界续了第二循环
    for (let i = 0; i < 40; i++) sim.advance(1 / 30, off) // 第二循环打完
    expect(sim.state.player.gathering).toBe(false) // 无更多输入,自然收尾
  })

  it('held 跨多步批次在循环边界无缝衔接', () => {
    const sim = new Sim(initialSim(20, 20))
    const held = { moveX: 0, moveY: 0, interact: true, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const } as const
    sim.advance(1 / 30, held) // 起手
    for (let i = 0; i < 7; i++) sim.advance(0.2, held) // 1.4s+,循环边界必落在某批次中段
    expect(sim.state.player.gathering).toBe(true)
    expect(sim.state.time).toBeGreaterThan(CONFIG.gather.duration)
  })
  it('selectSlot 边沿缓存到实际步进帧（无步帧不丢选格）', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.01, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: 4, aimFacing: 0 as const }) // 累积不足一步
    expect(sim.state.world.selected).toBe(0)
    sim.advance(0.03, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const })
    expect(sim.state.world.selected).toBe(4)
  })
  it('clearPendingEdges 同时丢弃缓存的选格', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.01, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: 4, aimFacing: 0 as const })
    sim.clearPendingEdges()
    sim.advance(0.03, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const })
    expect(sim.state.world.selected).toBe(0)
  })
  it('clearPendingEdges 丢弃已缓存未步进的边沿（blur 场景）', () => {
    const sim = new Sim(initialSim(20, 20))
    sim.advance(0.01, { moveX: 0, moveY: 0, interact: true, place: true, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const }) // 缓存但未步进
    sim.clearPendingEdges() // 失焦：陈旧边沿不得在回焦后触发
    sim.advance(0.03, { moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const })
    expect(sim.state.player.gathering).toBe(false)
    expect(sim.state.player.action).toBe('idle')
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

  it('左键按住/松开维护 held 状态', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 0)
    expect(kb.interactHeld()).toBe(true)
    target.dispatchEvent(Object.assign(new Event('pointerup'), { button: 0 }))
    expect(kb.interactHeld()).toBe(false)
  })

  it('blur 同步清除 held', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 0)
    target.dispatchEvent(new Event('blur'))
    expect(kb.interactHeld()).toBe(false)
  })

  it('aimFacing 按指针相对屏幕中线取侧位,无指针信息为 0', () => {
    const { target, kb } = attach()
    expect(kb.aimFacing(900)).toBe(0)
    target.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 100 }))
    expect(kb.aimFacing(900)).toBe(-1)
    target.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 700 }))
    expect(kb.aimFacing(900)).toBe(1)
  })

  it('blur 清除未消费的 interact 锁存，避免失焦幽灵按键', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 0)
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumeInteract()).toBe(false)
  })

  it('KeyE 锁存背包开关边沿，消费一次后清空；blur 清除', () => {
    const { target, kb } = attach()
    dispatchKeydown(target, 'KeyE')
    expect(kb.consumeBagToggle()).toBe(true)
    expect(kb.consumeBagToggle()).toBe(false)
    dispatchKeydown(target, 'KeyE')
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumeBagToggle()).toBe(false)
  })

  it('右键锁存 place 边沿，blur 清除', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 2)
    expect(kb.consumePlace()).toBe(true)
    expect(kb.consumePlace()).toBe(false)
    dispatchPointer(target, 2)
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumePlace()).toBe(false)
  })

  it('数字键选格 1→0、9→8，一次消费', () => {
    const { target, kb } = attach()
    dispatchKeydown(target, 'Digit3')
    expect(kb.consumeSelect()).toBe(2)
    expect(kb.consumeSelect()).toBe(-1)
    dispatchKeydown(target, 'Digit9')
    expect(kb.consumeSelect()).toBe(8)
  })

  it('滚轮给出符号并清零', () => {
    const { target, kb } = attach()
    const wheel = (deltaY: number) => target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }))
    wheel(120)
    expect(kb.consumeWheel()).toBe(1)
    expect(kb.consumeWheel()).toBe(0)
    wheel(-120)
    expect(kb.consumeWheel()).toBe(-1)
  })

  it('鼠标位置实时可读', () => {
    const { target, kb } = attach()
    target.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 333, clientY: 222 }))
    expect(kb.mouse).toEqual({ x: 333, y: 222 })
  })
})
