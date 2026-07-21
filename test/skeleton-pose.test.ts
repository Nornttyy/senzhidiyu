import { describe, expect, it } from 'vitest'
import { skeletonPose } from '../src/render/skeletonPose'

describe('角色骨骼姿势', () => {
  it('行走时手脚前后交替并弯曲膝盖', () => {
    const p = skeletonPose({ action: 'walking', actionT: 0.25, gathering: false, gatherT: 0 })
    expect(p.frontUpperLeg).toBeGreaterThan(0)
    expect(p.backUpperLeg).toBeLessThan(0)
    expect(p.frontUpperArm).toBeLessThan(0)
    expect(p.frontLowerLeg).toBeGreaterThan(0)
  })

  it('面朝右时挥斧从身后蓄力后劈向前方', () => {
    const windup = skeletonPose({ action: 'idle', actionT: 0, gathering: true, gatherT: 0.3 })
    const strike = skeletonPose({ action: 'idle', actionT: 0, gathering: true, gatherT: 0.45 })
    expect(windup.frontUpperArm).toBeGreaterThan(0)
    expect(windup.frontLowerArm).toBeLessThan(0)
    expect(strike.frontUpperArm).toBeLessThan(0)
    expect(strike.frontLowerArm).toBeGreaterThan(0)
  })

  it('不用动作时所有骨骼保持正位', () => {
    const p = skeletonPose({ action: 'idle', actionT: 1, gathering: false, gatherT: 0 })
    expect(p.frontUpperArm).toBe(0)
    expect(p.frontUpperLeg).toBe(0)
    expect(p.crouch).toBe(0)
  })
})
