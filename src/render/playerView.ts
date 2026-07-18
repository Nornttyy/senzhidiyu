import { Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import type { SimState } from '../sim/types'
import { animate, type AnimSample } from './characterAnimator'

export interface EventSinks {
  footstep(xM: number, yM: number): void
  gatherHit(xM: number, yM: number): void
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export class PlayerView {
  readonly sprite: Sprite
  private baseScale: number
  private lastActionT = 0
  private lastGatherT = 0
  private lastAction = 'idle'

  constructor(tex: Texture) {
    this.sprite = new Sprite(tex)
    this.sprite.anchor.set(0.5, 1) // 脚底中心
    this.baseScale = (CONFIG.player.heightM * CONFIG.pxPerMeter) / tex.height
  }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, sinks: EventSinks): void {
    const pp = prev.player
    const cp = cur.player
    const sameAction = pp.action === cp.action
    // 跨动作切换时不插值计时器（动作文档 §5：跨帧判定基于同一动作内的区间）
    const actionT = sameAction ? lerp(pp.actionT, cp.actionT, alphaV) : cp.actionT
    const gatherT = sameAction ? lerp(pp.gatherT, cp.gatherT, alphaV) : cp.gatherT
    const sample: AnimSample = {
      action: cp.action, fromAction: cp.prevAction, facing: cp.facing,
      actionT, prevActionT: this.lastAction === cp.action ? this.lastActionT : 0,
      gatherT, prevGatherT: this.lastAction === cp.action ? this.lastGatherT : 0,
      time: timeS,
    }
    this.lastAction = cp.action; this.lastActionT = actionT; this.lastGatherT = gatherT

    const { transform, events } = animate(sample)
    const px = CONFIG.pxPerMeter
    const xM = lerp(pp.pos.x, cp.pos.x, alphaV)
    const yM = lerp(pp.pos.y, cp.pos.y, alphaV)
    this.sprite.position.set(xM * px + transform.offsetXPx, yM * px + transform.offsetYPx)
    this.sprite.rotation = transform.rotation
    this.sprite.scale.set(this.baseScale * transform.scaleX * cp.facing, this.baseScale * transform.scaleY)
    this.sprite.zIndex = yM * px

    for (const e of events) {
      if (e === 'footstep') sinks.footstep(xM, yM)
      else sinks.gatherHit(xM + cp.facing * 0.6, yM - 0.5)
    }
  }
}
