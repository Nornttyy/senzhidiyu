import { Container, Sprite } from 'pixi.js'
import { CONFIG } from '../config'
import { lerp } from '../sim/vec'
import { selectedKind } from '../sim/world'
import type { SimState } from '../sim/types'
import { animate, type AnimSample } from './characterAnimator'
import { PlayerRig } from './playerRig'
import type { GameTextures } from './textures'

const ALIGNED_CANVAS_H = 1000
const ALIGNED_BODY_H = 800

export interface EventSinks {
  footstep(xM: number, yM: number): void
  gatherHit(xM: number, yM: number): void
}

export class PlayerView {
  readonly container = new Container()
  readonly sprite: Sprite
  private rig: PlayerRig
  private baseScale: number
  private lastActionT = 0
  private lastGatherT = 0
  private lastGathering = false
  private lastAction = 'idle'

  constructor(tex: GameTextures) {
    this.rig = new PlayerRig(tex)
    this.sprite = this.rig.frontSprite
    const aligned = tex.seeker.height === ALIGNED_CANVAS_H
    // 所有正式帧都按角色本体 800px 定标；工具伸出画布时不会反过来缩小角色。
    const sourceBodyH = aligned ? ALIGNED_BODY_H : tex.seeker.height
    this.baseScale = (CONFIG.player.heightM * CONFIG.pxPerMeter) / sourceBodyH
    this.container.addChild(this.rig.container)
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
    const kind = selectedKind(cur.world)
    this.rig.update(kind, cp.action, actionT, cp.gathering, gatherT)
    const px = CONFIG.pxPerMeter
    const xM = lerp(pp.pos.x, cp.pos.x, alphaV)
    const yM = lerp(pp.pos.y, cp.pos.y, alphaV)
    this.container.position.set(xM * px + transform.offsetXPx, yM * px + transform.offsetYPx)
    // 转身、走路和挥斧都由关节处理，世界容器不再整块旋转。
    this.container.rotation = 0
    this.container.scale.set(this.baseScale * transform.scaleX * cp.facing, this.baseScale * transform.scaleY)
    this.container.zIndex = yM * px

    for (const e of events) {
      if (e === 'footstep') sinks.footstep(xM, yM)
      else sinks.gatherHit(xM + cp.facing * 0.6, yM - 0.5)
    }
  }
}
