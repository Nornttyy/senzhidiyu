# 切片A内容补完 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补完切片 A 全部剩余玩法内容——资源实体与采集收益、安宁值/迷失、幻影状态机、篝火合成与提灯柱放置、灯光世界坐标化、环境音与 UI——达到"5 分钟完整循环"验收标准。

**Architecture:** sim 层新增 `stepWorld` 编排（玩家→采集→E→幻影→安宁值，全纯函数 + 事件数组返回值），`Sim` 聚合事件供 `drainEvents()` 消费；渲染层新增 `worldView`（实体精灵）、`ui`（屏幕层 HUD）、`lostFx`（迷失表现），`LightLayer` 改世界米坐标；音频扩展主低通链 + 常驻风/低鸣。规格：`docs/superpowers/specs/2026-07-18-slice-a-content-design.md`。

**Tech Stack:** TypeScript、PixiJS ^8、Vite ^6（Node 18 上限，禁升 7）、vitest ^3。零新增依赖。

## Global Constraints

- Node 18.20.4 硬上限：Vite 锁 ^6，**不得引入任何新依赖**（含 playwright，环境全局工具不进 package.json）
- `src/sim/` 内禁止 import pixi.js（联机预留）
- 逻辑单位米，渲染 `pxPerMeter: 48`；角色/实体锚点脚底中心 (0.5, 1)，`zIndex = yPx` 排序
- 全部数值集中 `src/config.ts`
- 每张 `Assets.load` 纹理必须 `source.autoGenerateMipmaps = true`；素材缺失自动程序占位
- 术语统一"安宁值"；界面文案中文
- dev/preview 验证一律 `127.0.0.1` 显式 IPv4（容器 IPv6 端口串台）
- 提交信息中文 + type 前缀 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 分支 `feat/slice-a-content`，起于 main

## 文件结构

```
src/config.ts                  # 扩展：serenity/phantom/craft/nodes/campfire/sizes/lost
src/sim/types.ts               # 全 readonly 化；WorldState/ResourceNode/PhantomState/SimEvent/craft 输入
src/sim/rand.ts                # 新：mulberry32 纯函数（种子串行）
src/sim/vec.ts                 # 新：dist/clamp/moveToward
src/sim/world.ts               # 新：stepWorld 编排 + nearestNodeIdx/serenityRate/canCraft/previewPos
src/sim/phantom.ts             # 新：stepPhantom 状态机
src/sim/sim.ts                 # 改：走 stepWorld、craft 锁存、事件聚合 drainEvents
src/input/keyboard.ts          # 改：KeyE craft 锁存
src/render/hints.ts            # 新：deriveHint 纯函数（零 pixi）
src/render/textures.ts         # 改：六图全量加载 + 各自占位
src/render/lightLayer.ts       # 改：世界米坐标 + alpha/flicker 每灯参数
src/render/worldView.ts        # 新：树/矿/篝火/柱/幻影/放置预览渲染
src/render/particles.ts        # 改：通用 spawn 选项 + firefly/glint/ember
src/render/lostFx.ts           # 新：迷失 vignette + 降饱和
src/render/ui.ts               # 新：背包/蒲公英/情境提示/toast
src/audio/sfx.ts               # 改：主低通链/风/低鸣/轻叹/收益音/重arm
src/main.ts                    # 改：全量装配
test/rand.test.ts  test/world.test.ts  test/serenity.test.ts
test/phantom.test.ts  test/craft.test.ts  test/hints.test.ts
test/sim-player.test.ts(改)  test/keyboard.test.ts(改)
```

---

### Task 1: config/类型扩展与随机数（TDD）

**Files:**
- Create: `src/sim/rand.ts`, `src/sim/vec.ts`
- Modify: `src/config.ts`（全量替换）, `src/sim/types.ts`（全量替换）
- Test: `test/rand.test.ts`, `test/world.test.ts`（初始状态部分）
- Modify: `test/sim-player.test.ts`, `test/keyboard.test.ts`（`IntentInput` 增 `craft` 字段）

**Interfaces:**
- Consumes: 无
- Produces:
  - `CONFIG` 新增段（见下，后续任务只读它）
  - 全 readonly 类型：`WorldState/ResourceNode/PhantomState/Inventory/SimEvent/NodeKind/PhantomMode`
  - `IntentInput` 增 `readonly craft: boolean`
  - `initialSim(x, y, seed = 20260718)`、`initialWorld(seed): WorldState`
  - `nextRand(seed: number): { value: number; seed: number }`（[0,1)，种子串行）
  - `dist(a,b)/clamp(v,lo,hi)/moveToward(from,to,step)`

- [ ] **Step 1: 建分支**

```bash
git checkout -b feat/slice-a-content main
```

- [ ] **Step 2: 写失败测试**

`test/rand.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { nextRand } from '../src/sim/rand'

describe('nextRand', () => {
  it('同种子序列完全一致', () => {
    const seq = (seed: number, n: number) => {
      const out: number[] = []
      for (let i = 0; i < n; i++) { const r = nextRand(seed); out.push(r.value); seed = r.seed }
      return out
    }
    expect(seq(42, 10)).toEqual(seq(42, 10))
  })
  it('值域 [0,1) 且非常数', () => {
    let seed = 7
    const vals: number[] = []
    for (let i = 0; i < 100; i++) { const r = nextRand(seed); vals.push(r.value); seed = r.seed }
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(new Set(vals.map((v) => v.toFixed(6))).size).toBeGreaterThan(90)
  })
})
```

`test/world.test.ts`（本任务只写初始状态块，后续任务追加）:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'

describe('初始世界', () => {
  const w = initialSim(20, 20.8).world
  it('6 树 4 次数、3 矿 5 次数，id 唯一', () => {
    const trees = w.nodes.filter((n) => n.kind === 'tree')
    const ores = w.nodes.filter((n) => n.kind === 'ore')
    expect(trees).toHaveLength(6)
    expect(ores).toHaveLength(3)
    expect(trees.every((n) => n.charges === CONFIG.nodes.treeCharges)).toBe(true)
    expect(ores.every((n) => n.charges === CONFIG.nodes.oreCharges)).toBe(true)
    expect(new Set(w.nodes.map((n) => n.id)).size).toBe(9)
  })
  it('初值：安宁 100、背包空、无柱、不放置、幻影 wander', () => {
    expect(w.serenity).toBe(CONFIG.serenity.initial)
    expect(w.inventory).toEqual({ wood: 0, fluorite: 0 })
    expect(w.posts).toEqual([])
    expect(w.placing).toBe(false)
    expect(w.phantom.mode).toBe('wander')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/rand.test.ts test/world.test.ts`
Expected: FAIL — rand 模块不存在；initialSim 无 world 字段

- [ ] **Step 4: 实现**

`src/sim/rand.ts`:
```ts
/** mulberry32 的纯函数形态：种子显式串行传递，测试与回放可复现 */
export function nextRand(seed: number): { value: number; seed: number } {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: s }
}
```

`src/sim/vec.ts`:
```ts
import type { Vec2 } from './types'

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function moveToward(from: Vec2, to: Vec2, step: number): Vec2 {
  const d = dist(from, to)
  if (d <= step || d === 0) return to
  return { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step }
}
```

`src/config.ts`（全量替换）:
```ts
const DEG = Math.PI / 180

export const CONFIG = {
  pxPerMeter: 48,
  world: { width: 40, height: 40 }, // 米
  player: { speed: 4, radius: 0.35, heightM: 1.7, flipDebounce: 0.1, spawn: { x: 20, y: 20.8 } },
  gather: {
    duration: 1.2, windup: 0.3, swing: 0.15, hitAt: 0.45,
    backAngle: -8 * DEG, chopAngle: 15 * DEG,
    rangeM: 1.6,
  },
  anim: {
    breathAmp: 0.015, breathPeriod: 2.5,
    bobAmpPx: 5, strideM: 2, lean: 4 * DEG, stopRebound: 0.15,
  },
  light: {
    lanternRadiusM: 3.5, flickerAmp: 0.06, darkness: 0.94,
    campfireRadiusM: 6, postRadiusM: 5,
    oreGlow: { radiusM: 1.2, alpha: 0.35 }, treeGlow: { radiusM: 0.9, alpha: 0.25 },
  },
  serenity: {
    max: 100, initial: 100, lostBelow: 30, clearAt: 40,
    zoneRegen: 5, lanternDrain: -0.5, darkDrain: -3, stareDrain: -2, // 每秒
  },
  phantom: {
    speed: 0.6, stareRange: 8, stareExit: 9, dissolveRange: 6,
    fadeDur: 1.2, goneDur: 6, fadeInDur: 1, respawnMinDist: 12,
    ringMin: 10, ringMax: 18, spawn: { x: 32, y: 32 },
  },
  craft: { rangeM: 2.5, wood: 10, fluorite: 5, placeAheadM: 1.5, edgeMarginM: 1 },
  campfire: { x: 20, y: 19 },
  nodes: {
    treeCharges: 4, oreCharges: 5,
    trees: [
      { x: 12.5, y: 13 }, { x: 27, y: 11.5 }, { x: 31.5, y: 22 },
      { x: 9, y: 25.5 }, { x: 15.5, y: 31 }, { x: 25.5, y: 29.5 },
    ],
    ores: [{ x: 7.5, y: 16.5 }, { x: 33, y: 15.5 }, { x: 21.5, y: 34.5 }],
  },
  sizes: { treeH: 3.2, oreH: 1.1, campfireH: 1.3, postH: 2.2, phantomH: 1.8 }, // 米
  lost: { rampRate: 1.5, lowpassHz: 700, desatMax: 0.75, vignetteMax: 0.9 },
  colors: { night: 0x101612, ground: 0x1c2418 },
} as const
```

`src/sim/types.ts`（全量替换；全 readonly）:
```ts
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
```

`test/sim-player.test.ts` 的 `input` 辅助改为（补 `craft`）:
```ts
const input = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, ...o })
```

`test/keyboard.test.ts` 中 `Sim 固定步长` 的 `const input = { moveX: 1, moveY: 0, interact: false }` 改为:
```ts
const input = { moveX: 1, moveY: 0, interact: false, craft: false }
```
同文件"无步帧消费的 interact 边沿"测试内的两个 advance 调用字面量同样补 `craft: false`。

- [ ] **Step 5: 全量测试确认绿**

Run: `npx vitest run`
Expected: 既有 30 + 新 4 全绿（types 变更不破坏 stepPlayer/Sim）

Run: `npm run check`
Expected: 无输出（readonly 化后如有赋值报错，修实现处而非放宽类型）

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/sim/types.ts src/sim/rand.ts src/sim/vec.ts test/rand.test.ts test/world.test.ts test/sim-player.test.ts test/keyboard.test.ts
git commit -m "feat(sim): 世界状态类型/布局配置/串行随机数，接口全 readonly 化"
```

---

### Task 2: stepWorld 采集收益与事件管道（TDD）

**Files:**
- Create: `src/sim/world.ts`
- Modify: `src/sim/sim.ts`
- Test: `test/world.test.ts`（追加）

**Interfaces:**
- Consumes: `stepPlayer`、Task 1 类型与 `dist`
- Produces:
  - `stepWorld(s: SimState, input: IntentInput, dt: number): { state: SimState; events: SimEvent[] }`
  - `nearestNodeIdx(nodes: readonly ResourceNode[], pos: Vec2, rangeM: number): number`（无则 -1）
  - `Sim.drainEvents(): SimEvent[]`；`Sim.advance` 同时锁存 interact 与 craft 边沿

- [ ] **Step 1: 写失败测试**

`test/world.test.ts` 追加:
```ts
import { stepWorld, nearestNodeIdx } from '../src/sim/world'
import { Sim } from '../src/sim/sim'
import type { IntentInput, SimEvent, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, ...o })

function runTicks(s: SimState, inp: IntentInput, n: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = stepWorld(s, inp, DT)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

/** 一轮完整采集：首 tick interact，之后空输入直到循环结束 */
function gatherOnce(s: SimState): { state: SimState; events: SimEvent[] } {
  const first = stepWorld(s, I({ interact: true }), DT)
  const rest = runTicks(first.state, I(), 45) // 1.5s > duration
  return { state: rest.state, events: [...first.events, ...rest.events] }
}

describe('采集收益', () => {
  // 树0 在 (12.5,13)；站它南侧 1.1m 处
  const nearTree = () => initialSim(12.5, 14.1)

  it('一轮采集：wood+1、charges-1、单次 harvest 事件', () => {
    const { state, events } = gatherOnce(nearTree())
    const h = events.filter((e) => e.type === 'harvest')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ kind: 'tree', nodeId: 0, depleted: false })
    expect(state.world.inventory.wood).toBe(1)
    expect(state.world.nodes[0]!.charges).toBe(CONFIG.nodes.treeCharges - 1)
  })
  it('第 4 次采集 depleted=true，之后空挥无事件', () => {
    let s = nearTree()
    let all: SimEvent[] = []
    for (let i = 0; i < 5; i++) { const r = gatherOnce(s); s = r.state; all = [...all, ...r.events] }
    const h = all.filter((e) => e.type === 'harvest')
    expect(h).toHaveLength(4)
    expect(h[3]).toMatchObject({ depleted: true })
    expect(s.world.nodes[0]!.charges).toBe(0)
    expect(s.world.inventory.wood).toBe(4)
  })
  it('范围外空挥：无事件无扣减', () => {
    const { state, events } = gatherOnce(initialSim(20, 25)) // 离所有节点都远
    expect(events.filter((e) => e.type === 'harvest')).toHaveLength(0)
    expect(state.world.inventory.wood).toBe(0)
  })
  it('采集被移动打断不结算', () => {
    const first = stepWorld(initialSim(12.5, 14.1), I({ interact: true }), DT)
    const r = runTicks(first.state, I({ moveX: 1 }), 45) // 立即走动打断
    expect(r.events.filter((e) => e.type === 'harvest')).toHaveLength(0)
  })
  it('矿采集得 fluorite', () => {
    const { state, events } = gatherOnce(initialSim(7.5, 17.6)) // 矿0 (7.5,16.5) 南侧 1.1m
    expect(events.filter((e) => e.type === 'harvest')[0]).toMatchObject({ kind: 'ore' })
    expect(state.world.inventory.fluorite).toBe(1)
  })
  it('nearestNodeIdx 取最近未耗尽节点', () => {
    const w = initialSim(20, 20).world
    const nodes = [
      { ...w.nodes[0]!, pos: { x: 20, y: 21.5 } },          // 1.5m
      { ...w.nodes[1]!, pos: { x: 20, y: 21 } },            // 1.0m 更近
      { ...w.nodes[2]!, pos: { x: 20, y: 20.5 }, charges: 0 }, // 最近但耗尽
    ]
    expect(nearestNodeIdx(nodes, { x: 20, y: 20 }, 1.6)).toBe(1)
    expect(nearestNodeIdx(nodes, { x: 5, y: 5 }, 1.6)).toBe(-1)
  })
})

describe('Sim 事件聚合', () => {
  it('advance 聚合多步事件，drainEvents 取走后清空', () => {
    const sim = new Sim(initialSim(12.5, 14.1))
    sim.advance(DT, I({ interact: true }))
    for (let i = 0; i < 45; i++) sim.advance(DT, I())
    const drained = sim.drainEvents()
    expect(drained.filter((e) => e.type === 'harvest')).toHaveLength(1)
    expect(sim.drainEvents()).toHaveLength(0)
  })
})
```
（文件顶部 import 区补 `stepWorld/nearestNodeIdx/Sim` 等；`describe/expect/it/CONFIG/initialSim` 已在。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/world.test.ts`
Expected: FAIL — world 模块不存在

- [ ] **Step 3: 实现**

`src/sim/world.ts`:
```ts
import { CONFIG } from '../config'
import { stepPlayer } from './player'
import { dist } from './vec'
import type { IntentInput, ResourceNode, SimEvent, SimState, Vec2 } from './types'

const EPS = 1e-8 // 与 characterAnimator 同源的帧时间漂移容差

/** 交互半径内最近的未耗尽节点下标；无则 -1 */
export function nearestNodeIdx(nodes: readonly ResourceNode[], pos: Vec2, rangeM: number): number {
  let best = -1
  let bestD = rangeM
  nodes.forEach((n, i) => {
    if (n.charges <= 0) return
    const d = dist(n.pos, pos)
    if (d <= bestD) { bestD = d; best = i }
  })
  return best
}

export function stepWorld(s: SimState, input: IntentInput, dt: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  const prevPlayer = s.player
  const player = stepPlayer(prevPlayer, input, dt)
  let world = s.world

  // 采集收益：同一采集循环内 gatherT 跨越 hitAt 的 tick 结算（打断则无）
  const crossedHit = prevPlayer.action === 'gathering' && player.action === 'gathering'
    && prevPlayer.gatherT + EPS < CONFIG.gather.hitAt && player.gatherT + EPS >= CONFIG.gather.hitAt
  if (crossedHit) {
    const idx = nearestNodeIdx(world.nodes, player.pos, CONFIG.gather.rangeM)
    if (idx >= 0) {
      const node = world.nodes[idx]!
      const charges = node.charges - 1
      world = {
        ...world,
        nodes: world.nodes.map((n, i) => (i === idx ? { ...n, charges } : n)),
        inventory: node.kind === 'tree'
          ? { ...world.inventory, wood: world.inventory.wood + 1 }
          : { ...world.inventory, fluorite: world.inventory.fluorite + 1 },
      }
      events.push({ type: 'harvest', kind: node.kind, nodeId: node.id, pos: node.pos, depleted: charges === 0 })
    }
  }

  return { state: { time: s.time + dt, player, world }, events }
}
```

`src/sim/sim.ts`（全量替换）:
```ts
import { stepWorld } from './world'
import type { IntentInput, SimEvent, SimState } from './types'

export class Sim {
  readonly dt = 1 / 30
  state: SimState
  prev: SimState
  private acc = 0
  private pendingInteract = false
  private pendingCraft = false
  private events: SimEvent[] = []

  constructor(initial: SimState) {
    this.state = initial
    this.prev = initial
  }

  advance(realDt: number, input: IntentInput): void {
    this.acc += Math.min(realDt, 0.25)
    if (input.interact) this.pendingInteract = true // 缓存边沿直到真正步进
    if (input.craft) this.pendingCraft = true
    while (this.acc >= this.dt) {
      this.acc -= this.dt
      this.prev = this.state
      const r = stepWorld(this.state, { ...input, interact: this.pendingInteract, craft: this.pendingCraft }, this.dt)
      this.state = r.state
      this.events.push(...r.events)
      this.pendingInteract = false // 只投递给第一个实际执行的步
      this.pendingCraft = false
    }
  }

  alpha(): number { return this.acc / this.dt }

  /** 取走自上次 drain 以来聚合的 sim 事件 */
  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
```

- [ ] **Step 4: 全量测试确认绿**

Run: `npx vitest run && npm run check`
Expected: 全绿；类型无错

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts src/sim/sim.ts test/world.test.ts
git commit -m "feat(sim): stepWorld 采集收益结算与事件管道（跨帧命中/最近节点/耗尽）"
```

---

### Task 3: 安宁值结算与迷失滞回（TDD）

**Files:**
- Modify: `src/sim/world.ts`
- Test: `test/serenity.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `stepWorld` 结构
- Produces: `serenityRate(inZone: boolean, hasLantern: boolean, staring: boolean): number`；`stepWorld` 末尾追加安宁值结算与 `lostEnter/lostExit` 事件

- [ ] **Step 1: 写失败测试**

`test/serenity.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'
import { serenityRate, stepWorld } from '../src/sim/world'
import type { IntentInput, SimEvent, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false })
const S = CONFIG.serenity

function run(s: SimState, n: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) { const r = stepWorld(s, I(), DT); s = r.state; events.push(...r.events) }
  return { state: s, events }
}
/** 修改世界字段构造测试态 */
const withWorld = (s: SimState, w: Partial<SimState['world']>): SimState => ({ ...s, world: { ...s.world, ...w } })

describe('serenityRate 档位', () => {
  it('柱/篝火圈 > 提灯 > 黑暗；注视叠加', () => {
    expect(serenityRate(true, true, false)).toBe(S.zoneRegen)
    expect(serenityRate(false, true, false)).toBe(S.lanternDrain)
    expect(serenityRate(false, false, false)).toBe(S.darkDrain)
    expect(serenityRate(false, true, true)).toBe(S.lanternDrain + S.stareDrain)
    expect(serenityRate(true, true, true)).toBe(S.zoneRegen + S.stareDrain)
  })
})

describe('安宁值结算', () => {
  it('野外提灯下每秒 -0.5', () => {
    const { state } = run(initialSim(5, 5), 30)
    expect(state.world.serenity).toBeCloseTo(S.initial + S.lanternDrain, 3)
  })
  it('营地篝火圈内回升并夹紧上限', () => {
    const low = withWorld(initialSim(20, 20.8), { serenity: 99 }) // 出生点在篝火 6m 圈内
    const { state } = run(low, 30)
    expect(state.world.serenity).toBe(S.max)
  })
  it('提灯柱圈内回升', () => {
    const s = withWorld(initialSim(5, 5), { serenity: 50, posts: [{ x: 5, y: 5 }] })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBeCloseTo(50 + S.zoneRegen, 2)
  })
  it('幻影注视 8m 内额外掉', () => {
    const s = withWorld(initialSim(5, 5), {
      serenity: 50,
      phantom: { pos: { x: 5, y: 10 }, mode: 'stare', modeT: 0, alpha: 1, target: { x: 5, y: 10 } },
    })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBeCloseTo(50 + S.lanternDrain + S.stareDrain, 2)
  })
  it('夹紧 0 不为负', () => {
    const s = withWorld(initialSim(5, 5), { serenity: 0.01 })
    const { state } = run(s, 30)
    expect(state.world.serenity).toBe(0)
  })
})

describe('迷失滞回', () => {
  it('跌破 30 触发 lostEnter 一次；30–40 间不解除；升至 40 触发 lostExit', () => {
    let s = withWorld(initialSim(5, 5), { serenity: 30.005 })
    let r = run(s, 3) // -0.5/s 很快跌破
    expect(r.events.filter((e) => e.type === 'lostEnter')).toHaveLength(1)
    expect(r.state.world.lost).toBe(true)
    // 30–40 之间维持迷失
    let mid = withWorld(r.state, { serenity: 35 })
    r = run(mid, 3)
    expect(r.state.world.lost).toBe(true)
    expect(r.events.filter((e) => e.type === 'lostExit')).toHaveLength(0)
    // 站到柱圈内回升越过 40 解除
    mid = withWorld(r.state, { serenity: 39.9, posts: [{ x: 5, y: 5 }] })
    r = run(mid, 30)
    expect(r.events.filter((e) => e.type === 'lostExit')).toHaveLength(1)
    expect(r.state.world.lost).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/serenity.test.ts`
Expected: FAIL — serenityRate 未导出

- [ ] **Step 3: 实现**

`src/sim/world.ts` 增加导出并在 `stepWorld` 的 `return` 前插入结算块（import 区补 `clamp`）:
```ts
/** 安宁值每秒变化率：档位互斥取最高，注视为叠加项 */
export function serenityRate(inZone: boolean, hasLantern: boolean, staring: boolean): number {
  const S = CONFIG.serenity
  const base = inZone ? S.zoneRegen : hasLantern ? S.lanternDrain : S.darkDrain
  return base + (staring ? S.stareDrain : 0)
}
```
`stepWorld` 内（return 之前）:
```ts
  // 安宁值结算与迷失滞回（本切片玩家恒带提灯，黑暗档为完备性保留）
  const inZone = dist(CONFIG.campfire, player.pos) <= CONFIG.light.campfireRadiusM
    || world.posts.some((p) => dist(p, player.pos) <= CONFIG.light.postRadiusM)
  const staring = world.phantom.mode === 'stare'
    && dist(world.phantom.pos, player.pos) <= CONFIG.phantom.stareRange
  const serenity = clamp(world.serenity + serenityRate(inZone, true, staring) * dt, 0, CONFIG.serenity.max)
  let lost = world.lost
  if (!lost && serenity < CONFIG.serenity.lostBelow) { lost = true; events.push({ type: 'lostEnter' }) }
  else if (lost && serenity >= CONFIG.serenity.clearAt) { lost = false; events.push({ type: 'lostExit' }) }
  world = { ...world, serenity, lost }
```

- [ ] **Step 4: 全量测试确认绿**

Run: `npx vitest run && npm run check`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts test/serenity.test.ts
git commit -m "feat(sim): 安宁值分档结算与迷失滞回事件"
```

---

### Task 4: 幻影状态机（TDD）

**Files:**
- Create: `src/sim/phantom.ts`
- Modify: `src/sim/world.ts`（接入，位于 E 处理之后、安宁值之前——本任务时点在采集之后）
- Test: `test/phantom.test.ts`

**Interfaces:**
- Consumes: `nextRand`、`dist/moveToward`、`CONFIG.phantom`、`PhantomState`
- Produces: `stepPhantom(ph: PhantomState, playerPos: Vec2, seed: number, dt: number): { phantom: PhantomState; seed: number; sigh: boolean }`；`stepWorld` 发 `phantomSigh` 事件

- [ ] **Step 1: 写失败测试**

`test/phantom.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { stepPhantom } from '../src/sim/phantom'
import { initialSim } from '../src/sim/types'
import { stepWorld } from '../src/sim/world'
import { dist } from '../src/sim/vec'
import type { IntentInput, PhantomState, Vec2 } from '../src/sim/types'

const DT = 1 / 30
const P = CONFIG.phantom
const I = (): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false })
const ph = (o: Partial<PhantomState> = {}): PhantomState => ({
  pos: { x: 32, y: 32 }, mode: 'wander', modeT: 0, alpha: 1, target: { x: 32, y: 32 }, ...o,
})
const far: Vec2 = { x: 2, y: 2 } // 始终在触发范围外的玩家位

function runPh(p: PhantomState, playerPos: Vec2, seed: number, n: number) {
  let sighs = 0
  for (let i = 0; i < n; i++) {
    const r = stepPhantom(p, playerPos, seed, DT)
    p = r.phantom; seed = r.seed; if (r.sigh) sighs++
  }
  return { p, seed, sighs }
}

describe('幻影状态机', () => {
  it('确定性：同种子轨迹一致', () => {
    const a = runPh(ph(), far, 99, 300)
    const b = runPh(ph(), far, 99, 300)
    expect(a.p.pos).toEqual(b.p.pos)
  })
  it('wander 600 tick 始终在世界界内', () => {
    let p = ph(); let seed = 7
    for (let i = 0; i < 600; i++) {
      const r = stepPhantom(p, far, seed, DT)
      p = r.phantom; seed = r.seed
      expect(p.pos.x).toBeGreaterThanOrEqual(1)
      expect(p.pos.x).toBeLessThanOrEqual(CONFIG.world.width - 1)
      expect(p.pos.y).toBeGreaterThanOrEqual(1)
      expect(p.pos.y).toBeLessThanOrEqual(CONFIG.world.height - 1)
    }
  })
  it('玩家进 8m 转 stare 且停在原地；8–9m 滞回维持；>9m 回 wander', () => {
    let r = stepPhantom(ph(), { x: 32, y: 32 + 7.5 }, 1, DT)
    expect(r.phantom.mode).toBe('stare')
    const posAtStare = r.phantom.pos
    r = stepPhantom(r.phantom, { x: 32, y: 32 + 8.6 }, r.seed, DT) // 8.6 < 9 维持
    expect(r.phantom.mode).toBe('stare')
    expect(r.phantom.pos).toEqual(posAtStare)
    r = stepPhantom(r.phantom, { x: 32, y: 32 + 9.5 }, r.seed, DT)
    expect(r.phantom.mode).toBe('wander')
  })
  it('进 6m 淡出：sigh 恰一次，fadeDur 后 gone，goneDur 后重生 ≥12m 且淡入', () => {
    const near: Vec2 = { x: 32, y: 32 + 5 }
    let r = stepPhantom(ph(), near, 5, DT)
    expect(r.phantom.mode).toBe('fade')
    let sighs = r.sigh ? 1 : 0
    let p = r.phantom; let seed = r.seed
    for (let i = 0; i < Math.ceil((P.fadeDur + P.goneDur) / DT) + 2; i++) {
      const rr = stepPhantom(p, near, seed, DT)
      p = rr.phantom; seed = rr.seed; if (rr.sigh) sighs++
    }
    expect(sighs).toBe(1)
    expect(p.mode).toBe('wander')
    expect(dist(p.pos, near)).toBeGreaterThanOrEqual(P.respawnMinDist)
    expect(p.alpha).toBeLessThan(0.5) // 重生后淡入中
  })
  it('stepWorld 集成：靠近发 phantomSigh 事件', () => {
    const s = initialSim(20, 20.8)
    const nearPh: typeof s = {
      ...s,
      world: { ...s.world, phantom: { ...s.world.phantom, pos: { x: 20, y: 20.8 + 5 }, target: { x: 20, y: 20.8 + 5 } } },
    }
    const r = stepWorld(nearPh, I(), DT)
    expect(r.events.some((e) => e.type === 'phantomSigh')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/phantom.test.ts`
Expected: FAIL — phantom 模块不存在

- [ ] **Step 3: 实现**

`src/sim/phantom.ts`:
```ts
import { CONFIG } from '../config'
import { nextRand } from './rand'
import { dist, moveToward } from './vec'
import type { PhantomState, Vec2 } from './types'

/** 营地环带内取随机路标（环带几何上必在世界界内，见测试） */
function pickWaypoint(seed: number): { target: Vec2; seed: number } {
  const r1 = nextRand(seed)
  const r2 = nextRand(r1.seed)
  const P = CONFIG.phantom
  const ang = r1.value * Math.PI * 2
  const rad = P.ringMin + r2.value * (P.ringMax - P.ringMin)
  return {
    target: { x: CONFIG.campfire.x + Math.cos(ang) * rad, y: CONFIG.campfire.y + Math.sin(ang) * rad },
    seed: r2.seed,
  }
}

/** 重生点：拒绝采样至距玩家 ≥ respawnMinDist；兜底取背离玩家的环带远点 */
function respawn(seed: number, playerPos: Vec2): { pos: Vec2; seed: number } {
  for (let i = 0; i < 16; i++) {
    const w = pickWaypoint(seed)
    seed = w.seed
    if (dist(w.target, playerPos) >= CONFIG.phantom.respawnMinDist) return { pos: w.target, seed }
  }
  const dx = CONFIG.campfire.x - playerPos.x
  const dy = CONFIG.campfire.y - playerPos.y
  const len = Math.hypot(dx, dy) || 1
  const R = CONFIG.phantom.ringMax
  return { pos: { x: CONFIG.campfire.x + (dx / len) * R, y: CONFIG.campfire.y + (dy / len) * R }, seed }
}

export function stepPhantom(
  ph: PhantomState, playerPos: Vec2, seed: number, dt: number,
): { phantom: PhantomState; seed: number; sigh: boolean } {
  const P = CONFIG.phantom
  const d = dist(ph.pos, playerPos)
  let { pos, mode, modeT, alpha, target } = ph
  let sigh = false

  // 距离触发的转移（fade/gone 内不响应）
  if (mode === 'wander' || mode === 'stare') {
    if (d <= P.dissolveRange) { mode = 'fade'; modeT = 0; sigh = true }
    else if (mode === 'wander' && d <= P.stareRange) { mode = 'stare'; modeT = 0 }
    else if (mode === 'stare' && d > P.stareExit) { mode = 'wander'; modeT = 0 }
  }

  switch (mode) {
    case 'wander': {
      if (dist(pos, target) < 0.15) {
        const w = pickWaypoint(seed)
        target = w.target; seed = w.seed
      }
      pos = moveToward(pos, target, P.speed * dt)
      alpha = Math.min(1, alpha + dt / P.fadeInDur)
      modeT += dt
      break
    }
    case 'stare': {
      alpha = Math.min(1, alpha + dt / P.fadeInDur)
      modeT += dt
      break
    }
    case 'fade': {
      modeT += dt
      alpha = Math.max(0, 1 - modeT / P.fadeDur)
      if (modeT >= P.fadeDur) { mode = 'gone'; modeT = 0; alpha = 0 }
      break
    }
    case 'gone': {
      modeT += dt
      if (modeT >= P.goneDur) {
        const r = respawn(seed, playerPos)
        pos = r.pos; seed = r.seed; target = r.pos
        mode = 'wander'; modeT = 0; alpha = 0
      }
      break
    }
  }
  return { phantom: { pos, mode, modeT, alpha, target }, seed, sigh }
}
```

`src/sim/world.ts` 的 `stepWorld` 内，在采集块之后、安宁值块之前插入（import 区补 `stepPhantom`）:
```ts
  // 幻影
  const phr = stepPhantom(world.phantom, player.pos, world.seed, dt)
  world = { ...world, phantom: phr.phantom, seed: phr.seed }
  if (phr.sigh) events.push({ type: 'phantomSigh', pos: phr.phantom.pos })
```

- [ ] **Step 4: 全量测试确认绿**

Run: `npx vitest run && npm run check`
Expected: 全绿（serenity 的 stare 集成测试因幻影自转移仍成立：8m 处 stare + 静止玩家维持）

注意核对：`test/serenity.test.ts` 幻影注视用例的幻影距玩家 5m——**引入 stepPhantom 后 5m < 6m 会触发 fade**。该用例幻影位置需改为 7.5m（`pos/target: { x: 5, y: 12.5 }`），仍在 8m 注视圈内但在 6m 消散圈外。本任务 Step 1 前先改这处再跑失败测试。

- [ ] **Step 5: Commit**

```bash
git add src/sim/phantom.ts src/sim/world.ts test/phantom.test.ts test/serenity.test.ts
git commit -m "feat(sim): 迷途幻影状态机——游荡/注视滞回/消散轻叹/远点重生"
```

---

### Task 5: E 键合成与放置 + 情境提示（TDD）

**Files:**
- Modify: `src/sim/world.ts`, `src/input/keyboard.ts`
- Create: `src/render/hints.ts`
- Test: `test/craft.test.ts`, `test/hints.test.ts`, `test/keyboard.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2/4 的 stepWorld、`clamp`
- Produces:
  - `canCraft(world: WorldState, playerPos: Vec2): boolean`
  - `previewPos(player: PlayerState): Vec2`（放置预览位，边界夹紧）
  - `stepWorld` 处理 `input.craft`（放置优先于合成），发 `crafted/postPlaced`
  - `Keyboard.consumeCraft(): boolean`（KeyE 锁存，blur 清除）
  - `deriveHint(s: SimState): string | null`

- [ ] **Step 1: 写失败测试**

`test/craft.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'
import { canCraft, previewPos, stepWorld } from '../src/sim/world'
import type { IntentInput, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput => ({ moveX: 0, moveY: 0, interact: false, craft: false, ...o })
const rich = (s: SimState): SimState => ({
  ...s, world: { ...s.world, inventory: { wood: 10, fluorite: 5 } },
})

describe('canCraft', () => {
  it('资源足且近篝火为真；缺任一为假', () => {
    const atFire = rich(initialSim(20, 20.8)) // 距篝火 1.8m < 2.5m
    expect(canCraft(atFire.world, atFire.player.pos)).toBe(true)
    const farAway = rich(initialSim(5, 5))
    expect(canCraft(farAway.world, farAway.player.pos)).toBe(false)
    const poor = initialSim(20, 20.8)
    expect(canCraft(poor.world, poor.player.pos)).toBe(false)
  })
})

describe('合成与放置', () => {
  it('E 近火足够：扣资源、进放置、crafted 事件', () => {
    const r = stepWorld(rich(initialSim(20, 20.8)), I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(true)
    expect(r.state.world.inventory).toEqual({ wood: 0, fluorite: 0 })
    expect(r.events.some((e) => e.type === 'crafted')).toBe(true)
  })
  it('放置模式再按 E：柱落在前方 1.5m，退出放置，postPlaced 事件', () => {
    let r = stepWorld(rich(initialSim(20, 20.8)), I({ craft: true }), DT)
    r = stepWorld(r.state, I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(false)
    expect(r.state.world.posts).toHaveLength(1)
    const post = r.state.world.posts[0]!
    expect(post.x).toBeCloseTo(20 + CONFIG.craft.placeAheadM, 3) // facing=1
    expect(r.events.some((e) => e.type === 'postPlaced' && e.index === 0)).toBe(true)
  })
  it('previewPos 贴边夹紧', () => {
    const s = initialSim(CONFIG.world.width - 1.2, 20.8)
    expect(previewPos(s.player).x).toBe(CONFIG.world.width - CONFIG.craft.edgeMarginM)
  })
  it('资源不足 E 无效果', () => {
    const r = stepWorld(initialSim(20, 20.8), I({ craft: true }), DT)
    expect(r.state.world.placing).toBe(false)
    expect(r.events).toHaveLength(0)
  })
})
```

`test/hints.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { deriveHint } from '../src/render/hints'
import { initialSim } from '../src/sim/types'
import type { SimState } from '../src/sim/types'

const withWorld = (s: SimState, w: Partial<SimState['world']>): SimState => ({ ...s, world: { ...s.world, ...w } })

describe('deriveHint 优先级', () => {
  it('放置 > 可合成 > 篝火进度 > 采集 > 无', () => {
    const atFire = initialSim(20, 20.8)
    expect(deriveHint(withWorld(atFire, { placing: true }))).toBe('E 放置提灯柱')
    expect(deriveHint(withWorld(atFire, { inventory: { wood: 10, fluorite: 5 } })))
      .toBe('E 合成 提灯柱（木10 萤5）')
    expect(deriveHint(atFire)).toBe('篝火 · 提灯柱需要 木0/10 萤0/5')
    expect(deriveHint(initialSim(12.5, 14.1))).toBe('左键 采集低语木')
    expect(deriveHint(initialSim(7.5, 17.6))).toBe('左键 采集萤石')
    expect(deriveHint(initialSim(5, 5))).toBeNull()
  })
})
```

`test/keyboard.test.ts` 的 `Keyboard 交互锁存` describe 内追加:
```ts
  it('KeyE 锁存 craft 边沿，blur 清除', () => {
    const target = new EventTarget()
    const kb = new Keyboard()
    kb.attach(target as unknown as Window)
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE', repeat: false }))
    expect(kb.consumeCraft()).toBe(true)
    expect(kb.consumeCraft()).toBe(false)
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE', repeat: false }))
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumeCraft()).toBe(false)
  })
```
（该 describe 现有测试如何构造合成 keydown 事件，沿用其既有写法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/craft.test.ts test/hints.test.ts test/keyboard.test.ts`
Expected: FAIL — canCraft/deriveHint/consumeCraft 不存在

- [ ] **Step 3: 实现**

`src/sim/world.ts` 追加导出（import 区补 `clamp`、类型补 `PlayerState/WorldState`）:
```ts
/** 合成条件：非放置中、资源足、距篝火 craftRange 内 */
export function canCraft(world: WorldState, playerPos: Vec2): boolean {
  const C = CONFIG.craft
  return !world.placing
    && world.inventory.wood >= C.wood
    && world.inventory.fluorite >= C.fluorite
    && dist(CONFIG.campfire, playerPos) <= C.rangeM
}

/** 放置预览位：玩家朝向前方 placeAheadM，世界边界内 edgeMarginM 夹紧 */
export function previewPos(player: PlayerState): Vec2 {
  const C = CONFIG.craft
  return {
    x: clamp(player.pos.x + player.facing * C.placeAheadM, C.edgeMarginM, CONFIG.world.width - C.edgeMarginM),
    y: clamp(player.pos.y, C.edgeMarginM, CONFIG.world.height - C.edgeMarginM),
  }
}
```
`stepWorld` 内，采集块之后、幻影块之前插入:
```ts
  // E：放置优先于合成
  if (input.craft) {
    if (world.placing) {
      const pos = previewPos(player)
      const posts = [...world.posts, pos]
      world = { ...world, posts, placing: false }
      events.push({ type: 'postPlaced', pos, index: posts.length - 1 })
    } else if (canCraft(world, player.pos)) {
      world = {
        ...world,
        placing: true,
        inventory: {
          wood: world.inventory.wood - CONFIG.craft.wood,
          fluorite: world.inventory.fluorite - CONFIG.craft.fluorite,
        },
      }
      events.push({ type: 'crafted' })
    }
  }
```

`src/input/keyboard.ts`：类内加 `private craftPressed = false`；keydown 监听 repeat 早退之后加:
```ts
      if (e.code === 'KeyE') this.craftPressed = true
```
blur 监听改为:
```ts
    target.addEventListener('blur', () => { this.keys.clear(); this.interactPressed = false; this.craftPressed = false })
```
类尾加:
```ts
  consumeCraft(): boolean {
    const v = this.craftPressed
    this.craftPressed = false
    return v
  }
```

`src/render/hints.ts`:
```ts
import { CONFIG } from '../config'
import { canCraft, nearestNodeIdx } from '../sim/world'
import { dist } from '../sim/vec'
import type { SimState } from '../sim/types'

/** 情境提示文案；优先级：放置 > 可合成 > 篝火进度 > 采集 > 无 */
export function deriveHint(s: SimState): string | null {
  const w = s.world
  const C = CONFIG.craft
  if (w.placing) return 'E 放置提灯柱'
  if (canCraft(w, s.player.pos)) return `E 合成 提灯柱（木${C.wood} 萤${C.fluorite}）`
  if (dist(CONFIG.campfire, s.player.pos) <= C.rangeM)
    return `篝火 · 提灯柱需要 木${w.inventory.wood}/${C.wood} 萤${w.inventory.fluorite}/${C.fluorite}`
  const idx = nearestNodeIdx(w.nodes, s.player.pos, CONFIG.gather.rangeM)
  if (idx >= 0) return w.nodes[idx]!.kind === 'tree' ? '左键 采集低语木' : '左键 采集萤石'
  return null
}
```

- [ ] **Step 4: 全量测试确认绿**

Run: `npx vitest run && npm run check`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts src/input/keyboard.ts src/render/hints.ts test/craft.test.ts test/hints.test.ts test/keyboard.test.ts
git commit -m "feat(sim,input): E 键合成/放置状态机与情境提示纯函数"
```

---

### Task 6: 渲染——六图纹理、灯光世界坐标化、世界实体视图、主循环装配

**Files:**
- Modify: `src/render/textures.ts`（全量替换）, `src/render/lightLayer.ts`, `src/main.ts`（全量替换）
- Create: `src/render/worldView.ts`

**Interfaces:**
- Consumes: sim 全量状态、`previewPos`
- Produces:
  - `GameTextures { seeker, tree, ore, campfire, post, phantom }`
  - `LightSpec { xM, yM, radiusM, alpha?, flicker? }`；`LightLayer.update(lights, originPx: {x,y}, timeS)`
  - `makeRadialTexture(): Texture`（lightLayer 导出，柔边白色径向渐变，worldView 火焰/光晕复用）
  - `class WorldView { constructor(world: Container, overlay: Container, tex: GameTextures, initial: SimState); update(prev, cur, alphaV, timeS, realDt): void; shake(nodeId: number): void }`

- [ ] **Step 1: textures 全量替换**

`src/render/textures.ts`:
```ts
import { Assets, Container, Graphics, Texture, type Renderer } from 'pixi.js'

export interface GameTextures {
  seeker: Texture; tree: Texture; ore: Texture; campfire: Texture; post: Texture; phantom: Texture
}

const FILES: Record<keyof GameTextures, string> = {
  seeker: 'seeker.png', tree: 'whisper-tree.png', ore: 'lumina-ore.png',
  campfire: 'campfire.png', post: 'lantern-post.png', phantom: 'phantom.png',
}

/** 素材缺失时的程序占位（形状 y 以脚底为 0 向上为负） */
const builders: Record<keyof GameTextures, (g: Graphics) => void> = {
  seeker(g) {
    g.roundRect(-20, -78, 40, 78, 12).fill(0x8a8f7a)
    g.circle(0, -64, 15).fill(0x6f7462)
    g.circle(-5, -64, 3).fill(0xffdf8a)
    g.circle(5, -64, 3).fill(0xffdf8a)
    g.circle(-16, -34, 6).fill(0xffc862)
  },
  tree(g) {
    g.rect(-7, -62, 14, 62).fill(0x2e4038)
    g.circle(0, -84, 34).fill(0x2f5a4c)
    g.circle(-22, -66, 22).fill(0x2a5044)
    g.circle(22, -66, 22).fill(0x2a5044)
    g.circle(-8, -90, 3).fill(0x9fe8c8)
    g.circle(14, -72, 3).fill(0x9fe8c8)
  },
  ore(g) {
    g.poly([-26, 0, -12, -32, 2, -6]).fill(0x3b6ea8)
    g.poly([-6, 0, 8, -42, 22, 0]).fill(0x5b9ad0)
    g.poly([12, -2, 26, -22, 30, 0]).fill(0x4a80b8)
  },
  campfire(g) {
    g.ellipse(0, -3, 30, 9).fill(0x2c2a24)
    g.circle(-30, -4, 6).fill(0x4a4a48)
    g.circle(30, -4, 6).fill(0x4a4a48)
    g.roundRect(-26, -16, 52, 10, 4).fill(0x5a4630)
    g.roundRect(-9, -30, 18, 24, 6).fill(0x6b563a)
  },
  post(g) {
    g.rect(-4, -88, 8, 88).fill(0x4c3f2e)
    g.roundRect(-14, -108, 28, 26, 6).fill(0x6b5638)
    g.circle(0, -95, 8).fill(0xffd98a)
  },
  phantom(g) {
    g.ellipse(0, -30, 20, 30).fill(0x9aa4a8)
    g.ellipse(0, -58, 12, 14).fill(0xaab4b8)
    g.circle(-4, -60, 2).fill(0xdce8ee)
    g.circle(4, -60, 2).fill(0xdce8ee)
  },
}

async function loadOne(renderer: Renderer, name: keyof GameTextures): Promise<Texture> {
  let tex: Texture
  try {
    tex = await Assets.load<Texture>(`./assets/${FILES[name]}`)
  } catch {
    console.warn(`${FILES[name]} 缺失，使用程序占位`)
    const c = new Container()
    const g = new Graphics()
    builders[name](g)
    c.addChild(g)
    tex = renderer.generateTexture(c)
  }
  // 立绘原图按 ~10:1 缩小显示，无 mipmap 会持续采样抖动
  tex.source.autoGenerateMipmaps = true
  return tex
}

export async function loadTextures(renderer: Renderer): Promise<GameTextures> {
  const [seeker, tree, ore, campfire, post, phantom] = await Promise.all([
    loadOne(renderer, 'seeker'), loadOne(renderer, 'tree'), loadOne(renderer, 'ore'),
    loadOne(renderer, 'campfire'), loadOne(renderer, 'post'), loadOne(renderer, 'phantom'),
  ])
  return { seeker, tree, ore, campfire, post, phantom }
}
```

- [ ] **Step 2: lightLayer 世界坐标化**

`src/render/lightLayer.ts` 修改:
- `LightSpec` 改为 `{ xM: number; yM: number; radiusM: number; alpha?: number; flicker?: number }`
- `makeHoleTexture` 更名 `makeRadialTexture` 并 `export`
- `update(lights: LightSpec[], originPx: { x: number; y: number }, timeS: number)`，孔洞循环体:
```ts
    const px = CONFIG.pxPerMeter
    this.holes.forEach((s, i) => {
      const l = lights[i]
      s.visible = !!l
      if (!l) return
      s.position.set(originPx.x + l.xM * px, originPx.y + l.yM * px)
      s.alpha = l.alpha ?? 1
      // 火光呼吸：双正弦伪噪声，各灯相位随索引错开；flicker 缩放幅度
      const amp = CONFIG.light.flickerAmp * (l.flicker ?? 1)
      const f = 1 + amp * 0.5 * (Math.sin(timeS * 7.3 + i * 1.7) + Math.sin(timeS * 12.1 + i * 4.1))
      s.scale.set((l.radiusM * px * 2 * f) / 512)
    })
```
（原 `flicker` 闭包删除，其余结构不动。）

- [ ] **Step 3: worldView**

`src/render/worldView.ts`:
```ts
import { Container, Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import { previewPos } from '../sim/world'
import { makeRadialTexture } from './lightLayer'
import type { SimState } from '../sim/types'
import type { GameTextures } from './textures'

const px = CONFIG.pxPerMeter
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const SHAKE_DUR = 0.3

function footSprite(tex: Texture, heightM: number): Sprite {
  const s = new Sprite(tex)
  s.anchor.set(0.5, 1)
  s.scale.set((heightM * px) / tex.height)
  return s
}

/** 树/矿/篝火/提灯柱/幻影/放置预览的精灵同步（每帧由状态驱动，幂等） */
export class WorldView {
  private nodeSprites = new Map<number, Sprite>()
  private baseScaleY = new Map<number, number>()
  private postSprites: Sprite[] = []
  private campfire: Sprite
  private flame: Sprite
  private phantom: Sprite
  private preview: Sprite
  private shakes = new Map<number, number>()
  private glowTex = makeRadialTexture()

  constructor(private world: Container, private overlay: Container, private tex: GameTextures, initial: SimState) {
    for (const n of initial.world.nodes) {
      const s = footSprite(n.kind === 'tree' ? tex.tree : tex.ore, n.kind === 'tree' ? CONFIG.sizes.treeH : CONFIG.sizes.oreH)
      s.position.set(n.pos.x * px, n.pos.y * px)
      s.zIndex = n.pos.y * px
      this.nodeSprites.set(n.id, s)
      this.baseScaleY.set(n.id, s.scale.y)
      world.addChild(s)
    }
    this.campfire = footSprite(tex.campfire, CONFIG.sizes.campfireH)
    this.campfire.position.set(CONFIG.campfire.x * px, CONFIG.campfire.y * px)
    this.campfire.zIndex = CONFIG.campfire.y * px
    world.addChild(this.campfire)

    this.flame = new Sprite(this.glowTex)
    this.flame.anchor.set(0.5)
    this.flame.blendMode = 'add'
    this.flame.tint = 0xff9a40
    this.flame.position.set(CONFIG.campfire.x * px, (CONFIG.campfire.y - 0.55) * px)
    this.flame.zIndex = CONFIG.campfire.y * px + 1
    world.addChild(this.flame)

    this.preview = footSprite(tex.post, CONFIG.sizes.postH)
    this.preview.alpha = 0.45
    this.preview.visible = false
    world.addChild(this.preview)

    this.phantom = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantom.blendMode = 'add' // 黑底发光素材
    overlay.addChild(this.phantom)
  }

  /** harvest 事件触发的受击摇晃 */
  shake(nodeId: number): void { this.shakes.set(nodeId, 0) }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, realDt: number): void {
    // 节点：耗尽降级 + 摇晃
    for (const n of cur.world.nodes) {
      const s = this.nodeSprites.get(n.id)
      if (!s) continue
      const base = this.baseScaleY.get(n.id)!
      const depleted = n.charges <= 0
      if (n.kind === 'tree') {
        s.scale.y = depleted ? base * 0.35 : base // 残桩剪影
        s.tint = depleted ? 0x4a4f42 : 0xffffff
      } else {
        s.tint = depleted ? 0x5a6672 : 0xffffff
      }
      let t = this.shakes.get(n.id)
      if (t !== undefined) {
        t += realDt
        if (t >= SHAKE_DUR) { this.shakes.delete(n.id); s.rotation = 0 }
        else { this.shakes.set(n.id, t); s.rotation = Math.sin(t * 40) * 0.07 * (1 - t / SHAKE_DUR) }
      }
    }
    // 提灯柱：按状态增量建精灵
    while (this.postSprites.length < cur.world.posts.length) {
      const p = cur.world.posts[this.postSprites.length]!
      const s = footSprite(this.tex.post, CONFIG.sizes.postH)
      s.position.set(p.x * px, p.y * px)
      s.zIndex = p.y * px
      const halo = new Sprite(this.glowTex)
      halo.anchor.set(0.5)
      halo.blendMode = 'add'
      halo.tint = 0xffd98a
      halo.alpha = 0.5
      halo.scale.set((1.2 * px * 2) / 512)
      halo.position.set(p.x * px, (p.y - CONFIG.sizes.postH * 0.82) * px)
      halo.zIndex = p.y * px + 1
      this.world.addChild(s, halo)
      this.postSprites.push(s)
    }
    // 篝火火焰呼吸
    const f = 1 + 0.18 * 0.5 * (Math.sin(timeS * 7.3) + Math.sin(timeS * 12.1))
    this.flame.scale.set((1.1 * px * 2 * f) / 512)
    this.flame.alpha = 0.6 + 0.1 * Math.sin(timeS * 9.1)
    // 放置预览
    this.preview.visible = cur.world.placing
    if (cur.world.placing) {
      const p = previewPos(cur.player)
      this.preview.position.set(p.x * px, p.y * px)
      this.preview.zIndex = p.y * px
      this.preview.alpha = 0.35 + 0.12 * Math.sin(timeS * 5)
    }
    // 幻影：屏幕层（暗幕之上，自发光不受暗幕遮蔽），世界坐标经 world 容器原点换算
    const pp = prev.world.phantom
    const cp = cur.world.phantom
    const sameLife = pp.mode !== 'gone' && cp.mode !== 'gone' // 跨重生不插值（瞬移）
    const xM = sameLife ? lerp(pp.pos.x, cp.pos.x, alphaV) : cp.pos.x
    const yM = sameLife ? lerp(pp.pos.y, cp.pos.y, alphaV) : cp.pos.y
    const a = sameLife ? lerp(pp.alpha, cp.alpha, alphaV) : cp.alpha
    this.phantom.position.set(this.world.position.x + xM * px, this.world.position.y + yM * px)
    this.phantom.alpha = a * 0.85
    this.phantom.visible = a > 0.01
  }
}
```

- [ ] **Step 4: main 全量替换**

`src/main.ts`:
```ts
import { Application, Container } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { LightLayer, type LightSpec } from './render/lightLayer'
import { Particles } from './render/particles'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { WorldView } from './render/worldView'
import { Sfx } from './audio/sfx'
import { Sim } from './sim/sim'
import { initialSim } from './sim/types'

// 不用顶层 await：打包后 pixi 核心并入本入口 chunk，app.init() 动态
// import 的渲染器 chunk 又静态依赖入口——入口若停在顶层 await 上，
// 双方互等造成无异常的永久黑屏死锁（dev 不打包无此问题）。
async function main(): Promise<void> {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: CONFIG.colors.night,
    antialias: true,
    // HiDPI 屏按物理像素渲染（上限 2 防 3x 屏过载），否则 1x 拉伸满屏锯齿
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  document.body.appendChild(app.canvas)

  const textures = await loadTextures(app.renderer)
  const sfx = new Sfx()
  const scene = new Scene(app)
  const particles = new Particles(scene.world)
  const sim = new Sim(initialSim(CONFIG.player.spawn.x, CONFIG.player.spawn.y))
  const kb = new Keyboard()
  kb.attach(window)
  kb.onFirstInput = () => sfx.unlock()
  const player = new PlayerView(textures.seeker)
  scene.world.addChild(player.sprite)

  const light = new LightLayer(app)
  app.stage.addChild(light.container)
  const overlay = new Container() // 暗幕之上：幻影等自发光体
  app.stage.addChild(overlay)
  const worldView = new WorldView(scene.world, overlay, textures, sim.state)

  const sinks = {
    footstep(xM: number, yM: number) { particles.dust(xM, yM); sfx.footstep() },
    gatherHit(xM: number, yM: number) { particles.spark(xM, yM); sfx.knock() },
  }
  let elapsed = 0

  app.ticker.add((ticker) => {
    const realDt = Math.min(0.1, ticker.deltaMS / 1000)
    elapsed += realDt
    sim.advance(realDt, { ...kb.intent(), interact: kb.consumeInteract(), craft: kb.consumeCraft() })
    const alphaV = sim.alpha()
    const st = sim.state

    for (const e of sim.drainEvents()) {
      if (e.type === 'harvest') worldView.shake(e.nodeId)
    }

    player.update(sim.prev, st, alphaV, elapsed, sinks)
    particles.update(realDt)
    // 相机与精灵使用同一插值位置，否则每个 sim tick 相机产生锯齿抖动
    const pp = sim.prev.player.pos
    const cp = st.player.pos
    const ipx = pp.x + (cp.x - pp.x) * alphaV
    const ipy = pp.y + (cp.y - pp.y) * alphaV
    scene.follow(ipx, ipy)
    worldView.update(sim.prev, st, alphaV, elapsed, realDt)

    const lights: LightSpec[] = [
      { xM: ipx, yM: ipy - CONFIG.player.heightM * 0.45, radiusM: CONFIG.light.lanternRadiusM },
      { xM: CONFIG.campfire.x, yM: CONFIG.campfire.y - 0.5, radiusM: CONFIG.light.campfireRadiusM, flicker: 1.8 },
      ...st.world.posts.map((p) => ({ xM: p.x, yM: p.y - 1.8, radiusM: CONFIG.light.postRadiusM })),
      ...st.world.nodes.filter((n) => n.charges > 0).map((n) => n.kind === 'ore'
        ? { xM: n.pos.x, yM: n.pos.y - 0.5, radiusM: CONFIG.light.oreGlow.radiusM, alpha: CONFIG.light.oreGlow.alpha, flicker: 0.5 }
        : { xM: n.pos.x, yM: n.pos.y - 1.6, radiusM: CONFIG.light.treeGlow.radiusM, alpha: CONFIG.light.treeGlow.alpha, flicker: 0.5 }),
    ]
    light.update(lights, scene.world.position, elapsed)
  })
}

main().catch((err) => {
  console.error('启动失败:', err)
})
```

- [ ] **Step 5: 全量验证 + 冒烟截图**

Run: `npm run check && npm run test && npm run build`
Expected: 全部通过

Run:
```bash
npx vite preview --host 0.0.0.0 --port 4179 &
sleep 2
node tools/smoke_probe.mjs http://127.0.0.1:4179/ /tmp/claude-0/-workspace-senzhidiyu/dd50fd48-228e-4736-928f-d94131502f7f/scratchpad/task6-smoke.png
kill %1
```
Expected: 无 `[pageerror]`；截图可见：营地篝火+火光、周围黑暗中树/矿微光点、幻影不可见（远处）或微光、玩家光圈

- [ ] **Step 6: Commit**

```bash
git add src/render/textures.ts src/render/lightLayer.ts src/render/worldView.ts src/main.ts
git commit -m "feat(render): 世界实体渲染与灯光世界坐标化——树/矿/篝火/幻影/放置预览"
```

---

### Task 7: 粒子扩展与环境音（事件接线）

**Files:**
- Modify: `src/render/particles.ts`（全量替换）, `src/audio/sfx.ts`（全量替换）, `src/main.ts`（事件接线）

**Interfaces:**
- Consumes: `SimEvent`、Task 6 的 main 结构
- Produces:
  - `Particles.firefly/glint/ember(xM, yM)`（原 dust/spark 不变）
  - `Sfx`: `unlock/rearm/setMuffled(on)/humLevel(v)/sigh/pickupWood/pickupOre/chime/placeThump`（原 footstep/knock 保留、全部过主低通）

- [ ] **Step 1: particles 全量替换**

`src/render/particles.ts`:
```ts
import { Container, Graphics } from 'pixi.js'
import { CONFIG } from '../config'

interface SpawnOpts {
  color: number; count: number; speed: number; life: number
  grav?: number    // px/s²，负值上浮
  sizePx?: number
  swayPx?: number  // 横向摆动速度幅度 px/s
}
interface P {
  g: Graphics; life: number; max: number
  vx: number; vy: number; grav: number; sway: number; swayAmp: number
}

export class Particles {
  private pool: P[] = []

  constructor(private world: Container) {}

  private spawn(xM: number, yM: number, o: SpawnOpts): void {
    const px = CONFIG.pxPerMeter
    for (let i = 0; i < o.count; i++) {
      let p = this.pool.find((q) => q.life <= 0)
      if (!p) {
        p = { g: new Graphics(), life: 0, max: 1, vx: 0, vy: 0, grav: 0, sway: 0, swayAmp: 0 }
        this.pool.push(p)
        this.world.addChild(p.g)
      }
      const a = Math.random() * Math.PI * 2
      p.vx = Math.cos(a) * o.speed * (0.4 + Math.random() * 0.6)
      p.vy = -Math.abs(Math.sin(a)) * o.speed * 0.7
      p.grav = o.grav ?? 40
      p.sway = Math.random() * Math.PI * 2
      p.swayAmp = o.swayPx ?? 0
      p.life = p.max = o.life * (0.7 + Math.random() * 0.6)
      const r = o.sizePx ?? 1.6
      p.g.clear().circle(0, 0, r + Math.random() * r).fill(o.color)
      p.g.position.set(xM * px, yM * px)
      p.g.zIndex = yM * px + 1
    }
  }

  dust(xM: number, yM: number): void { this.spawn(xM, yM, { color: 0x4a4438, count: 2, speed: 14, life: 0.45 }) }
  spark(xM: number, yM: number): void { this.spawn(xM, yM, { color: 0xffd97a, count: 5, speed: 30, life: 0.5 }) }
  /** 低语木收益：金色萤火虫上飘 */
  firefly(xM: number, yM: number): void {
    this.spawn(xM, yM, { color: 0xffe08a, count: 3, speed: 8, life: 1.6, grav: -6, swayPx: 14, sizePx: 1.4 })
  }
  /** 萤石收益：蓝白晶屑 */
  glint(xM: number, yM: number): void {
    this.spawn(xM, yM, { color: 0xbfe8ff, count: 4, speed: 36, life: 0.4, grav: 60, sizePx: 1.2 })
  }
  /** 篝火火星 */
  ember(xM: number, yM: number): void {
    this.spawn(xM, yM, { color: 0xffb066, count: 1, speed: 6, life: 1.3, grav: -14, swayPx: 8, sizePx: 1.2 })
  }

  update(realDt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) { p.g.visible = false; continue }
      p.life -= realDt
      p.g.visible = p.life > 0
      p.g.position.x += p.vx * realDt + (p.swayAmp ? Math.sin((p.max - p.life) * 3.2 + p.sway) * p.swayAmp * realDt : 0)
      p.g.position.y += p.vy * realDt
      p.vy += p.grav * realDt
      p.g.alpha = Math.max(0, p.life / p.max)
    }
  }
}
```

- [ ] **Step 2: sfx 全量替换**

`src/audio/sfx.ts`:
```ts
import { CONFIG } from '../config'

/** 全程序合成音。所有节点过主低通（迷失=闷化）；风与低鸣为常驻层。 */
export class Sfx {
  private ctx?: AudioContext
  private out?: GainNode
  private lp?: BiquadFilterNode
  private humGain?: GainNode

  unlock(): void {
    if (this.ctx) { this.rearm(); return }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = 18000
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(this.lp).connect(ctx.destination)
    this.out = master
    this.startWind(ctx, master)
    this.startHum(ctx, master)
  }

  /** 标签页隐藏/系统打断后被挂起的 context 重新拉起 */
  rearm(): void { if (this.ctx?.state === 'suspended') void this.ctx.resume() }

  /** 迷失=true 时全局闷化 */
  setMuffled(on: boolean): void {
    if (!this.ctx || !this.lp) return
    this.lp.frequency.setTargetAtTime(on ? CONFIG.lost.lowpassHz : 18000, this.ctx.currentTime, 0.25)
  }

  /** 幻影注视强度 0..1 → 低鸣音量 */
  humLevel(v: number): void {
    if (!this.ctx || !this.humGain) return
    this.humGain.gain.setTargetAtTime(v * 0.1, this.ctx.currentTime, 0.25)
  }

  private startWind(ctx: AudioContext, out: AudioNode): void {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) { // 一阶低通白噪声近似粉噪风声
      last += 0.02 * ((Math.random() * 2 - 1) - last)
      d[i] = last * 3
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const g = ctx.createGain()
    g.gain.value = 0.05
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.025
    lfo.connect(lfoG).connect(g.gain)
    src.connect(lp).connect(g).connect(out)
    src.start()
    lfo.start()
  }

  private startHum(ctx: AudioContext, out: AudioNode): void {
    const g = ctx.createGain()
    g.gain.value = 0
    this.humGain = g
    for (const f of [52, 53.7]) { // 轻微失谐制造拍频压迫感
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.connect(g)
      o.start()
    }
    g.connect(out)
  }

  private noiseBurst(freq: number, dur: number, gainV: number): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gainV, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp).connect(g).connect(this.out)
    src.start()
  }

  private ping(freq: number, dur: number, gainV: number, delay = 0): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  footstep(): void { this.noiseBurst(300 + Math.random() * 120, 0.09, 0.12) }

  knock(): void {
    this.noiseBurst(1800, 0.05, 0.1)
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(180, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
    osc.connect(g).connect(this.out)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  }

  /** 幻影消散的轻叹：带通噪声中心频率下滑 */
  sigh(): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const dur = 0.8
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 4
    bp.frequency.setValueAtTime(520, ctx.currentTime)
    bp.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.15)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp).connect(g).connect(this.out)
    src.start()
  }

  pickupWood(): void { this.noiseBurst(260, 0.07, 0.1); this.ping(1320, 0.18, 0.045, 0.02) }
  pickupOre(): void { this.ping(1180, 0.22, 0.06); this.ping(1770, 0.26, 0.045, 0.05) }
  /** 合成成功：风铃琶音 */
  chime(): void { [880, 1174.7, 1318.5, 1760].forEach((f, i) => this.ping(f, 0.5, 0.055, i * 0.09)) }
  placeThump(): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(130, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.2, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    o.connect(g).connect(this.out)
    o.start()
    o.stop(ctx.currentTime + 0.3)
    this.ping(1568, 0.4, 0.05, 0.08)
  }
}
```

- [ ] **Step 3: main 事件接线**

`src/main.ts` 修改：
- `worldView` 创建后加常驻监听:
```ts
  document.addEventListener('visibilitychange', () => sfx.rearm())
  window.addEventListener('pointerdown', () => sfx.rearm())
```
- ticker 内事件循环替换为:
```ts
    for (const e of sim.drainEvents()) {
      switch (e.type) {
        case 'harvest':
          worldView.shake(e.nodeId)
          if (e.kind === 'tree') { particles.firefly(e.pos.x, e.pos.y - 1.2); sfx.pickupWood() }
          else { particles.glint(e.pos.x, e.pos.y - 0.5); sfx.pickupOre() }
          break
        case 'phantomSigh': sfx.sigh(); break
        case 'crafted': sfx.chime(); break
        case 'postPlaced': sfx.placeThump(); break
        case 'lostEnter': sfx.setMuffled(true); break
        case 'lostExit': sfx.setMuffled(false); break
      }
    }
```
- ticker 内 `light.update(...)` 之后追加篝火火星与低鸣强度:
```ts
    emberT -= realDt
    if (emberT <= 0) {
      emberT = 0.4 + Math.random() * 0.8
      particles.ember(CONFIG.campfire.x + (Math.random() - 0.5) * 0.6, CONFIG.campfire.y - 0.6)
    }
    const ph = st.world.phantom
    const dPh = Math.hypot(ph.pos.x - ipx, ph.pos.y - ipy)
    const P = CONFIG.phantom
    sfx.humLevel(ph.mode === 'stare'
      ? 1 - Math.min(1, Math.max(0, (dPh - P.dissolveRange) / (P.stareRange - P.dissolveRange)))
      : 0)
```
- `let elapsed = 0` 旁加 `let emberT = 0`

- [ ] **Step 4: 全量验证**

Run: `npm run check && npm run test && npm run build`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/render/particles.ts src/audio/sfx.ts src/main.ts
git commit -m "feat(audio,render): 环境音层（风/低鸣/轻叹/收益音/迷失闷化）与萤火虫/晶屑/火星粒子"
```

---

### Task 8: UI 层与迷失表现

**Files:**
- Create: `src/render/ui.ts`, `src/render/lostFx.ts`
- Modify: `src/main.ts`（装配 UI 与迷失表现、开场 toast）

**Interfaces:**
- Consumes: `deriveHint`、sim 状态与事件
- Produces:
  - `class UI { container; setCounts(wood, fluorite); setSerenity(v); setHint(t: string | null); toast(t: string); update(realDt, timeS) }`
  - `class LostFx { container; update(lost: boolean, realDt): void }`（构造时接管 world 容器滤镜）

- [ ] **Step 1: lostFx**

`src/render/lostFx.ts`:
```ts
import { Application, ColorMatrixFilter, Container, Sprite, Texture } from 'pixi.js'
import { CONFIG } from '../config'

/** 屏幕边缘雾圈纹理：中心透明、边缘烟黑 */
function makeVignette(): Texture {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const grad = ctx.createRadialGradient(256, 256, 120, 256, 256, 256)
  grad.addColorStop(0, 'rgba(6,8,6,0)')
  grad.addColorStop(0.62, 'rgba(6,8,6,0.12)')
  grad.addColorStop(1, 'rgba(6,8,6,0.92)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return Texture.from(cv)
}

/** 迷失状态表现：边缘起雾 + 世界降饱和，强度平滑渐变 */
export class LostFx {
  readonly container = new Container()
  private vignette = new Sprite(makeVignette())
  private desat = new ColorMatrixFilter()
  private k = 0

  constructor(private app: Application, private worldC: Container) {
    this.vignette.alpha = 0
    this.container.addChild(this.vignette)
  }

  update(lost: boolean, realDt: number): void {
    const target = lost ? 1 : 0
    const step = CONFIG.lost.rampRate * realDt
    this.k = this.k + Math.max(-step, Math.min(step, target - this.k))
    this.vignette.width = this.app.screen.width
    this.vignette.height = this.app.screen.height
    this.vignette.alpha = this.k * CONFIG.lost.vignetteMax
    if (this.k > 0.005) {
      this.desat.reset()
      this.desat.saturate(-CONFIG.lost.desatMax * this.k, false)
      if (!this.worldC.filters) this.worldC.filters = [this.desat]
    } else if (this.worldC.filters) {
      this.worldC.filters = null
    }
  }
}
```

- [ ] **Step 2: ui**

`src/render/ui.ts`:
```ts
import { Application, Container, Graphics, Text } from 'pixi.js'
import { CONFIG } from '../config'

const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
const style = (size: number, fill: number) => ({ fontFamily: FONT, fontSize: size, fill })
const PETALS = 12

interface Toast { text: string; t: number }
const TOAST_IN = 0.4
const TOAST_HOLD = 2.6
const TOAST_OUT = 0.6

/** 屏幕层 HUD：背包计数、安宁值蒲公英、情境提示、toast 队列 */
export class UI {
  readonly container = new Container()
  private woodText = new Text({ text: '0', style: style(15, 0xd8d2c0) })
  private fluoText = new Text({ text: '0', style: style(15, 0xd8d2c0) })
  private counters = new Container()
  private bumpT = 1
  private flower = new Graphics()
  private lastPetals = -1
  private serenity = CONFIG.serenity.initial
  private hintText = new Text({ text: '', style: style(15, 0xe8e2d0) })
  private hintBg = new Graphics()
  private hint = new Container()
  private toastText = new Text({ text: '', style: style(17, 0xf0ead8) })
  private toastBg = new Graphics()
  private toastC = new Container()
  private toasts: Toast[] = []

  constructor(private app: Application) {
    // 背包（右下）
    const woodIcon = new Graphics().roundRect(0, 4, 18, 8, 3).fill(0xc8a06a)
    const fluoIcon = new Graphics().poly([0, 14, 6, 0, 12, 14]).fill(0x8ac0e8)
    const woodRow = new Container()
    woodRow.addChild(woodIcon, this.woodText)
    this.woodText.position.set(24, 0)
    const fluoRow = new Container()
    fluoRow.addChild(fluoIcon, this.fluoText)
    this.fluoText.position.set(24, 0)
    fluoRow.y = 24
    this.counters.addChild(woodRow, fluoRow)
    // 提示条（下中）与 toast（上中）
    this.hint.addChild(this.hintBg, this.hintText)
    this.hint.visible = false
    this.toastC.addChild(this.toastBg, this.toastText)
    this.toastC.visible = false
    this.container.addChild(this.counters, this.flower, this.hint, this.toastC)
  }

  setCounts(wood: number, fluorite: number): void {
    if (this.woodText.text !== String(wood) || this.fluoText.text !== String(fluorite)) this.bumpT = 0
    this.woodText.text = String(wood)
    this.fluoText.text = String(fluorite)
  }

  setSerenity(v: number): void { this.serenity = v }

  setHint(t: string | null): void {
    this.hint.visible = t !== null
    if (t !== null && this.hintText.text !== t) {
      this.hintText.text = t
      const w = this.hintText.width + 28
      const h = this.hintText.height + 14
      this.hintBg.clear().roundRect(-w / 2, -h / 2, w, h, 8).fill({ color: 0x0a0e0a, alpha: 0.72 })
      this.hintText.position.set(-this.hintText.width / 2, -this.hintText.height / 2)
    }
  }

  toast(text: string): void { this.toasts.push({ text, t: 0 }) }

  update(realDt: number, timeS: number): void {
    const { width, height } = this.app.screen
    // 背包计数跳动
    this.bumpT = Math.min(1, this.bumpT + realDt * 4)
    const bump = 1 + 0.25 * (1 - this.bumpT)
    this.counters.scale.set(bump)
    this.counters.position.set(width - 96, height - 72)
    // 蒲公英：绒毛数按安宁值，低值转灰白
    const petals = Math.ceil((this.serenity / CONFIG.serenity.max) * PETALS)
    if (petals !== this.lastPetals) {
      this.lastPetals = petals
      const k = this.serenity / CONFIG.serenity.max
      const warm = { r: 255, g: 242, b: 200 }
      const pale = { r: 154, g: 163, b: 155 }
      const c = ((warm.r + (pale.r - warm.r) * (1 - k)) << 16)
        | ((warm.g + (pale.g - warm.g) * (1 - k)) << 8)
        | (warm.b + (pale.b - warm.b) * (1 - k))
      this.flower.clear()
      for (let i = 0; i < petals; i++) {
        const a = (i / PETALS) * Math.PI * 2 - Math.PI / 2
        this.flower.moveTo(Math.cos(a) * 8, Math.sin(a) * 8)
          .lineTo(Math.cos(a) * 24, Math.sin(a) * 24)
          .stroke({ color: c, width: 2, alpha: 0.9 })
        this.flower.circle(Math.cos(a) * 24, Math.sin(a) * 24, 2).fill({ color: c, alpha: 0.9 })
      }
      this.flower.circle(0, 0, 6).fill(c)
    }
    this.flower.position.set(64, height - 64)
    this.flower.rotation = Math.sin(timeS * 0.8) * 0.05
    // 提示条
    this.hint.position.set(width / 2, height - 110)
    // toast 队列
    const cur = this.toasts[0]
    if (cur) {
      cur.t += realDt
      const total = TOAST_IN + TOAST_HOLD + TOAST_OUT
      let a = 1
      if (cur.t < TOAST_IN) a = cur.t / TOAST_IN
      else if (cur.t > TOAST_IN + TOAST_HOLD) a = Math.max(0, 1 - (cur.t - TOAST_IN - TOAST_HOLD) / TOAST_OUT)
      if (this.toastText.text !== cur.text) {
        this.toastText.text = cur.text
        const w = this.toastText.width + 36
        const h = this.toastText.height + 16
        this.toastBg.clear().roundRect(-w / 2, -h / 2, w, h, 9).fill({ color: 0x0a0e0a, alpha: 0.66 })
        this.toastText.position.set(-this.toastText.width / 2, -this.toastText.height / 2)
      }
      this.toastC.visible = true
      this.toastC.alpha = a
      this.toastC.position.set(width / 2, 72)
      if (cur.t >= total) this.toasts.shift()
    } else {
      this.toastC.visible = false
    }
  }
}
```

- [ ] **Step 3: main 装配**

`src/main.ts` 修改：
- import 增 `deriveHint`、`LostFx`、`UI`
- `overlay` 之后:
```ts
  const lostFx = new LostFx(app, scene.world)
  app.stage.addChild(lostFx.container)
  const ui = new UI(app)
  app.stage.addChild(ui.container)
  ui.toast('夜很深，跟随微光。')
  ui.toast('WASD 移动 · 左键 采集')
```
- 事件 switch 的 `crafted/postPlaced` 分支追加 toast:
```ts
        case 'crafted': sfx.chime(); ui.toast('合成完成——E 放下提灯柱'); break
        case 'postPlaced':
          sfx.placeThump()
          ui.toast(e.index === 0 ? '第一盏灯亮起，森林安静了些。' : '提灯柱已放置')
          break
```
- ticker 末尾（light.update 之后）追加:
```ts
    ui.setCounts(st.world.inventory.wood, st.world.inventory.fluorite)
    ui.setSerenity(st.world.serenity)
    ui.setHint(deriveHint(st))
    ui.update(realDt, elapsed)
    lostFx.update(st.world.lost, realDt)
```

- [ ] **Step 4: 全量验证 + 冒烟截图**

Run: `npm run check && npm run test && npm run build`
Expected: 全部通过

Run:
```bash
npx vite preview --host 0.0.0.0 --port 4179 &
sleep 2
node tools/smoke_probe.mjs http://127.0.0.1:4179/ /tmp/claude-0/-workspace-senzhidiyu/dd50fd48-228e-4736-928f-d94131502f7f/scratchpad/task8-smoke.png
kill %1
```
Expected: 无 `[pageerror]`；截图可见 HUD（左下蒲公英、右下计数、上中开场 toast）

- [ ] **Step 5: Commit**

```bash
git add src/render/ui.ts src/render/lostFx.ts src/main.ts
git commit -m "feat(render,ui): HUD（背包/蒲公英安宁值/情境提示/toast）与迷失雾圈降饱和"
```

---

### Task 9: 全量回归、真机冒烟与台账

**Files:**
- Modify: `.superpowers/sdd/progress.md`（追加本里程碑台账）

- [ ] **Step 1: 全量回归**

Run: `npm run test && npm run check && npm run build`
Expected: 全部测试文件全绿（预计 60+ 测试）；tsc 无错；build 通过

- [ ] **Step 2: 真机冒烟（dev server + 探针连拍）**

```bash
npx vite preview --host 0.0.0.0 --port 4179 &
sleep 2
node tools/smoke_probe.mjs http://127.0.0.1:4179/ /tmp/claude-0/-workspace-senzhidiyu/dd50fd48-228e-4736-928f-d94131502f7f/scratchpad/final-smoke-1.png
node tools/smoke_probe.mjs http://127.0.0.1:4179/ /tmp/claude-0/-workspace-senzhidiyu/dd50fd48-228e-4736-928f-d94131502f7f/scratchpad/final-smoke-2.png
kill %1
```
核对清单（读截图）：营地可见篝火+火光呼吸；黑暗中树/矿微光点位与 config 布局一致；左下蒲公英 12 绒毛、右下 木0 萤0；开场 toast 文案渲染正常（无豆腐块）；无 `[pageerror]/[UNHANDLED-REJECTION]`。

- [ ] **Step 3: 数值手感自查（可选微调）**

对照设计 §6 校一遍 config 数值；如截图发现布局重叠/光圈过曝，仅调 config 数值并注明。

- [ ] **Step 4: 台账与收尾提交**

`.superpowers/sdd/progress.md` 追加本计划台账段（计划路径、分支、各任务提交号、回归结果）。

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: 切片A内容补完执行台账"
```

- [ ] **Step 5: 终审与合并（由主会话执行）**

代码评审（/code-review 或人工全分支审查）→ 修复必修项 → `git checkout main && git merge --no-ff feat/slice-a-content` → 全量回归 → push（触发 Pages 部署）→ 线上探针验收。
