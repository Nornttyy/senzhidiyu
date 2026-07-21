import { Container, Sprite } from 'pixi.js'
import { CONFIG } from '../config'
import { lerp } from '../sim/vec'
import { selectedKind } from '../sim/world'
import type { SimState } from '../sim/types'
import { animate, type AnimSample } from './characterAnimator'
import type { GameTextures } from './textures'

export interface EventSinks {
  footstep(xM: number, yM: number): void
  gatherHit(xM: number, yM: number): void
}

export class PlayerView {
  readonly container = new Container()
  readonly sprite: Sprite
  private held = new Sprite()
  private baseScale: number
  private heldKind: 'axe' | 'torch' | null = null
  private lastActionT = 0
  private lastGatherT = 0
  private lastGathering = false
  private lastAction = 'idle'

  constructor(private tex: GameTextures) {
    this.sprite = new Sprite(tex.seeker)
    this.sprite.anchor.set(0.5, 1) // 脚底中心
    this.baseScale = (CONFIG.player.heightM * CONFIG.pxPerMeter) / tex.seeker.height
    // 手持物作为角色子图层，跟着转身、走路和挥砍一起动。
    this.held.visible = false
    this.container.addChild(this.sprite, this.held)
  }

  /** 斧头和火把显示在手上；其他物品保持收进背包，避免遮住角色。 */
  private syncHeld(kind: ReturnType<typeof selectedKind>): void {
    const next = kind === 'axe' || kind === 'torch' ? kind : null
    if (next === this.heldKind) return
    this.heldKind = next
    this.held.visible = next !== null
    if (next === null) return
    const t = next === 'axe' ? this.tex.axe : this.tex.torch
    this.held.texture = t
    this.held.position.set(150, -395)
    if (next === 'axe') {
      this.held.anchor.set(0.72, 0.82)
      this.held.scale.set(350 / t.height)
      this.held.rotation = -0.12
    } else {
      this.held.anchor.set(0.5, 0.82)
      this.held.scale.set(460 / t.height)
      this.held.rotation = 0.08
    }
  }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, sinks: EventSinks): void {
    const pp = prev.player
    const cp = cur.player
    const sameAction = pp.action === cp.action
    // 跨动作切换时不插值计时器（动作文档 §5）；采集通道独立判定，
    // 无缝衔接回绕（cur < prev）时不插值直接取 cur，避免倒放半循环
    const actionT = sameAction ? lerp(pp.actionT, cp.actionT, alphaV) : cp.actionT
    const sameGather = pp.gathering === cp.gathering && cp.gatherT >= pp.gatherT
    const gatherT = sameGather ? lerp(pp.gatherT, cp.gatherT, alphaV) : cp.gatherT
    const gatherContinues = this.lastGathering && cp.gathering && gatherT >= this.lastGatherT
    const sample: AnimSample = {
      action: cp.action, gathering: cp.gathering, fromAction: cp.prevAction, facing: cp.facing,
      actionT, prevActionT: this.lastAction === cp.action ? this.lastActionT : 0,
      gatherT, prevGatherT: gatherContinues ? this.lastGatherT : 0,
      time: timeS,
    }
    this.lastAction = cp.action; this.lastActionT = actionT
    this.lastGathering = cp.gathering; this.lastGatherT = gatherT

    const { transform, events } = animate(sample)
    this.syncHeld(selectedKind(cur.world))
    const px = CONFIG.pxPerMeter
    const xM = lerp(pp.pos.x, cp.pos.x, alphaV)
    const yM = lerp(pp.pos.y, cp.pos.y, alphaV)
    this.container.position.set(xM * px + transform.offsetXPx, yM * px + transform.offsetYPx)
    this.container.rotation = transform.rotation
    this.container.scale.set(this.baseScale * transform.scaleX * cp.facing, this.baseScale * transform.scaleY)
    this.container.zIndex = yM * px

    for (const e of events) {
      if (e === 'footstep') sinks.footstep(xM, yM)
      else sinks.gatherHit(xM + cp.facing * 0.6, yM - 0.5)
    }
  }
}
