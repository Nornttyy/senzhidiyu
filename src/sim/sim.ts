import { stepWorld } from './world'
import type { IntentInput, SimEvent, SimState } from './types'

export class Sim {
  readonly dt = 1 / 30
  state: SimState
  prev: SimState
  private acc = 0
  private pendingInteract = false
  private pendingCraft = false
  private events: SimEvent[] = []

  constructor(initial: SimState) {
    this.state = initial
    this.prev = initial
  }

  advance(realDt: number, input: IntentInput): void {
    this.acc += Math.min(realDt, 0.25)
    if (input.interact) this.pendingInteract = true // 缓存边沿直到真正步进
    if (input.craft) this.pendingCraft = true
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      const r = stepWorld(this.state, { ...input, interact: this.pendingInteract, craft: this.pendingCraft }, this.dt)
      this.state = r.state
      this.events.push(...r.events)
      this.pendingInteract = false // 只投递给第一个实际执行的步
      this.pendingCraft = false
    }
  }

  alpha(): number { return this.acc / this.dt }

  /** 取走自上次 drain 以来聚合的 sim 事件 */
  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
