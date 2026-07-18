import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { clockInfo } from '../src/sim/clock'
import { initialSim } from '../src/sim/types'

const C = () => CONFIG.clock

describe('昼夜时钟派生', () => {
  it('白昼中段：phase=day，dawnRamp 之后 ambient=0', () => {
    const ci = clockInfo(C().dayS / 2)
    expect(ci.phase).toBe('day')
    expect(ci.ambient01).toBe(0)
  })
  it('黎明渐亮：dawnRamp 内 ambient 从 1 线性降 0', () => {
    expect(clockInfo(0).ambient01).toBeCloseTo(1, 5)
    expect(clockInfo(C().dawnRampS / 2).ambient01).toBeCloseTo(0.5, 5)
    expect(clockInfo(C().dawnRampS).ambient01).toBeCloseTo(0, 5)
  })
  it('黄昏：phase=dusk，ambient 等于 phaseK 线性入夜', () => {
    const t = C().dayS + C().duskS * 0.3
    const ci = clockInfo(t)
    expect(ci.phase).toBe('dusk')
    expect(ci.phaseK).toBeCloseTo(0.3, 5)
    expect(ci.ambient01).toBeCloseTo(0.3, 5)
  })
  it('黑夜：phase=night，ambient 恒 1', () => {
    const ci = clockInfo(C().dayS + C().duskS + 1)
    expect(ci.phase).toBe('night')
    expect(ci.ambient01).toBe(1)
  })
  it('相位边界与回绕', () => {
    expect(clockInfo(C().dayS - 0.01).phase).toBe('day')
    expect(clockInfo(C().dayS).phase).toBe('dusk')
    expect(clockInfo(C().dayS + C().duskS).phase).toBe('night')
    const dayLen = C().dayS + C().duskS + C().nightS
    expect(clockInfo(dayLen).phase).toBe('day')
    expect(clockInfo(dayLen + 5).phaseK).toBeCloseTo(clockInfo(5).phaseK, 8)
  })
})

describe('初始世界（昼夜与火源时代）', () => {
  it('开局时刻与初始格：clock=startAt，斧+火把×2，无预置篝火', () => {
    const s = initialSim(20, 20)
    expect(s.world.clock).toBe(C().startAtS)
    expect(s.world.slots[0]).toEqual({ kind: 'axe', count: 1 })
    expect(s.world.slots[1]).toEqual({ kind: 'torch', count: 2 })
    expect(s.world.campfires).toEqual([])
    expect(s.world.plantedTorches).toEqual([])
  })
})
