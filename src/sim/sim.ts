import { CONFIG } from '../config'
import { stepWorld } from './world'
import type { IntentInput, SimAction, SimEvent, SimState } from './types'

export class Sim {
  readonly dt = 1 / 30
  state: SimState
  prev: SimState
  private acc = 0
  private pendingInteract = false
  private pendingPlace = false
  private pendingSelect = -1
  private actions: SimAction[] = []
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
    if (input.place) this.pendingPlace = true
    if (input.selectSlot >= 0) this.pendingSelect = input.selectSlot // 无步帧不丢选格（终审#0）
    let first = true
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      const pl = this.state.player
      const edgeUsable = !pl.gathering || pl.gatherT + this.dt >= CONFIG.gather.duration - 1e-8
      const inp = {
        ...input,
        interact: input.interact || (edgeUsable && this.pendingInteract),
        place: first ? this.pendingPlace : false, // 放置维持纯边沿
        selectSlot: first ? this.pendingSelect : -1,
      }
      const acts = first ? this.actions : []
      if (first && this.actions.length) this.actions = []
      const r = stepWorld(this.state, inp, this.dt, acts)
      this.state = r.state
      this.events.push(...r.events)
      if (edgeUsable) this.pendingInteract = false
      if (first) { this.pendingPlace = false; this.pendingSelect = -1; first = false }
    }
  }

  alpha(): number { return this.acc / this.dt }

  /** UI 权威动作（搬格/合成）：缓冲到下个实际步进帧一次性交付 */
  queueAction(a: SimAction): void { this.actions.push(a) }

  /** 失焦/开合背包时丢弃已缓存未步进的输入边沿与排队动作，避免回焦后触发陈旧操作 */
  clearPendingEdges(): void {
    this.pendingInteract = false
    this.pendingPlace = false
    this.pendingSelect = -1
    this.actions = []
  }

  /** 取走自上次 drain 以来聚合的 sim 事件 */
  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
