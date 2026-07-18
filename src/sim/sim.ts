import { stepPlayer } from './player'
import type { IntentInput, SimState } from './types'

export class Sim {
  readonly dt = 1 / 30
  state: SimState
  prev: SimState
  private acc = 0
  private pendingInteract = false

  constructor(initial: SimState) {
    this.state = initial
    this.prev = initial
  }

  advance(realDt: number, input: IntentInput): void {
    this.acc += Math.min(realDt, 0.25)
    if (input.interact) this.pendingInteract = true // 缓存边沿直到真正步进
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      this.state = {
        time: this.state.time + this.dt,
        player: stepPlayer(this.state.player, { ...input, interact: this.pendingInteract }, this.dt),
        world: this.state.world, // 过渡：Task 2 起由 stepWorld 步进
      }
      this.pendingInteract = false // 只投递给第一个实际执行的步
    }
  }

  alpha(): number { return this.acc / this.dt }
}
