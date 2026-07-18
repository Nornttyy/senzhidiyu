import { stepPlayer } from './player'
import type { IntentInput, SimState } from './types'

export class Sim {
  readonly dt = 1 / 30
  state: SimState
  prev: SimState
  private acc = 0

  constructor(initial: SimState) {
    this.state = initial
    this.prev = initial
  }

  advance(realDt: number, input: IntentInput): void {
    this.acc += Math.min(realDt, 0.25)
    let interact = input.interact // 边沿只投递给第一步
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      this.state = {
        time: this.state.time + this.dt,
        player: stepPlayer(this.state.player, { ...input, interact }, this.dt),
      }
      interact = false
    }
  }

  alpha(): number { return this.acc / this.dt }
}
