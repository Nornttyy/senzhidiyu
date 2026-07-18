import { describe, expect, it } from 'vitest'
import { intentFromKeys } from '../src/input/keyboard'
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
  const input = { moveX: 1, moveY: 0, interact: false }
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
})
