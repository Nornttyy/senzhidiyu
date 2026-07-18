import { CONFIG } from '../config'
import type { IntentInput, PlayerState } from './types'

export function stepPlayer(p: PlayerState, input: IntentInput, dt: number): PlayerState {
  const moving = input.moveX !== 0 || input.moveY !== 0
  const before = p.action
  let { facing, action, actionT, gathering, gatherT, pendingFacingT } = p
  let { x, y } = p.pos

  // 移动基态（采集不再互斥）
  const next = moving ? 'walking' : 'idle'
  if (next !== action) { action = next; actionT = 0 }
  actionT += dt

  // 采集通道：起手与无缝衔接边界取 aimFacing 定朝向（挥向鼠标侧，循环内锁定）
  if (!gathering) {
    if (input.interact) {
      gathering = true
      gatherT = 0
      if (input.aimFacing) { facing = input.aimFacing; pendingFacingT = 0 }
    }
  } else {
    gatherT += dt
    if (gatherT >= CONFIG.gather.duration) {
      if (input.interact) {
        gatherT -= CONFIG.gather.duration // 长按无缝衔接，保节拍不吞相位
        if (input.aimFacing) { facing = input.aimFacing; pendingFacingT = 0 }
      } else {
        gathering = false // 松开：打完当前循环自然收尾
        gatherT = 0
      }
    }
  }

  // 位移（边走边砍减速）
  if (moving) {
    const len = Math.hypot(input.moveX, input.moveY)
    const speed = CONFIG.player.speed * (gathering ? CONFIG.gather.moveSpeedFactor : 1)
    const r = CONFIG.player.radius
    x = Math.min(CONFIG.world.width - r, Math.max(r, x + (input.moveX / len) * speed * dt))
    y = Math.min(CONFIG.world.height - r, Math.max(r, y + (input.moveY / len) * speed * dt))
  }

  // 朝向防抖仅在非采集时生效（采集期朝向由循环边界的 aimFacing 锁定）
  if (!gathering) {
    const desired = input.moveX === 0 ? facing : input.moveX > 0 ? 1 : -1
    if (desired === facing) {
      pendingFacingT = 0
    } else {
      pendingFacingT += dt
      if (pendingFacingT >= CONFIG.player.flipDebounce) { facing = desired; pendingFacingT = 0 }
    }
  } else {
    pendingFacingT = 0
  }

  return {
    pos: { x, y }, facing, action,
    prevAction: action === before ? p.prevAction : before, // 记录进入本次移动基态前的动作，供停止回弹判别
    actionT, gathering, gatherT, pendingFacingT,
  }
}
