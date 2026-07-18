import { CONFIG } from '../config'
import type { IntentInput, PlayerState } from './types'

export function stepPlayer(p: PlayerState, input: IntentInput, dt: number): PlayerState {
  const moving = input.moveX !== 0 || input.moveY !== 0
  const before = p.action
  let { facing, action, actionT, gatherT, pendingFacingT } = p
  let { x, y } = p.pos

  // 动作状态机
  if (action === 'gathering') {
    if (moving) {
      action = 'walking'; actionT = 0; gatherT = 0
    } else {
      gatherT += dt; actionT += dt
      if (gatherT >= CONFIG.gather.duration) { action = 'idle'; actionT = 0; gatherT = 0 }
    }
  } else if (input.interact) {
    action = 'gathering'; actionT = 0; gatherT = 0
  } else {
    const next = moving ? 'walking' : 'idle'
    if (next !== action) { action = next; actionT = 0 }
    actionT += dt
  }

  // 位移（采集中不动）
  if (action === 'walking') {
    const len = Math.hypot(input.moveX, input.moveY)
    const vx = (input.moveX / len) * CONFIG.player.speed
    const vy = (input.moveY / len) * CONFIG.player.speed
    const r = CONFIG.player.radius
    x = Math.min(CONFIG.world.width - r, Math.max(r, x + vx * dt))
    y = Math.min(CONFIG.world.height - r, Math.max(r, y + vy * dt))
  }

  // 朝向防抖：反向水平输入持续 flipDebounce 秒才翻转
  const desired = input.moveX === 0 ? facing : input.moveX > 0 ? 1 : -1
  if (desired === facing) {
    pendingFacingT = 0
  } else {
    pendingFacingT += dt
    if (pendingFacingT >= CONFIG.player.flipDebounce) { facing = desired; pendingFacingT = 0 }
  }

  return {
    pos: { x, y }, facing, action,
    prevAction: action === before ? p.prevAction : before, // 记录进入本次 action 前的动作，供来源相关的动画效果判别
    actionT, gatherT, pendingFacingT,
  }
}
