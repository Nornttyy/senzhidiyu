import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { animate, type AnimSample } from '../src/render/characterAnimator'

const base = (o: Partial<AnimSample> = {}): AnimSample => ({
  action: 'idle', fromAction: 'idle' as const, facing: 1, actionT: 1, prevActionT: 0.97, gatherT: 0, prevGatherT: 0, time: 10, ...o,
})

describe('确定性与待机', () => {
  it('同输入同输出', () => {
    expect(animate(base())).toEqual(animate(base()))
  })
  it('待机呼吸幅度在配置范围内且无事件', () => {
    for (let t = 0; t < 5; t += 0.05) {
      const { transform, events } = animate(base({ time: t, actionT: t + 1, prevActionT: t + 1 - 0.05 }))
      expect(Math.abs(transform.scaleY - 1)).toBeLessThanOrEqual(CONFIG.anim.breathAmp + 1e-9)
      expect(events).toEqual([])
    }
  })
})

describe('行走', () => {
  const stepRate = CONFIG.player.speed / CONFIG.anim.strideM // 2 步/秒
  it('2 秒行走恰好 4 次落脚，与帧率无关', () => {
    for (const fps of [30, 48, 144]) {
      let events = 0
      const dt = 1 / fps
      for (let t = dt; t <= 2 + 1e-9; t += dt) {
        const r = animate(base({ action: 'walking', actionT: t, prevActionT: t - dt, time: t }))
        events += r.events.filter((e) => e === 'footstep').length
      }
      expect(events).toBe(Math.floor(2 * stepRate))
    }
  })
  it('落脚时刻 offsetY 归零（波谷踩地）', () => {
    const tLand = 1 / stepRate
    const { transform } = animate(base({ action: 'walking', actionT: tLand, prevActionT: tLand - 0.01, time: tLand }))
    expect(Math.abs(transform.offsetYPx)).toBeLessThan(0.35)
  })
  it('前倾随朝向取号', () => {
    const r1 = animate(base({ action: 'walking', actionT: 0.3, prevActionT: 0.29 }))
    const r2 = animate(base({ action: 'walking', facing: -1, actionT: 0.3, prevActionT: 0.29 }))
    expect(r1.transform.rotation).toBeCloseTo(CONFIG.anim.lean, 5)
    expect(r2.transform.rotation).toBeCloseTo(-CONFIG.anim.lean, 5)
  })
})

describe('采集', () => {
  const g = CONFIG.gather
  const at = (t: number, prev: number) =>
    animate(base({ action: 'gathering', gatherT: t, prevGatherT: prev, actionT: t, prevActionT: prev }))
  it('蓄力末端到达后仰角', () => {
    expect(at(g.windup, g.windup - 0.01).transform.rotation).toBeCloseTo(g.backAngle, 3)
  })
  it('命中时刻到达前劈角', () => {
    expect(at(g.hitAt, g.hitAt - 0.01).transform.rotation).toBeCloseTo(g.chopAngle, 3)
  })
  it('循环末回正', () => {
    expect(at(g.duration, g.duration - 0.01).transform.rotation).toBeCloseTo(0, 3)
  })
  it('命中事件恰在跨越 hitAt 时发一次，各帧率一致', () => {
    for (const dt of [1 / 30, 1 / 144, 0.4]) {
      let hits = 0
      for (let t = dt; t <= g.duration + 1e-9; t += dt) {
        hits += at(t, t - dt).events.filter((e) => e === 'gatherHit').length
      }
      expect(hits).toBe(1)
    }
  })
  it('朝向 -1 时角度镜像', () => {
    const r = animate(base({ action: 'gathering', facing: -1, gatherT: g.hitAt, prevGatherT: g.hitAt - 0.01, actionT: g.hitAt, prevActionT: g.hitAt - 0.01 }))
    expect(r.transform.rotation).toBeCloseTo(-g.chopAngle, 3)
  })
  it('命中判定容忍帧时间累积欠差', () => {
    // 累积 dt 时 gatherT 可能落在 hitAt 下方 1e-9 级别，仍应命中且仅一次
    const just = g.hitAt - 1e-9
    const r = at(just, just - 0.01)
    expect(r.events).toEqual(['gatherHit'])
    const next = at(just + 0.01, just)
    expect(next.events).toEqual([])
  })
})

describe('停止回弹', () => {
  it('walk 转 idle 后 stopRebound 内旋转从 lean 平滑衰减到 0', () => {
    const early = animate(base({ action: 'idle', fromAction: 'walking', actionT: 0.01, prevActionT: 0 }))
    const late = animate(base({ action: 'idle', fromAction: 'walking', actionT: CONFIG.anim.stopRebound, prevActionT: CONFIG.anim.stopRebound - 0.01 }))
    expect(Math.abs(early.transform.rotation)).toBeGreaterThan(Math.abs(late.transform.rotation))
    expect(late.transform.rotation).toBeCloseTo(0, 3)
  })
  it('从采集回到待机不播放停止回弹', () => {
    const r = animate(base({ action: 'idle', fromAction: 'gathering', actionT: 0.01, prevActionT: 0 }))
    expect(r.transform.rotation).toBeCloseTo(0, 5)
  })
})
