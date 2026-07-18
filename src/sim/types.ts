export interface Vec2 { x: number; y: number }
export type PlayerAction = 'idle' | 'walking' | 'gathering'

export interface PlayerState {
  pos: Vec2
  facing: 1 | -1
  action: PlayerAction
  prevAction: PlayerAction // 进入当前 action 之前的动作（用于判别停止回弹等来源相关效果）
  actionT: number        // 当前动作已持续秒数
  gatherT: number        // 采集循环内秒数
  pendingFacingT: number // 反向输入累计秒数（翻转防抖）
}

export interface SimState { time: number; player: PlayerState }

export interface IntentInput { moveX: number; moveY: number; interact: boolean }

export function initialSim(x: number, y: number): SimState {
  return {
    time: 0,
    player: { pos: { x, y }, facing: 1, action: 'idle', prevAction: 'idle', actionT: 0, gatherT: 0, pendingFacingT: 0 },
  }
}
