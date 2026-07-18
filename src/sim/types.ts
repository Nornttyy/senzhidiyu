import { CONFIG } from '../config'

export interface Vec2 { readonly x: number; readonly y: number }
export type PlayerAction = 'idle' | 'walking' | 'gathering'

export interface PlayerState {
  readonly pos: Vec2
  readonly facing: 1 | -1
  readonly action: PlayerAction
  readonly prevAction: PlayerAction // 进入当前 action 之前的动作（用于停止回弹等来源判别）
  readonly actionT: number          // 当前动作已持续秒数
  readonly gatherT: number          // 采集循环内秒数
  readonly pendingFacingT: number   // 反向输入累计秒数（翻转防抖）
}

export type NodeKind = 'tree' | 'ore'
export interface ResourceNode {
  readonly id: number
  readonly kind: NodeKind
  readonly pos: Vec2
  readonly charges: number // 剩余采集次数，0 为耗尽
}

export type PhantomMode = 'wander' | 'stare' | 'fade' | 'gone'
export interface PhantomState {
  readonly pos: Vec2
  readonly mode: PhantomMode
  readonly modeT: number
  readonly alpha: number  // 0..1 渲染透明度（淡出/淡入由 sim 驱动）
  readonly target: Vec2   // wander 路标
}

export interface Inventory { readonly wood: number; readonly fluorite: number }

export interface WorldState {
  readonly nodes: readonly ResourceNode[]
  readonly posts: readonly Vec2[]
  readonly phantom: PhantomState
  readonly inventory: Inventory
  readonly serenity: number
  readonly lost: boolean
  readonly placing: boolean
  readonly seed: number
}

export interface SimState {
  readonly time: number
  readonly player: PlayerState
  readonly world: WorldState
}

export interface IntentInput {
  readonly moveX: number
  readonly moveY: number
  readonly interact: boolean // 采集（鼠标左键）边沿
  readonly craft: boolean    // 合成/放置（E）边沿
}

export type SimEvent =
  | { readonly type: 'harvest'; readonly kind: NodeKind; readonly nodeId: number; readonly pos: Vec2; readonly depleted: boolean }
  | { readonly type: 'phantomSigh'; readonly pos: Vec2 }
  | { readonly type: 'crafted' }
  | { readonly type: 'postPlaced'; readonly pos: Vec2; readonly index: number }
  | { readonly type: 'lostEnter' }
  | { readonly type: 'lostExit' }

export function initialWorld(seed: number): WorldState {
  const trees = CONFIG.nodes.trees.map((pos, i): ResourceNode => ({
    id: i, kind: 'tree', pos, charges: CONFIG.nodes.treeCharges,
  }))
  const ores = CONFIG.nodes.ores.map((pos, i): ResourceNode => ({
    id: CONFIG.nodes.trees.length + i, kind: 'ore', pos, charges: CONFIG.nodes.oreCharges,
  }))
  return {
    nodes: [...trees, ...ores],
    posts: [],
    phantom: { pos: CONFIG.phantom.spawn, mode: 'wander', modeT: 0, alpha: 1, target: CONFIG.phantom.spawn },
    inventory: { wood: 0, fluorite: 0 },
    serenity: CONFIG.serenity.initial,
    lost: false,
    placing: false,
    seed,
  }
}

export function initialSim(x: number, y: number, seed = 20260718): SimState {
  return {
    time: 0,
    player: { pos: { x, y }, facing: 1, action: 'idle', prevAction: 'idle', actionT: 0, gatherT: 0, pendingFacingT: 0 },
    world: initialWorld(seed),
  }
}
