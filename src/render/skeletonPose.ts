import { CONFIG } from '../config'
import type { PlayerAction } from '../sim/types'

export interface SkeletonPoseInput {
  action: PlayerAction
  actionT: number
  gathering: boolean
  gatherT: number
}

export interface SkeletonPose {
  body: number
  head: number
  crouch: number
  frontUpperArm: number
  frontLowerArm: number
  backUpperArm: number
  backLowerArm: number
  frontUpperLeg: number
  frontLowerLeg: number
  backUpperLeg: number
  backLowerLeg: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const smooth = (v: number): number => {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * 采样侧面纸偶的关节角度。正数把垂下的肢体转向角色身后，
 * 负数转向角色面朝的前方；角色整体翻面时方向会自动镜像。
 */
export function skeletonPose(input: SkeletonPoseInput): SkeletonPose {
  const pose: SkeletonPose = {
    body: 0, head: 0, crouch: 0,
    frontUpperArm: 0, frontLowerArm: 0, backUpperArm: 0, backLowerArm: 0,
    frontUpperLeg: 0, frontLowerLeg: 0, backUpperLeg: 0, backLowerLeg: 0,
  }

  if (input.action === 'walking') {
    const steps = input.actionT * (CONFIG.player.speed / CONFIG.anim.strideM)
    const swing = Math.sin(Math.PI * steps)
    pose.body = -0.035
    pose.head = 0.02
    pose.crouch = 8 * Math.abs(Math.sin(Math.PI * steps))
    pose.frontUpperLeg = swing * 0.48
    pose.backUpperLeg = -swing * 0.48
    pose.frontLowerLeg = Math.max(0, swing) * 0.72
    pose.backLowerLeg = Math.max(0, -swing) * 0.72
    pose.frontUpperArm = -swing * 0.34
    pose.backUpperArm = swing * 0.34
    pose.frontLowerArm = Math.max(0, -swing) * 0.18
    pose.backLowerArm = Math.max(0, swing) * 0.18
  }

  if (input.gathering) {
    const g = CONFIG.gather
    let upper: number
    let lower: number
    let strike = 0
    if (input.gatherT < g.windup) {
      // 前 72% 时间完成抬手，末段短暂停住，让蓄力动作明确指向身后上方。
      const t = smooth(input.gatherT / (g.windup * 0.72))
      upper = mix(0, 2.6, t)
      lower = mix(0, -0.45, t)
    } else if (input.gatherT < g.hitAt) {
      const t = smooth((input.gatherT - g.windup) / g.swing)
      upper = mix(2.6, -1.2, t)
      lower = mix(-0.45, 0.35, t)
      strike = t
    } else {
      const t = smooth((input.gatherT - g.hitAt) / (g.duration - g.hitAt))
      upper = mix(-1.2, 0, t)
      lower = mix(0.35, 0, t)
      strike = 1 - t
    }
    pose.frontUpperArm = upper
    pose.frontLowerArm = lower
    pose.backUpperArm = -0.35 - upper * 0.12
    pose.backLowerArm = 0.2
    pose.frontUpperLeg = -0.08
    pose.backUpperLeg = 0.16
    pose.frontLowerLeg = 0.28 * strike
    pose.backLowerLeg = 0.18 * strike
    pose.body = -0.16 * strike
    pose.head = 0.08 * strike
    pose.crouch = 24 * strike
  }

  return pose
}
