import { Container, Sprite, Texture } from 'pixi.js'
import type { ItemKind, PlayerAction } from '../sim/types'
import { skeletonPose } from './skeletonPose'
import type { GameTextures } from './textures'

interface Limb {
  upper: Container
  lower: Container
}

const scaledSprite = (texture: Texture, height: number, anchorX: number, anchorY: number): Sprite => {
  const sprite = new Sprite(texture)
  const scale = height / Math.max(1, texture.height)
  sprite.scale.set(scale)
  sprite.anchor.set(anchorX, anchorY)
  return sprite
}

const makeLimb = (
  upperTexture: Texture, lowerTexture: Texture,
  upperHeight: number, lowerHeight: number,
  jointY: number, lowerAnchorX: number, lowerAnchorY: number,
): Limb => {
  const upper = new Container()
  const lower = new Container()
  const upperSprite = scaledSprite(upperTexture, upperHeight, 0.5, 0.03)
  const lowerSprite = scaledSprite(lowerTexture, lowerHeight, lowerAnchorX, lowerAnchorY)
  lower.position.set(0, jointY)
  lower.addChild(lowerSprite)
  // 先画下半段、再画上半段，让布料在关节处互相盖住，不露缝。
  upper.addChild(lower, upperSprite)
  return { upper, lower }
}

/** 由独立头、身体、上下手臂、上下腿组成的侧面纸偶。 */
export class PlayerRig {
  readonly container = new Container()
  readonly frontSprite: Sprite

  private front = new Container()
  private side = new Container()
  private frontAxe: Sprite
  private frontTorch: Sprite
  private bodyBone = new Container()
  private headBone = new Container()
  private backArm: Limb
  private frontArm: Limb
  private backLeg: Limb
  private frontLeg: Limb
  private sideAxe: Sprite
  private sideTorch: Sprite

  constructor(tex: GameTextures) {
    this.frontSprite = new Sprite(tex.seeker)
    this.frontSprite.anchor.set(0.5, 0.94)
    this.front.addChild(this.frontSprite)

    // 正面待机仍使用同一张固定正脸，工具作为独立物件放到手边。
    this.frontAxe = new Sprite(tex.axe)
    this.frontAxe.anchor.set(0.78, 0.88)
    this.frontAxe.position.set(-150, -265)
    this.frontAxe.rotation = -1.48
    this.frontAxe.scale.set(0.27)
    this.frontTorch = new Sprite(tex.torch)
    this.frontTorch.anchor.set(0.5, 0.76)
    this.frontTorch.position.set(205, -255)
    this.frontTorch.scale.set(0.15)
    this.front.addChild(this.frontAxe, this.frontTorch)

    this.backArm = makeLimb(tex.seekerSideUpperArm, tex.seekerSideLowerArm, 210, 220, 132, 0.5, 0.03)
    this.frontArm = makeLimb(tex.seekerSideUpperArm, tex.seekerSideLowerArm, 210, 220, 132, 0.5, 0.03)
    this.backLeg = makeLimb(tex.seekerSideUpperLeg, tex.seekerSideLowerLeg, 255, 250, 236, 0.34, 0.17)
    this.frontLeg = makeLimb(tex.seekerSideUpperLeg, tex.seekerSideLowerLeg, 255, 250, 236, 0.34, 0.17)

    this.backArm.upper.alpha = 0.76
    this.backLeg.upper.alpha = 0.78
    this.backArm.upper.position.set(-12, -145)
    this.frontArm.upper.position.set(75, -145)
    this.backLeg.upper.position.set(-32, -445)
    this.frontLeg.upper.position.set(12, -445)

    const body = scaledSprite(tex.seekerSideBody, 465, 0.5, 0.41)
    this.bodyBone.position.set(-10, -420)
    this.headBone.position.set(42, -150)
    const head = scaledSprite(tex.seekerSideHead, 260, 0.5, 0.87)
    this.headBone.addChild(head)
    this.bodyBone.addChild(this.backArm.upper, body, this.headBone, this.frontArm.upper)
    this.side.addChild(this.backLeg.upper, this.frontLeg.upper, this.bodyBone)

    // 斧刃在基础右朝向中位于前方；挥砍关节由身后上方转向前下方。
    this.sideAxe = new Sprite(tex.axe)
    this.sideAxe.anchor.set(0.78, 0.9)
    this.sideAxe.position.set(2, 208)
    this.sideAxe.rotation = Math.PI
    this.sideAxe.scale.set(-0.25, 0.25)
    this.sideTorch = new Sprite(tex.torch)
    this.sideTorch.anchor.set(0.5, 0.76)
    // 火把放在身体前侧，避免竖直时被斗篷完全遮住。
    this.sideTorch.position.set(35, 195)
    this.sideTorch.scale.set(0.15)
    this.frontArm.lower.addChild(this.sideAxe, this.sideTorch)

    this.container.addChild(this.front, this.side)
    this.side.visible = false
  }

  update(kind: ItemKind | null, action: PlayerAction, actionT: number, gathering: boolean, gatherT: number): void {
    const sideActive = action === 'walking' || gathering
    this.front.visible = !sideActive
    this.side.visible = sideActive
    this.frontAxe.visible = kind === 'axe'
    this.frontTorch.visible = kind === 'torch'
    this.sideAxe.visible = kind === 'axe'
    this.sideTorch.visible = kind === 'torch'

    const pose = skeletonPose({ action, actionT, gathering, gatherT })
    this.bodyBone.position.y = -420 + pose.crouch * 0.55
    this.bodyBone.rotation = pose.body
    this.headBone.rotation = pose.head
    this.frontArm.upper.rotation = pose.frontUpperArm
    this.frontArm.lower.rotation = pose.frontLowerArm
    this.backArm.upper.rotation = pose.backUpperArm
    this.backArm.lower.rotation = pose.backLowerArm
    this.frontLeg.upper.position.y = -445 + pose.crouch * 0.35
    this.backLeg.upper.position.y = -445 + pose.crouch * 0.35
    this.frontLeg.upper.rotation = pose.frontUpperLeg
    this.frontLeg.lower.rotation = pose.frontLowerLeg
    this.backLeg.upper.rotation = pose.backUpperLeg
    this.backLeg.lower.rotation = pose.backLowerLeg

    // 火把跟随手的位置，但用反向角抵消手臂摆动，火焰始终朝上。
    this.sideTorch.rotation = -(pose.body + pose.frontUpperArm + pose.frontLowerArm)
  }
}
