import { CONFIG } from '../config'

export interface Vec2 { readonly x: number; readonly y: number }
export type PlayerAction = 'idle' | 'walking' // 移动基态；采集为正交通道 PlayerState.gathering

export interface PlayerState {
  readonly pos: Vec2
  readonly facing: 1 | -1
  readonly action: PlayerAction
  readonly prevAction: PlayerAction // 进入当前 action 之前的动作（用于停止回弹等来源判别）
  readonly actionT: number          // 当前动作已持续秒数
  readonly gathering: boolean       // 采集通道（与移动正交）
  readonly gatherT: number          // 采集循环内秒数
  readonly pendingFacingT: number   // 反向输入累计秒数（翻转防抖）
}

export type ItemKind = 'axe' | 'wood' | 'fluorite' | 'sapling' | 'lanternPost' | 'torch' | 'campfire'
export interface ItemStack { readonly kind: ItemKind; readonly count: number }

export type NodeKind = 'tree' | 'ore'
export interface ResourceNode {
  readonly id: number
  readonly kind: NodeKind
  readonly tier: number  // 档位下标，查 CONFIG.tiers
  readonly pos: Vec2
  readonly charges: number // 剩余采集次数
}

export interface DropEntity {
  readonly id: number
  readonly kind: ItemKind
  readonly pos: Vec2
  readonly vel: Vec2
  readonly bornAt: number // 世界时间，供拾取延迟
}

export interface PlantedTorch {
  readonly id: number
  readonly pos: Vec2
  readonly litAt: number // 世界时间,燃尽判定与半径衰减
}

export interface Campfire {
  readonly id: number
  readonly pos: Vec2
  readonly fedAt: number // 最近一次点燃/添柴时刻
}

export interface Planting {
  readonly id: number
  readonly pos: Vec2
  readonly plantedAt: number
}

export type PhantomMode = 'wander' | 'stare' | 'fade' | 'gone'
export interface PhantomState {
  readonly pos: Vec2
  readonly mode: PhantomMode
  readonly modeT: number
  readonly alpha: number  // 0..1 渲染透明度（淡出/淡入由 sim 驱动）
  readonly target: Vec2   // wander 路标
}

export interface WorldState {
  readonly nodes: readonly ResourceNode[]
  readonly posts: readonly Vec2[]
  readonly campfires: readonly Campfire[]
  readonly plantedTorches: readonly PlantedTorch[]
  readonly clock: number // 昼夜时钟秒(模一天长度)
  readonly plantings: readonly Planting[]
  readonly drops: readonly DropEntity[]
  readonly phantom: PhantomState
  readonly slots: readonly (ItemStack | null)[] // 0..hotbar-1 为热键栏
  readonly selected: number                     // 选中热键格 0..hotbar-1
  readonly hp: number
  readonly serenity: number
  readonly lost: boolean
  readonly seed: number
  readonly nextId: number   // 节点/掉落/种植共用发号器
  readonly invFullAt: number // 满包提示节流时刻
}

export interface SimState {
  readonly time: number
  readonly player: PlayerState
  readonly world: WorldState
}

export interface IntentInput {
  readonly moveX: number
  readonly moveY: number
  readonly interact: boolean       // 采集意愿：按住或本帧边沿（Sim 首步吃边沿缓存、后续步吃 held）
  readonly place: boolean          // 放置（鼠标右键）边沿
  readonly aim: Vec2               // 鼠标世界坐标（米）
  readonly selectSlot: number      // 本 tick 选中热键格；-1 无
  readonly aimFacing: 0 | 1 | -1   // 指针在屏幕中线的侧位；0=无指针信息
}

export type SimAction =
  | { readonly type: 'move'; readonly from: number; readonly to: number }
  | { readonly type: 'craft'; readonly recipe: number }

export type SimEvent =
  | { readonly type: 'nodeHit'; readonly nodeId: number; readonly pos: Vec2 }
  | { readonly type: 'nodeBroken'; readonly kind: NodeKind; readonly tier: number; readonly pos: Vec2; readonly nodeId: number }
  | { readonly type: 'pickup'; readonly kind: ItemKind; readonly pos: Vec2 }
  | { readonly type: 'invFull' }
  | { readonly type: 'planted'; readonly pos: Vec2 }
  | { readonly type: 'grown'; readonly pos: Vec2; readonly nodeId: number }
  | { readonly type: 'crafted'; readonly recipe: number }
  | { readonly type: 'postPlaced'; readonly pos: Vec2; readonly index: number }
  | { readonly type: 'phase'; readonly phase: import('./clock').DayPhase }
  | { readonly type: 'torchPlanted'; readonly pos: Vec2 }
  | { readonly type: 'torchBurnt'; readonly pos: Vec2 }
  | { readonly type: 'campfirePlaced'; readonly pos: Vec2 }
  | { readonly type: 'campfireFed'; readonly pos: Vec2 }
  | { readonly type: 'campfireEmber'; readonly pos: Vec2 }
  | { readonly type: 'phantomSigh'; readonly pos: Vec2 }
  | { readonly type: 'lostEnter' }
  | { readonly type: 'lostExit' }

export function initialWorld(seed: number): WorldState {
  const trees = CONFIG.nodes.trees.map((t, i): ResourceNode => ({
    id: i, kind: 'tree', tier: t.tier, pos: { x: t.x, y: t.y }, charges: CONFIG.tiers.tree[t.tier]!.charges,
  }))
  const ores = CONFIG.nodes.ores.map((t, i): ResourceNode => ({
    id: CONFIG.nodes.trees.length + i, kind: 'ore', tier: t.tier, pos: { x: t.x, y: t.y }, charges: CONFIG.tiers.ore[t.tier]!.charges,
  }))
  const slots: (ItemStack | null)[] = Array(CONFIG.inv.slots).fill(null)
  slots[0] = { kind: 'axe', count: 1 }
  slots[1] = { kind: 'torch', count: 2 } // 开局仁慈:保证第一夜
  return {
    nodes: [...trees, ...ores],
    posts: [],
    campfires: [],
    plantedTorches: [],
    clock: CONFIG.clock.startAtS,
    plantings: [],
    drops: [],
    phantom: { pos: CONFIG.phantom.spawn, mode: 'wander', modeT: 0, alpha: 1, target: CONFIG.phantom.spawn },
    slots,
    selected: 0,
    hp: CONFIG.hp.max,
    serenity: CONFIG.serenity.initial,
    lost: false,
    seed,
    nextId: trees.length + ores.length,
    invFullAt: -999,
  }
}

export function initialSim(x: number, y: number, seed = 20260718): SimState {
  return {
    time: 0,
    player: { pos: { x, y }, facing: 1, action: 'idle', prevAction: 'idle', actionT: 0, gathering: false, gatherT: 0, pendingFacingT: 0 },
    world: initialWorld(seed),
  }
}
