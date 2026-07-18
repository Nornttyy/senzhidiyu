import { CONFIG } from '../config'
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

  private prevInteract = false

  advance(realDt: number, input: IntentInput): void {
    this.acc += Math.min(realDt, 0.25)
    // 上升沿入队:点按被缓存到"能用"的步(空闲即刻/循环中排队到边界续砍);
    // 纯 held 不重复入队,松开后不会靠陈旧缓存多砍一循环
    if (input.interact && !this.prevInteract) this.pendingInteract = true
    this.prevInteract = input.interact
    if (input.craft) this.pendingCraft = true
    let first = true
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      const pl = this.state.player
      const edgeUsable = !pl.gathering || pl.gatherT + this.dt >= CONFIG.gather.duration - 1e-8
      const inp = {
        ...input,
        interact: input.interact || (edgeUsable && this.pendingInteract),
        craft: first ? this.pendingCraft : false, // craft 维持纯边沿
      }
      const r = stepWorld(this.state, inp, this.dt)
      this.state = r.state
      this.events.push(...r.events)
      if (edgeUsable) this.pendingInteract = false
      if (first) { this.pendingCraft = false; first = false }
    }
  }

  alpha(): number { return this.acc / this.dt }

  /** 失焦时丢弃已缓存未步进的输入边沿，避免回焦后触发陈旧操作 */
  clearPendingEdges(): void {
    this.pendingInteract = false
    this.pendingCraft = false
  }

  /** 取走自上次 drain 以来聚合的 sim 事件 */
  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
