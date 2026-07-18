# 物品系统与交互重做 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-18-items-hotbar-design.md` 落地 Minecraft 式物品系统：36 格库存与热键栏、背包合成、开局斧头、血量、资源分档挖完才掉、倒塌/碎裂动画、树苗种植闭环、白圈+鼠标残影+右键放置。

**Architecture:** sim 层重做世界状态底盘（物品槽/掉落物/种植体/hp/动态节点 id），库存为纯函数模块；破坏-掉落-拾取、放置-生长、动作队列（move/craft）全部 sim 权威 + 事件驱动渲染。渲染层重做 worldView（分档缩放/尸体动画/掉落物/种植体/放置视觉）与 ui（热键栏/血心/背包面板，UI 命中自行 hitTest，主循环按命中路由点击）。

**Tech Stack:** TypeScript、PixiJS ^8、Vite ^6（Node 18 上限）、vitest ^3。零新增依赖。

## Global Constraints

- Node 18.20.4 硬上限：Vite 锁 ^6，不得新增任何依赖
- `src/sim/` 禁止 import pixi.js；全数值入 `src/config.ts`
- 米坐标 `pxPerMeter: 48`；脚底锚点 (0.5,1)；`zIndex = yPx`
- 每张 `Assets.load` 纹理 `source.autoGenerateMipmaps = true`；缺图程序占位
- 输入边沿一律"锁存→实际步进帧消费 + blur 清除"（含新右键/数字键）
- 界面中文；提交信息中文 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- dev/preview 验证走 `127.0.0.1`；分支 `feat/items-hotbar` 起于 main
- 旧特性（计数背包/E 原地合成/previewPos/placing/篝火进度提示）按设计§7§8 删除，其测试同步重写

## 文件结构

```
src/config.ts                  # 重排：inv/drops/place/growth/hp/recipes/tiers/corpse 段
src/sim/types.ts               # ItemKind/ItemStack/DropEntity/Planting/SimAction/新 WorldState/新事件
src/sim/inventory.ts           # 新：addItem/countOf/takeAt/canAfford/payCost/moveSlot 纯函数
src/sim/world.ts               # 重写：命中破坏/掉落物理拾取/放置/生长/动作/hp（幻影安宁保留）
src/sim/sim.ts                 # 边沿增 place；动作队列 queueAction
src/input/keyboard.ts          # 数字键/滚轮/右键/鼠标坐标/E→背包开关回调
src/render/hints.ts            # 重写三态提示
src/render/textures.ts         # +axe/wood/fluorite/sapling/heart 五图
src/render/worldView.ts        # 重写：分档/尸体/掉落物/种植/放置圈与残影
src/render/ui.ts               # 重写：热键栏/血心/背包面板/hitTest 路由
src/audio/sfx.ts               # +pickup/treeFall/oreCrush/plant/deny
src/main.ts                    # 全量替换装配
tools/e2e_probe.mjs            # 新玩法流程重写
test/inventory.test.ts(新) test/world.test.ts(重写) test/place.test.ts(新)
test/actions.test.ts(新) test/keyboard.test.ts(扩) test/hints.test.ts(重写)
test/{sim-player,serenity,phantom}.test.ts(输入字面量适配)  test/craft.test.ts(删除,由 actions/place 接替)
```

---

### Task 1: 类型/配置/库存纯函数底盘（TDD）

**Files:**
- Create: `src/sim/inventory.ts`
- Modify: `src/config.ts`、`src/sim/types.ts`（均全量替换）、`src/sim/world.ts`（适配编译）、`src/sim/sim.ts`（输入形状）、`src/render/hints.ts`（临时降级）、`src/main.ts`（临时适配）
- Test: `test/inventory.test.ts`（新）、`test/world.test.ts`（重写初始态块）；`test/craft.test.ts`+`test/hints.test.ts` 删除；`test/{sim-player,keyboard,serenity,phantom}.test.ts` 输入字面量适配
- 分支：`git checkout -b feat/items-hotbar main`

**Interfaces:**
- Produces（后续任务全依赖）:
  - `ItemKind = 'axe'|'wood'|'fluorite'|'sapling'|'lanternPost'`；`ItemStack { kind; count }`
  - `WorldState { nodes; posts; plantings; drops; phantom; slots: readonly (ItemStack|null)[]; selected; hp; serenity; lost; seed; nextId; invFullAt }`
  - `IntentInput { moveX; moveY; interact; place; aim: Vec2; selectSlot: number }`（selectSlot -1=无）
  - `SimAction = {type:'move';from;to} | {type:'craft';recipe:number}`
  - `addItem(slots, kind, count) → {slots, leftover}`；`countOf`；`takeAt(slots, idx, n) → {slots, taken}`；`canAfford(slots, cost)`；`payCost(slots, cost)`；`moveSlot(slots, from, to)`
  - `initialSim` 世界含 36 槽（0 号斧头）、hp 满、`nextId=9`

- [ ] **Step 1: 失败测试**

`test/inventory.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { addItem, canAfford, countOf, moveSlot, payCost, takeAt } from '../src/sim/inventory'
import type { ItemStack } from '../src/sim/types'

const empty = (): (ItemStack | null)[] => Array(CONFIG.inv.slots).fill(null)

describe('addItem', () => {
  it('先叠同类再占空格，返回余量', () => {
    let s = empty()
    s[0] = { kind: 'wood', count: 98 }
    const r = addItem(s, 'wood', 3)
    expect(r.slots[0]).toEqual({ kind: 'wood', count: 99 })
    expect(r.slots[1]).toEqual({ kind: 'wood', count: 2 })
    expect(r.leftover).toBe(0)
  })
  it('全满返回 leftover', () => {
    const full = empty().map(() => ({ kind: 'wood' as const, count: 99 }))
    expect(addItem(full, 'wood', 5).leftover).toBe(5)
  })
  it('斧头不堆叠各占一格', () => {
    let s = empty()
    s[0] = { kind: 'axe', count: 1 }
    const r = addItem(s, 'axe', 1)
    expect(r.slots[1]).toEqual({ kind: 'axe', count: 1 })
  })
})

describe('takeAt / cost', () => {
  it('takeAt 扣减并在归零时清格', () => {
    let s = empty()
    s[2] = { kind: 'sapling', count: 2 }
    let r = takeAt(s, 2, 1)
    expect(r.slots[2]).toEqual({ kind: 'sapling', count: 1 })
    r = takeAt(r.slots, 2, 1)
    expect(r.slots[2]).toBeNull()
    expect(takeAt(r.slots, 2, 1).taken).toBe(0)
  })
  it('canAfford/payCost 跨格聚合', () => {
    let s = empty()
    s[0] = { kind: 'wood', count: 6 }; s[9] = { kind: 'wood', count: 4 }; s[1] = { kind: 'fluorite', count: 5 }
    const cost = CONFIG.recipes[0]!.cost
    expect(canAfford(s, cost)).toBe(true)
    const paid = payCost(s, cost)
    expect(countOf(paid, 'wood')).toBe(0)
    expect(countOf(paid, 'fluorite')).toBe(0)
    expect(canAfford(empty(), cost)).toBe(false)
  })
})

describe('moveSlot', () => {
  it('同类合并到上限，异类交换', () => {
    let s = empty()
    s[0] = { kind: 'wood', count: 60 }; s[1] = { kind: 'wood', count: 60 }
    let r = moveSlot(s, 0, 1)
    expect(r[1]).toEqual({ kind: 'wood', count: 99 })
    expect(r[0]).toEqual({ kind: 'wood', count: 21 })
    s = empty(); s[0] = { kind: 'axe', count: 1 }; s[1] = { kind: 'wood', count: 3 }
    r = moveSlot(s, 0, 1)
    expect(r[0]).toEqual({ kind: 'wood', count: 3 })
    expect(r[1]).toEqual({ kind: 'axe', count: 1 })
  })
})
```

`test/world.test.ts` 初始态块替换为:
```ts
describe('初始世界', () => {
  const w = initialSim(20, 20.8).world
  it('分档节点：2小2中2大树 + 2小1大矿，id 唯一，nextId=9', () => {
    const trees = w.nodes.filter((n) => n.kind === 'tree')
    const ores = w.nodes.filter((n) => n.kind === 'ore')
    expect(trees.map((t) => t.tier).sort()).toEqual([0, 0, 1, 1, 2, 2])
    expect(ores.map((t) => t.tier).sort()).toEqual([0, 0, 1])
    expect(trees.every((n) => n.charges === CONFIG.tiers.tree[n.tier]!.charges)).toBe(true)
    expect(new Set(w.nodes.map((n) => n.id)).size).toBe(9)
    expect(w.nextId).toBe(9)
  })
  it('开局：斧头在 0 号并选中、hp 满、无掉落物无种植', () => {
    expect(w.slots[0]).toEqual({ kind: 'axe', count: 1 })
    expect(w.slots.filter(Boolean)).toHaveLength(1)
    expect(w.selected).toBe(0)
    expect(w.hp).toBe(CONFIG.hp.max)
    expect(w.drops).toEqual([])
    expect(w.plantings).toEqual([])
  })
})
```

- [ ] **Step 2: 确认失败**  Run: `npx vitest run test/inventory.test.ts test/world.test.ts` → FAIL（模块/字段不存在）

- [ ] **Step 3: 实现**

`src/config.ts` 全量替换（原有段保留，craft 段删除，新增如下；此处只列出与上版的差异段，其余原样）:
```ts
  // 删除: craft: { rangeM, wood, fluorite, placeAheadM, edgeMarginM }
  inv: { slots: 36, hotbar: 9, stackMax: 99 },
  drops: { pickupRadiusM: 1.0, pickupDelayS: 0.5, scatterMin: 1.5, scatterMax: 3, dragPerS: 6, itemH: 0.45 },
  place: { rangeM: 3, spacingM: 0.8, edgeMarginM: 1 },
  growth: { durS: 90 },
  hp: { max: 100, campfireRegen: 10 },
  saplingChance: 0.35,
  recipes: [
    { name: '提灯柱', out: 'lanternPost', outCount: 1, cost: [{ kind: 'wood', count: 10 }, { kind: 'fluorite', count: 5 }] },
  ],
  tiers: {
    tree: [
      { charges: 3, drop: 2, heightM: 2.4, glow: 0.7, saplingRolls: 1 },
      { charges: 4, drop: 4, heightM: 3.2, glow: 1.0, saplingRolls: 1 },
      { charges: 5, drop: 6, heightM: 4.2, glow: 1.3, saplingRolls: 2 },
    ],
    ore: [
      { charges: 3, drop: 2, heightM: 0.9, glow: 0.85 },
      { charges: 5, drop: 5, heightM: 1.15 * 1.2, glow: 1.15 },
    ],
  },
  corpse: { treeFallS: 0.8, treeFadeS: 1.5, oreCrushS: 0.5, oreFadeS: 1.2 },
  nodes: {
    trees: [
      { x: 12.5, y: 13, tier: 1 }, { x: 27, y: 11.5, tier: 0 }, { x: 31.5, y: 22, tier: 2 },
      { x: 9, y: 25.5, tier: 0 }, { x: 15.5, y: 31, tier: 1 }, { x: 25.5, y: 29.5, tier: 2 },
    ],
    ores: [{ x: 7.5, y: 16.5, tier: 0 }, { x: 33, y: 15.5, tier: 1 }, { x: 21.5, y: 34.5, tier: 0 }],
  },
```
（`sizes` 段删 treeH/oreH——高度改由 tiers 提供；保留 campfireH/postH/phantomH。`recipes` 用 `as const` 顶层收尾保类型。ore tier1 heightM 直接写 1.4。）

`src/sim/types.ts`：`ItemKind/ItemStack/DropEntity{id,kind,pos,vel,bornAt}/Planting{id,pos,plantedAt}/SimAction` 新增；`ResourceNode` 增 `tier: number`；`WorldState` 按 Interfaces 块（`inventory`/`placing` 删除，`invFullAt: number` 初 -999）；`IntentInput` 换新形状；`SimEvent` 换新集合：
```ts
export type SimEvent =
  | { type: 'nodeHit'; nodeId: number; pos: Vec2 }
  | { type: 'nodeBroken'; kind: NodeKind; tier: number; pos: Vec2; nodeId: number }
  | { type: 'pickup'; kind: ItemKind; pos: Vec2 }
  | { type: 'invFull' }
  | { type: 'planted'; pos: Vec2 }
  | { type: 'grown'; pos: Vec2; nodeId: number }
  | { type: 'crafted'; recipe: number }
  | { type: 'postPlaced'; pos: Vec2; index: number }
  | { type: 'phantomSigh'; pos: Vec2 }
  | { type: 'lostEnter' } | { type: 'lostExit' }
```
（各字段挂 readonly，与现有风格一致。）`initialWorld`：nodes 由 `CONFIG.nodes.trees/ores` 携 tier 生成、charges 查 tiers；`slots` 36 nulls + 0 号斧头；`selected: 0`；`hp: CONFIG.hp.max`。

`src/sim/inventory.ts`:
```ts
import { CONFIG } from '../config'
import type { ItemKind, ItemStack } from './types'

type Slots = readonly (ItemStack | null)[]
const MAX = CONFIG.inv.stackMax
const stackable = (k: ItemKind) => k !== 'axe'

/** 先叠同类再占空格；返回新槽组与装不下的余量 */
export function addItem(slots: Slots, kind: ItemKind, count: number): { slots: (ItemStack | null)[]; leftover: number } {
  const out = [...slots]
  let left = count
  if (stackable(kind)) {
    for (let i = 0; i < out.length && left > 0; i++) {
      const s = out[i]
      if (s && s.kind === kind && s.count < MAX) {
        const take = Math.min(MAX - s.count, left)
        out[i] = { kind, count: s.count + take }
        left -= take
      }
    }
  }
  for (let i = 0; i < out.length && left > 0; i++) {
    if (!out[i]) {
      const take = stackable(kind) ? Math.min(MAX, left) : 1
      out[i] = { kind, count: take }
      left -= take
    }
  }
  return { slots: out, leftover: left }
}

export function countOf(slots: Slots, kind: ItemKind): number {
  return slots.reduce((n, s) => n + (s?.kind === kind ? s.count : 0), 0)
}

/** 从 idx 格扣 n 个；返回实际扣到的数量 */
export function takeAt(slots: Slots, idx: number, n: number): { slots: (ItemStack | null)[]; taken: number } {
  const s = slots[idx]
  if (!s) return { slots: [...slots], taken: 0 }
  const taken = Math.min(s.count, n)
  const out = [...slots]
  out[idx] = s.count - taken > 0 ? { kind: s.kind, count: s.count - taken } : null
  return { slots: out, taken }
}

export type Cost = readonly { readonly kind: ItemKind; readonly count: number }[]
export const canAfford = (slots: Slots, cost: Cost): boolean => cost.every((c) => countOf(slots, c.kind) >= c.count)

/** 跨格扣费（假定 canAfford 已通过） */
export function payCost(slots: Slots, cost: Cost): (ItemStack | null)[] {
  let out = [...slots]
  for (const c of cost) {
    let need = c.count
    for (let i = 0; i < out.length && need > 0; i++) {
      if (out[i]?.kind === c.kind) {
        const r = takeAt(out, i, need)
        out = r.slots
        need -= r.taken
      }
    }
  }
  return out
}

/** 同类可叠则灌注到上限，否则交换 */
export function moveSlot(slots: Slots, from: number, to: number): (ItemStack | null)[] {
  const out = [...slots]
  if (from === to) return out
  const a = out[from]
  const b = out[to]
  if (a && b && a.kind === b.kind && stackable(a.kind) && b.count < MAX) {
    const pour = Math.min(MAX - b.count, a.count)
    out[to] = { kind: b.kind, count: b.count + pour }
    out[from] = a.count - pour > 0 ? { kind: a.kind, count: a.count - pour } : null
  } else {
    out[from] = b
    out[to] = a
  }
  return out
}
```

过渡适配（本任务保编译绿，行为下任务落地）：`world.ts` 删除 canCraft/previewPos 与 E/placing 块、harvest 块改"仅当选中斧头扣 charges，归零移除节点"（暂不掉落，事件暂只发 nodeHit）；`sim.ts` pendingCraft→pendingPlace（input.place）、`queueAction` 空转存列表待 Task 4 用；`hints.ts` 暂 `return null`（Task 5 重写）；`main.ts` 输入按新形状传 `{ place:false, aim:{x:0,y:0}, selectSlot:-1 }` 常量占位、事件 switch 删掉 crafted/postPlaced toast 之外已不存在的分支（保留编译）。删除 `test/craft.test.ts`、`test/hints.test.ts`；四个既有测试文件的输入辅助改为：
```ts
const input = (o: Partial<IntentInput> = {}): IntentInput =>
  ({ moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, ...o })
```
（keyboard.test 的 Sim 字面量与 serenity/phantom 的 `I()` 同步；world.test 的旧"采集收益"块整体删除，Task 2 重建。）

- [ ] **Step 4: 全量绿** Run: `npx vitest run && npm run check` → 全绿
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(sim): 物品库存底盘——36槽纯函数库存/分档节点/hp字段/新输入形状"`

---

### Task 2: 破坏掉落、拾取与掉落物理（TDD）

**Files:**
- Modify: `src/sim/world.ts`
- Test: `test/world.test.ts`（追加）

**Interfaces:**
- Produces: `stepWorld` 内命中→`nodeHit`；归零→`nodeBroken`+按档掉落物生成（含树苗 roll）；drops 散射/减速/界内夹紧；0.5s 后 1m 内拾取入包（满则滞留 + `invFull` 3s 节流）；`selectedKind(world): ItemKind | null`

- [ ] **Step 1: 失败测试**（`test/world.test.ts` 追加；辅助 `I/runTicks` 沿用，新增：）
```ts
const withSel = (s: SimState, kind: ItemKind | null): SimState => ({
  ...s,
  world: { ...s.world, slots: s.world.slots.map((x, i) => (i === 0 ? (kind ? { kind, count: 1 } : null) : x)) },
})
/** 完整挥砍 n 轮（每轮首 tick interact） */
function chop(s: SimState, n: number): { state: SimState; events: SimEvent[] } {
  let events: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    const first = stepWorld(s, I({ interact: true }), DT)
    const rest = runTicks(first.state, I(), 45)
    s = rest.state
    events = [...events, ...first.events, ...rest.events]
  }
  return { state: s, events }
}

describe('命中与破坏掉落', () => {
  const nearTree = () => initialSim(12.5, 14.1) // 树0 为中档 tier1: 4次/4木
  it('非斧头选中不结算', () => {
    const { state, events } = chop(withSel(nearTree(), null), 1)
    expect(events.filter((e) => e.type === 'nodeHit')).toHaveLength(0)
    expect(state.world.nodes[0]!.charges).toBe(4)
  })
  it('前3次发 nodeHit，第4次破坏：节点移除+nodeBroken+4木掉落', () => {
    const r3 = chop(nearTree(), 3)
    expect(r3.events.filter((e) => e.type === 'nodeHit')).toHaveLength(3)
    const r4 = chop(r3.state, 1)
    expect(r4.events.filter((e) => e.type === 'nodeBroken')).toHaveLength(1)
    expect(r4.state.world.nodes.find((n) => n.id === 0)).toBeUndefined()
    const woods = r4.state.world.drops.filter((d) => d.kind === 'wood')
    expect(woods).toHaveLength(4)
  })
  it('掉落物滑停且不出界', () => {
    let { state } = chop(nearTree(), 4)
    state = runTicks(state, I(), 90).state // 3 秒后应基本静止
    for (const d of state.world.drops) {
      expect(Math.hypot(d.vel.x, d.vel.y)).toBeLessThan(0.05)
      expect(d.pos.x).toBeGreaterThanOrEqual(1)
      expect(d.pos.x).toBeLessThanOrEqual(39)
    }
  })
  it('拾取：延迟后 1m 内吸入并发 pickup', () => {
    const s = chop(nearTree(), 4).state
    const r = runTicks(s, I(), 60) // 2 秒静置（玩家就站树旁）
    expect(r.events.some((e) => e.type === 'pickup')).toBe(true)
    expect(countOf(r.state.world.slots, 'wood')).toBe(4)
    expect(r.state.world.drops.filter((d) => d.kind === 'wood')).toHaveLength(0)
  })
  it('背包全满掉落物滞留并节流 invFull', () => {
    let s = chop(nearTree(), 4).state
    const full = s.world.slots.map(() => ({ kind: 'fluorite' as const, count: 99 }))
    s = { ...s, world: { ...s.world, slots: full } }
    const r = runTicks(s, I(), 120)
    expect(r.state.world.drops.length).toBeGreaterThan(0)
    const fulls = r.events.filter((e) => e.type === 'invFull')
    expect(fulls.length).toBeGreaterThanOrEqual(1)
    expect(fulls.length).toBeLessThanOrEqual(2) // 4 秒窗口 3s 节流
  })
  it('树苗概率种子确定：同种子同结果', () => {
    const a = chop(initialSim(12.5, 14.1, 7), 4).state.world
    const b = chop(initialSim(12.5, 14.1, 7), 4).state.world
    const saps = (w: typeof a) => w.drops.filter((d) => d.kind === 'sapling').length
    expect(saps(a)).toBe(saps(b))
    expect([0, 1]).toContain(saps(a)) // 中档 1 次 roll
  })
})
```
（import 区补 `countOf`、`ItemKind`、`withSel` 所需类型。）

- [ ] **Step 2: 确认失败** Run: `npx vitest run test/world.test.ts` → FAIL
- [ ] **Step 3: 实现**（world.ts 命中块替换 + 掉落/拾取步）
```ts
export const selectedKind = (w: WorldState): ItemKind | null => w.slots[w.selected]?.kind ?? null
```
命中块:
```ts
  let seed = world.seed
  const crossedHit = /* 原判定不变 */
  if (crossedHit && selectedKind(world) === 'axe') {
    const idx = nearestNodeIdx(world.nodes, player.pos, CONFIG.gather.rangeM)
    if (idx >= 0) {
      const node = world.nodes[idx]!
      const charges = node.charges - 1
      if (charges > 0) {
        world = { ...world, nodes: world.nodes.map((n, i) => (i === idx ? { ...n, charges } : n)) }
        events.push({ type: 'nodeHit', nodeId: node.id, pos: node.pos })
      } else {
        // 破坏：移除节点，按档散射掉落物
        const drops = [...world.drops]
        let nextId = world.nextId
        const spawn = (kind: ItemKind) => {
          const r1 = nextRand(seed); const r2 = nextRand(r1.seed); seed = r2.seed
          const ang = r1.value * Math.PI * 2
          const sp = CONFIG.drops.scatterMin + r2.value * (CONFIG.drops.scatterMax - CONFIG.drops.scatterMin)
          drops.push({
            id: nextId++, kind, pos: node.pos, bornAt: s.time,
            vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp },
          })
        }
        if (node.kind === 'tree') {
          const t = CONFIG.tiers.tree[node.tier]!
          for (let i = 0; i < t.drop; i++) spawn('wood')
          for (let i = 0; i < t.saplingRolls; i++) {
            const r = nextRand(seed); seed = r.seed
            if (r.value < CONFIG.saplingChance) spawn('sapling')
          }
        } else {
          for (let i = 0; i < CONFIG.tiers.ore[node.tier]!.drop; i++) spawn('fluorite')
        }
        world = { ...world, nodes: world.nodes.filter((_, i) => i !== idx), drops, nextId }
        events.push({ type: 'nodeBroken', kind: node.kind, tier: node.tier, pos: node.pos, nodeId: node.id })
      }
    }
  }
```
掉落物理与拾取（放置块之后、幻影之前；本任务时点在命中块之后）:
```ts
  // 掉落物：减速滑行 + 界内夹紧 + 延迟拾取
  if (world.drops.length) {
    const D = CONFIG.drops
    const m = CONFIG.place.edgeMarginM
    let slots = world.slots
    let invFullAt = world.invFullAt
    const remain: DropEntity[] = []
    for (const d of world.drops) {
      const k = Math.max(0, 1 - D.dragPerS * dt)
      const vel = { x: d.vel.x * k, y: d.vel.y * k }
      const pos = {
        x: clamp(d.pos.x + vel.x * dt, m, CONFIG.world.width - m),
        y: clamp(d.pos.y + vel.y * dt, m, CONFIG.world.height - m),
      }
      const ripe = s.time - d.bornAt >= D.pickupDelayS
      if (ripe && dist(pos, player.pos) <= D.pickupRadiusM) {
        const r = addItem(slots, d.kind, 1)
        if (r.leftover === 0) {
          slots = r.slots
          events.push({ type: 'pickup', kind: d.kind, pos })
          continue
        }
        if (s.time - invFullAt > 3) { events.push({ type: 'invFull' }); invFullAt = s.time }
      }
      remain.push({ ...d, pos, vel })
    }
    world = { ...world, drops: remain, slots, invFullAt }
  }
```
`world = { ...world, seed }` 在命中块后回写；`selected` 由 `input.selectSlot >= 0` 时更新：
```ts
  if (input.selectSlot >= 0 && input.selectSlot < CONFIG.inv.hotbar) {
    world = { ...world, selected: input.selectSlot }
  }
```
（此行放在最前，命中判定用最新选中格。）import 区补 `nextRand/addItem` 与类型。

- [ ] **Step 4: 全量绿** `npx vitest run && npm run check`
- [ ] **Step 5: Commit** `git commit -m "feat(sim): 挖完才掉——分档破坏掉落/散射物理/延迟拾取/满包节流"`

---

### Task 3: 放置重做与种植生长（TDD）

**Files:**
- Modify: `src/sim/world.ts`、`src/sim/sim.ts`
- Test: `test/place.test.ts`（新）

**Interfaces:**
- Produces: `canPlaceAt(world, playerPos, aim): boolean`（圈 3m/边距 1m/间距 0.8m 含篝火）；右键消耗选中可放置物 → `planted{pos}`/`postPlaced{pos,index}`；plantings 90s → tier0 小树入 nodes + `grown`；`Sim` 增 pendingPlace 边沿缓存与 `clearPendingEdges` 扩展

- [ ] **Step 1: 失败测试** `test/place.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { initialSim } from '../src/sim/types'
import { canPlaceAt, stepWorld } from '../src/sim/world'
import { Sim } from '../src/sim/sim'
import type { IntentInput, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (o: Partial<IntentInput> = {}): IntentInput =>
  ({ moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, ...o })
const withItem = (s: SimState, kind: 'sapling' | 'lanternPost', n = 1): SimState => ({
  ...s, world: { ...s.world, slots: s.world.slots.map((x, i) => (i === 0 ? { kind, count: n } : x)), selected: 0 },
})

describe('canPlaceAt', () => {
  const s = initialSim(20, 20.8)
  it('圈内合法、圈外/贴实体/出界非法', () => {
    expect(canPlaceAt(s.world, s.player.pos, { x: 21.5, y: 21 })).toBe(true)
    expect(canPlaceAt(s.world, s.player.pos, { x: 26, y: 21 })).toBe(false)          // 超 3m
    expect(canPlaceAt(s.world, s.player.pos, { x: 20, y: 19.2 })).toBe(false)        // 贴篝火 <0.8m
    expect(canPlaceAt(s.world, { x: 1.2, y: 20 }, { x: 0.5, y: 20 })).toBe(false)    // 出界
  })
})

describe('右键放置', () => {
  it('树苗种下：扣物、入 plantings、planted 事件', () => {
    const s = withItem(initialSim(20, 20.8), 'sapling')
    const r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(r.state.world.plantings).toHaveLength(1)
    expect(r.state.world.slots[0]).toBeNull()
    expect(r.events.some((e) => e.type === 'planted')).toBe(true)
  })
  it('提灯柱落地入 posts + postPlaced', () => {
    const s = withItem(initialSim(20, 20.8), 'lanternPost')
    const r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(r.state.world.posts).toHaveLength(1)
    expect(r.events.some((e) => e.type === 'postPlaced' && e.index === 0)).toBe(true)
  })
  it('非法位/非放置物不消耗', () => {
    const bad = stepWorld(withItem(initialSim(20, 20.8), 'sapling'), I({ place: true, aim: { x: 30, y: 21 } }), DT)
    expect(bad.state.world.plantings).toHaveLength(0)
    expect(bad.state.world.slots[0]).toEqual({ kind: 'sapling', count: 1 })
    const axe = stepWorld(initialSim(20, 20.8), I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    expect(axe.state.world.posts).toHaveLength(0)
  })
  it('Sim 缓存 place 边沿且 blur 可清', () => {
    const sim = new Sim(withItem(initialSim(20, 20.8), 'lanternPost'))
    sim.advance(0.01, I({ place: true, aim: { x: 21.5, y: 21 } }))
    sim.advance(0.03, I({ aim: { x: 21.5, y: 21 } }))
    expect(sim.state.world.posts).toHaveLength(1)
    const sim2 = new Sim(withItem(initialSim(20, 20.8), 'lanternPost'))
    sim2.advance(0.01, I({ place: true, aim: { x: 21.5, y: 21 } }))
    sim2.clearPendingEdges()
    sim2.advance(0.03, I({ aim: { x: 21.5, y: 21 } }))
    expect(sim2.state.world.posts).toHaveLength(0)
  })
})

describe('生长', () => {
  it('90s 后长成 tier0 小树并发 grown', () => {
    const s = withItem(initialSim(20, 20.8), 'sapling')
    let r = stepWorld(s, I({ place: true, aim: { x: 21.5, y: 21 } }), DT)
    let cur = r.state
    // 直接快进：把 plantedAt 拨回 90 秒前
    cur = { ...cur, world: { ...cur.world, plantings: cur.world.plantings.map((p) => ({ ...p, plantedAt: cur.time - CONFIG.growth.durS })) } }
    const g = stepWorld(cur, I(), DT)
    expect(g.state.world.plantings).toHaveLength(0)
    const born = g.events.find((e) => e.type === 'grown')
    expect(born).toBeTruthy()
    const tree = g.state.world.nodes.find((n) => n.id === (born as { nodeId: number }).nodeId)!
    expect(tree.kind).toBe('tree')
    expect(tree.tier).toBe(0)
    expect(tree.charges).toBe(CONFIG.tiers.tree[0]!.charges)
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现** world.ts:
```ts
const PLACEABLE = new Set<ItemKind>(['sapling', 'lanternPost'])

export function canPlaceAt(world: WorldState, playerPos: Vec2, aim: Vec2): boolean {
  const P = CONFIG.place
  if (dist(playerPos, aim) > P.rangeM) return false
  if (aim.x < P.edgeMarginM || aim.x > CONFIG.world.width - P.edgeMarginM
    || aim.y < P.edgeMarginM || aim.y > CONFIG.world.height - P.edgeMarginM) return false
  const others: Vec2[] = [
    CONFIG.campfire,
    ...world.nodes.map((n) => n.pos),
    ...world.posts,
    ...world.plantings.map((p) => p.pos),
  ]
  return others.every((o) => dist(o, aim) >= P.spacingM)
}
```
放置块（命中块之后）:
```ts
  if (input.place) {
    const kind = selectedKind(world)
    if (kind && PLACEABLE.has(kind) && canPlaceAt(world, player.pos, input.aim)) {
      const taken = takeAt(world.slots, world.selected, 1)
      if (taken.taken === 1) {
        if (kind === 'sapling') {
          const p = { id: world.nextId, pos: input.aim, plantedAt: s.time }
          world = { ...world, slots: taken.slots, plantings: [...world.plantings, p], nextId: world.nextId + 1 }
          events.push({ type: 'planted', pos: input.aim })
        } else {
          const posts = [...world.posts, input.aim]
          world = { ...world, slots: taken.slots, posts }
          events.push({ type: 'postPlaced', pos: input.aim, index: posts.length - 1 })
        }
      }
    }
  }

  // 种植生长
  if (world.plantings.length) {
    const ready = world.plantings.filter((p) => s.time - p.plantedAt >= CONFIG.growth.durS)
    if (ready.length) {
      let nodes = world.nodes
      let nextId = world.nextId
      for (const p of ready) {
        const node = { id: nextId++, kind: 'tree' as const, tier: 0, pos: p.pos, charges: CONFIG.tiers.tree[0]!.charges }
        nodes = [...nodes, node]
        events.push({ type: 'grown', pos: p.pos, nodeId: node.id })
      }
      world = { ...world, nodes, plantings: world.plantings.filter((p) => !ready.includes(p)), nextId }
    }
  }
```
sim.ts：`pendingPlace` 与 interact 同款（advance 锁存、首步消费、clearPendingEdges 清）。

- [ ] **Step 4: 全量绿**；**Step 5: Commit** `git commit -m "feat(sim): 白圈校验右键放置与树苗种植生长闭环"`

---

### Task 4: 动作队列（move/craft）与 hp（TDD）

**Files:** Modify: `src/sim/world.ts`、`src/sim/sim.ts`；Test: `test/actions.test.ts`（新）

**Interfaces:**
- Produces: `Sim.queueAction(a: SimAction)`（缓冲，下个实际步进帧一次性交付）；`stepWorld(s, input, dt, actions?)`；craft 校验扣费产出（满包不执行）；move 走 moveSlot；hp 篝火回复 + `applyDamage(world, n): WorldState`

- [ ] **Step 1: 失败测试** `test/actions.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { countOf } from '../src/sim/inventory'
import { Sim } from '../src/sim/sim'
import { initialSim } from '../src/sim/types'
import { applyDamage, stepWorld } from '../src/sim/world'
import type { IntentInput, ItemStack, SimState } from '../src/sim/types'

const DT = 1 / 30
const I = (): IntentInput => ({ moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1 })
const withSlots = (s: SimState, fill: (i: number) => ItemStack | null): SimState =>
  ({ ...s, world: { ...s.world, slots: s.world.slots.map((_, i) => fill(i)) } })

describe('craft 动作', () => {
  const rich = (s: SimState) => withSlots(s, (i) => (i === 1 ? { kind: 'wood', count: 10 } : i === 2 ? { kind: 'fluorite', count: 5 } : i === 0 ? { kind: 'axe', count: 1 } : null))
  it('扣费产出提灯柱并发 crafted', () => {
    const r = stepWorld(rich(initialSim(5, 5)), I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'lanternPost')).toBe(1)
    expect(countOf(r.state.world.slots, 'wood')).toBe(0)
    expect(r.events.some((e) => e.type === 'crafted')).toBe(true)
  })
  it('材料不足不执行', () => {
    const r = stepWorld(initialSim(5, 5), I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'lanternPost')).toBe(0)
    expect(r.events.filter((e) => e.type === 'crafted')).toHaveLength(0)
  })
  it('产出无处安放则整体不执行不扣费', () => {
    const full = withSlots(initialSim(5, 5), (i) => (i === 0 ? { kind: 'wood', count: 10 } : i === 1 ? { kind: 'fluorite', count: 5 } : { kind: 'fluorite', count: 99 }))
    const r = stepWorld(full, I(), DT, [{ type: 'craft', recipe: 0 }])
    expect(countOf(r.state.world.slots, 'wood')).toBe(10)
  })
})

describe('move 动作与队列', () => {
  it('Sim.queueAction 缓冲到实际步进帧', () => {
    const sim = new Sim(withSlots(initialSim(5, 5), (i) => (i === 0 ? { kind: 'wood', count: 3 } : null)))
    sim.queueAction({ type: 'move', from: 0, to: 10 })
    sim.advance(0.01, I()) // 无步进，动作应保留
    sim.advance(0.03, I())
    expect(sim.state.world.slots[10]).toEqual({ kind: 'wood', count: 3 })
    expect(sim.state.world.slots[0]).toBeNull()
  })
})

describe('hp', () => {
  it('篝火圈内回复并夹紧', () => {
    const hurt: SimState = { ...initialSim(20, 20.8), world: { ...initialSim(20, 20.8).world, hp: 95 } }
    let s = hurt
    for (let i = 0; i < 30; i++) s = stepWorld(s, I(), DT).state
    expect(s.world.hp).toBe(CONFIG.hp.max)
  })
  it('野外不回复；applyDamage 夹紧 0', () => {
    const wild: SimState = { ...initialSim(5, 5), world: { ...initialSim(5, 5).world, hp: 50 } }
    const s = stepWorld(wild, I(), DT).state
    expect(s.world.hp).toBe(50)
    expect(applyDamage(wild.world, 999).hp).toBe(0)
  })
})
```

- [ ] **Step 2: 确认失败**；**Step 3: 实现**
world.ts 签名 `stepWorld(s, input, dt, actions: readonly SimAction[] = [])`；动作块（生长之后、幻影之前）:
```ts
  for (const a of actions) {
    if (a.type === 'move') {
      world = { ...world, slots: moveSlot(world.slots, a.from, a.to) }
    } else {
      const r = CONFIG.recipes[a.recipe]
      if (r && canAfford(world.slots, r.cost)) {
        const paid = payCost(world.slots, r.cost)
        const add = addItem(paid, r.out, r.outCount)
        if (add.leftover === 0) {
          world = { ...world, slots: add.slots }
          events.push({ type: 'crafted', recipe: a.recipe })
        }
      }
    }
  }
```
hp（安宁块旁）:
```ts
  const inCampfire = dist(CONFIG.campfire, player.pos) <= CONFIG.light.campfireRadiusM
  if (inCampfire && world.hp < CONFIG.hp.max) {
    world = { ...world, hp: clamp(world.hp + CONFIG.hp.campfireRegen * dt, 0, CONFIG.hp.max) }
  }
```
```ts
/** 预留伤害入口（本切片无伤害源） */
export const applyDamage = (w: WorldState, n: number): WorldState => ({ ...w, hp: clamp(w.hp - n, 0, CONFIG.hp.max) })
```
sim.ts：`private actions: SimAction[] = []`；`queueAction(a) { this.actions.push(a) }`；步进循环首步 `const acts = this.actions; this.actions = []` 传入 stepWorld，后续步传 `[]`。

- [ ] **Step 4: 全量绿**；**Step 5: Commit** `git commit -m "feat(sim): 背包动作队列（搬格/合成）与血量回复"`

---

### Task 5: 输入层扩展与提示重写（TDD）

**Files:** Modify: `src/input/keyboard.ts`、`src/render/hints.ts`；Test: `test/keyboard.test.ts`（追加）、`test/hints.test.ts`（重建）

**Interfaces:**
- Produces:
  - `Keyboard`: `consumePlace(): boolean`（右键）、`consumeSelect(): number`（数字键 1-9→0-8，无为 -1）、`consumeWheel(): number`（滚轮符号累计 -1/0/1）、`consumeBagToggle(): boolean`（KeyE）、`mouse: {x,y}`（屏幕像素，实时）、右键 contextmenu 屏蔽；blur 清一切锁存
  - `deriveHint(s: SimState): string | null`：可放置选中 →『右键 放置（圈内）』；斧头且近节点 →『左键 采集低语木/萤石』；否则 null

- [ ] **Step 1: 失败测试**
`test/keyboard.test.ts` 追加（沿用 attach/dispatch 辅助；新增 dispatchWheel/dispatchMove）:
```ts
  const dispatchWheel = (t: EventTarget, deltaY: number) =>
    t.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }))
  const dispatchMove = (t: EventTarget, clientX: number, clientY: number) =>
    t.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }))

  it('右键锁存 place，blur 清除', () => {
    const { target, kb } = attach()
    dispatchPointer(target, 2)
    expect(kb.consumePlace()).toBe(true)
    expect(kb.consumePlace()).toBe(false)
    dispatchPointer(target, 2)
    target.dispatchEvent(new Event('blur'))
    expect(kb.consumePlace()).toBe(false)
  })
  it('数字键选格 1→0、9→8，一次消费', () => {
    const { target, kb } = attach()
    dispatchKeydown(target, 'Digit3')
    expect(kb.consumeSelect()).toBe(2)
    expect(kb.consumeSelect()).toBe(-1)
  })
  it('滚轮给出符号并清零', () => {
    const { target, kb } = attach()
    dispatchWheel(target, 120)
    expect(kb.consumeWheel()).toBe(1)
    expect(kb.consumeWheel()).toBe(0)
    dispatchWheel(target, -120)
    expect(kb.consumeWheel()).toBe(-1)
  })
  it('E 变为背包开关边沿', () => {
    const { target, kb } = attach()
    dispatchKeydown(target, 'KeyE')
    expect(kb.consumeBagToggle()).toBe(true)
    expect(kb.consumeBagToggle()).toBe(false)
  })
  it('鼠标位置实时可读', () => {
    const { target, kb } = attach()
    dispatchMove(target, 333, 222)
    expect(kb.mouse).toEqual({ x: 333, y: 222 })
  })
```
`test/hints.test.ts`（新建）:
```ts
import { describe, expect, it } from 'vitest'
import { deriveHint } from '../src/render/hints'
import { initialSim } from '../src/sim/types'
import type { ItemStack, SimState } from '../src/sim/types'

const withSel = (s: SimState, stack: ItemStack | null): SimState =>
  ({ ...s, world: { ...s.world, slots: s.world.slots.map((x, i) => (i === 0 ? stack : x)), selected: 0 } })

describe('deriveHint', () => {
  it('放置物 > 斧头采集 > 无', () => {
    expect(deriveHint(withSel(initialSim(5, 5), { kind: 'lanternPost', count: 1 }))).toBe('右键 放置（圈内）')
    expect(deriveHint(initialSim(12.5, 14.1))).toBe('左键 采集低语木')
    expect(deriveHint(initialSim(7.5, 17.6))).toBe('左键 采集萤石')
    expect(deriveHint(withSel(initialSim(12.5, 14.1), null))).toBeNull() // 空手不提示采集
    expect(deriveHint(initialSim(5, 5))).toBeNull()
  })
})
```

- [ ] **Step 2: 确认失败**；**Step 3: 实现**
keyboard.ts（craftPressed 更名 bagToggle；新增字段与监听）:
```ts
  private placePressed = false
  private bagPressed = false
  private selectPressed = -1
  private wheelAcc = 0
  readonly mouse = { x: 0, y: 0 }
```
attach 内:
```ts
      if (e.code === 'KeyE') this.bagPressed = true
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5))
        if (n >= 1 && n <= 9) this.selectPressed = n - 1
      }
```
```ts
    target.addEventListener('pointerdown', (e) => {
      unlock()
      if (e.button === 0) this.interactPressed = true
      if (e.button === 2) this.placePressed = true
    })
    target.addEventListener('pointermove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY })
    target.addEventListener('wheel', (e) => { this.wheelAcc += e.deltaY })
    target.addEventListener('contextmenu', (e) => e.preventDefault())
    target.addEventListener('blur', () => {
      this.keys.clear()
      this.interactPressed = false
      this.placePressed = false
      this.bagPressed = false
      this.selectPressed = -1
      this.wheelAcc = 0
    })
```
consume 系列同 consumeInteract 模式；`consumeWheel` 返回 `Math.sign(acc)` 并清零。
hints.ts:
```ts
import { CONFIG } from '../config'
import { nearestNodeIdx, selectedKind } from '../sim/world'
import type { SimState } from '../sim/types'

/** 情境提示：放置物 > 斧头采集 > 无 */
export function deriveHint(s: SimState): string | null {
  const kind = selectedKind(s.world)
  if (kind === 'sapling' || kind === 'lanternPost') return '右键 放置（圈内）'
  if (kind === 'axe') {
    const idx = nearestNodeIdx(s.world.nodes, s.player.pos, CONFIG.gather.rangeM)
    if (idx >= 0) return s.world.nodes[idx]!.kind === 'tree' ? '左键 采集低语木' : '左键 采集萤石'
  }
  return null
}
```

- [ ] **Step 4: 全量绿**；**Step 5: Commit** `git commit -m "feat(input): 右键/数字键/滚轮/鼠标坐标/E背包开关与提示重写"`

---

### Task 6: 渲染重做——纹理五图、worldView、放置视觉、main 装配

**Files:** Modify: `src/render/textures.ts`、`src/render/worldView.ts`（全量替换）、`src/main.ts`（全量替换）

**Interfaces:**
- Produces:
  - `GameTextures` 增 `axe/wood/fluorite/sapling/heart`
  - `WorldView.update(prev, cur, alphaV, timeS, realDt, view: { aimM: Vec2; showPlace: boolean })`；`shake(nodeId)`；`breakNode(e: nodeBroken 事件)`（尸体动画入场）
  - main：aim 换算、滚轮/数字→selectSlot、右键→place（背包开时不投递）、事件全接线、灯表含分档 glow 与 grown/broken 置脏

- [ ] **Step 1: textures 增五图**（FILES/builders/loadTextures 各加五项；占位形状）:
```ts
  axe: 'axe.png', wood: 'wood.png', fluorite: 'fluorite.png', sapling: 'sapling.png', heart: 'heart.png',
```
```ts
  axe(g) {
    g.roundRect(-5, -60, 10, 60, 4).fill(0x6b563a)
    g.poly([-6, -60, -30, -50, -30, -30, -6, -36]).fill(0x8a8f80)
  },
  wood(g) { g.roundRect(-26, -20, 52, 20, 8).fill(0x3c554c); g.circle(-26, -10, 9).fill(0xcbb99a) },
  fluorite(g) { g.poly([-12, 0, 0, -34, 12, 0]).fill(0x8ac0e8) },
  sapling(g) { g.rect(-2, -26, 4, 26).fill(0x4c5a44); g.circle(0, -30, 8).fill(0x5a8a6a) },
  heart(g) {
    g.circle(-7, -18, 8).fill(0x9a3040)
    g.circle(7, -18, 8).fill(0x9a3040)
    g.poly([-14, -14, 0, 2, 14, -14]).fill(0x9a3040)
  },
```

- [ ] **Step 2: worldView 全量替换**

```ts
import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import { lerp } from '../sim/vec'
import { canPlaceAt, selectedKind } from '../sim/world'
import { makeRadialTexture } from './lightLayer'
import type { NodeKind, SimState, Vec2 } from '../sim/types'
import type { GameTextures } from './textures'

const px = CONFIG.pxPerMeter
const SHAKE_DUR = 0.3
const easeIn = (x: number) => x * x

interface Corpse { sp: Sprite; kind: NodeKind; t: number; dir: 1 | -1 }

function footSprite(tex: Texture, heightM: number): Sprite {
  const s = new Sprite(tex)
  s.anchor.set(0.5, 1)
  s.scale.set((heightM * px) / tex.height)
  return s
}

/** 世界实体渲染：分档节点/尸体动画/掉落物/种植体/篝火/幻影/放置圈与残影 */
export class WorldView {
  private nodeSprites = new Map<number, Sprite>()
  private dropSprites = new Map<number, Sprite>()
  private plantSprites = new Map<number, Sprite>()
  private corpses: Corpse[] = []
  private postSprites: Sprite[] = []
  private flame: Sprite
  private phantom: Sprite
  private circle = new Graphics()
  private ghost = new Sprite()
  private shakes = new Map<number, number>()
  private glowTex = makeRadialTexture()

  constructor(private world: Container, overlay: Container, private tex: GameTextures, initial: SimState) {
    for (const n of initial.world.nodes) this.addNode(n.id, n.kind, n.tier, n.pos)
    const campfire = footSprite(tex.campfire, CONFIG.sizes.campfireH)
    campfire.position.set(CONFIG.campfire.x * px, CONFIG.campfire.y * px)
    campfire.zIndex = CONFIG.campfire.y * px
    world.addChild(campfire)
    this.flame = new Sprite(this.glowTex)
    this.flame.anchor.set(0.5)
    this.flame.blendMode = 'add'
    this.flame.tint = 0xff9a40
    this.flame.position.set(CONFIG.campfire.x * px, (CONFIG.campfire.y - 0.55) * px)
    this.flame.zIndex = CONFIG.campfire.y * px + 1
    world.addChild(this.flame)
    this.circle.visible = false
    this.circle.zIndex = 1
    world.addChild(this.circle)
    this.ghost.anchor.set(0.5, 1)
    this.ghost.visible = false
    world.addChild(this.ghost)
    this.phantom = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantom.blendMode = 'add'
    overlay.addChild(this.phantom)
  }

  private nodeTexH(kind: NodeKind, tier: number): { tex: Texture; h: number } {
    return kind === 'tree'
      ? { tex: this.tex.tree, h: CONFIG.tiers.tree[tier]!.heightM }
      : { tex: this.tex.ore, h: CONFIG.tiers.ore[tier]!.heightM }
  }

  private addNode(id: number, kind: NodeKind, tier: number, pos: Vec2): void {
    const { tex, h } = this.nodeTexH(kind, tier)
    const s = footSprite(tex, h)
    s.position.set(pos.x * px, pos.y * px)
    s.zIndex = pos.y * px
    this.nodeSprites.set(id, s)
    this.world.addChild(s)
  }

  shake(nodeId: number): void { this.shakes.set(nodeId, 0) }

  /** nodeBroken：节点精灵转尸体动画（树倒/矿碎），随机方向由事件位置哈希定，确定可复现 */
  breakNode(e: { nodeId: number; kind: NodeKind; pos: Vec2 }): void {
    const sp = this.nodeSprites.get(e.nodeId)
    if (!sp) return
    this.nodeSprites.delete(e.nodeId)
    this.shakes.delete(e.nodeId)
    this.corpses.push({ sp, kind: e.kind, t: 0, dir: (Math.round(e.pos.x * 7 + e.pos.y * 3) % 2 ? 1 : -1) })
  }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, realDt: number,
    view: { aimM: Vec2; showPlace: boolean }): void {
    const C = CONFIG.corpse
    // 节点：新生（grown）与受击摇晃
    for (const n of cur.world.nodes) {
      if (!this.nodeSprites.has(n.id)) this.addNode(n.id, n.kind, n.tier, n.pos)
      const s = this.nodeSprites.get(n.id)!
      let t = this.shakes.get(n.id)
      if (t !== undefined) {
        t += realDt
        if (t >= SHAKE_DUR) { this.shakes.delete(n.id); s.rotation = 0 }
        else { this.shakes.set(n.id, t); s.rotation = Math.sin(t * 40) * 0.07 * (1 - t / SHAKE_DUR) }
      }
    }
    // 尸体动画
    this.corpses = this.corpses.filter((c) => {
      c.t += realDt
      if (c.kind === 'tree') {
        const fall = Math.min(1, c.t / C.treeFallS)
        c.sp.rotation = c.dir * easeIn(fall) * 1.48
        c.sp.alpha = c.t <= C.treeFallS ? 1 : Math.max(0, 1 - (c.t - C.treeFallS) / C.treeFadeS)
        if (c.t >= C.treeFallS + C.treeFadeS) { c.sp.destroy(); return false }
      } else {
        const crush = Math.min(1, c.t / C.oreCrushS)
        c.sp.scale.y = c.sp.scale.x * (1 - 0.6 * crush)
        c.sp.position.x += Math.sin(c.t * 60) * (1 - crush) * 1.5
        c.sp.alpha = c.t <= C.oreCrushS ? 1 : Math.max(0, 1 - (c.t - C.oreCrushS) / C.oreFadeS)
        if (c.t >= C.oreCrushS + C.oreFadeS) { c.sp.destroy(); return false }
      }
      return true
    })
    // 掉落物：同步 + 落地起伏
    const seen = new Set<number>()
    for (const d of cur.world.drops) {
      seen.add(d.id)
      let s = this.dropSprites.get(d.id)
      if (!s) {
        s = footSprite(this.tex[d.kind], CONFIG.drops.itemH)
        this.dropSprites.set(d.id, s)
        this.world.addChild(s)
      }
      const bob = Math.sin(timeS * 3 + d.id) * 2
      s.position.set(d.pos.x * px, d.pos.y * px + bob)
      s.zIndex = d.pos.y * px
    }
    for (const [id, s] of this.dropSprites) if (!seen.has(id)) { s.destroy(); this.dropSprites.delete(id) }
    // 种植体：按进度 0.5→1.0 缩放
    const seenP = new Set<number>()
    for (const p of cur.world.plantings) {
      seenP.add(p.id)
      let s = this.plantSprites.get(p.id)
      if (!s) {
        s = footSprite(this.tex.sapling, 0.9)
        s.position.set(p.pos.x * px, p.pos.y * px)
        s.zIndex = p.pos.y * px
        this.plantSprites.set(p.id, s)
        this.world.addChild(s)
      }
      const k = Math.min(1, (cur.time - p.plantedAt) / CONFIG.growth.durS)
      const base = (0.9 * px) / this.tex.sapling.height
      s.scale.set(base * (0.5 + 0.5 * k))
    }
    for (const [id, s] of this.plantSprites) if (!seenP.has(id)) { s.destroy(); this.plantSprites.delete(id) }
    // 提灯柱
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
    // 篝火火焰
    const f = 1 + 0.18 * 0.5 * (Math.sin(timeS * 7.3) + Math.sin(timeS * 12.1))
    this.flame.scale.set((1.1 * px * 2 * f) / 512)
    this.flame.alpha = 0.6 + 0.1 * Math.sin(timeS * 9.1)
    // 放置视觉：白色虚线圈（跟玩家）+ 鼠标残影（圈外变红）
    this.circle.visible = view.showPlace
    this.ghost.visible = view.showPlace
    if (view.showPlace) {
      const pp = prev.player.pos
      const cp = cur.player.pos
      const cx = lerp(pp.x, cp.x, alphaV) * px
      const cy = lerp(pp.y, cp.y, alphaV) * px
      this.circle.clear()
      const R = CONFIG.place.rangeM * px
      for (let i = 0; i < 24; i++) { // 虚线圆：24 段取偶
        if (i % 2) continue
        const a0 = (i / 24) * Math.PI * 2
        const a1 = ((i + 1) / 24) * Math.PI * 2
        this.circle.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
          .arc(cx, cy, R, a0, a1)
          .stroke({ color: 0xffffff, width: 2, alpha: 0.55 })
      }
      const kind = selectedKind(cur.world)
      const tex = kind === 'sapling' ? this.tex.sapling : this.tex.post
      if (this.ghost.texture !== tex) {
        this.ghost.texture = tex
        this.ghost.scale.set(((kind === 'sapling' ? 0.9 : CONFIG.sizes.postH) * px) / tex.height)
      }
      const ok = canPlaceAt(cur.world, cur.player.pos, view.aimM)
      this.ghost.position.set(view.aimM.x * px, view.aimM.y * px)
      this.ghost.zIndex = view.aimM.y * px
      this.ghost.alpha = 0.55
      this.ghost.tint = ok ? 0xffffff : 0xff5050
    }
    // 幻影（跨重生不插值）
    const pf = prev.world.phantom
    const cf = cur.world.phantom
    const same = pf.mode !== 'gone' && cf.mode !== 'gone'
    const xM = same ? lerp(pf.pos.x, cf.pos.x, alphaV) : cf.pos.x
    const yM = same ? lerp(pf.pos.y, cf.pos.y, alphaV) : cf.pos.y
    const a = same ? lerp(pf.alpha, cf.alpha, alphaV) : cf.alpha
    this.phantom.position.set(this.world.position.x + xM * px, this.world.position.y + yM * px)
    this.phantom.alpha = a * 0.85
    this.phantom.visible = a > 0.01
  }
}
```

- [ ] **Step 3: main 全量替换**（结构与上版一致，差异：aim/selectSlot/place 输入、bagOpen 状态占位（Task 7 接 UI）、事件接线、灯表分档）

```ts
import { Application, Container } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { deriveHint } from './render/hints'
import { LightLayer, type LightSpec } from './render/lightLayer'
import { LostFx } from './render/lostFx'
import { Particles } from './render/particles'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { WorldView } from './render/worldView'
import { UI } from './render/ui'
import { Sfx } from './audio/sfx'
import { Sim } from './sim/sim'
import { initialSim, type SimState, type Vec2 } from './sim/types'
import { selectedKind } from './sim/world'
import { dist, lerp } from './sim/vec'

// （顶层 await 死锁注释原样保留）
async function main(): Promise<void> {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: CONFIG.colors.night,
    antialias: true,
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
  const overlay = new Container()
  app.stage.addChild(overlay)
  const worldView = new WorldView(scene.world, overlay, textures, sim.state)
  const lostFx = new LostFx(app, scene.world)
  app.stage.addChild(lostFx.container)
  const ui = new UI(app, textures)
  app.stage.addChild(ui.container)
  ui.onMove = (from, to) => sim.queueAction({ type: 'move', from, to })
  ui.onCraft = (recipe) => sim.queueAction({ type: 'craft', recipe })
  ui.toast('夜很深，跟随微光。')
  ui.toast('WASD 移动 · 左键 采集 · E 背包')
  document.addEventListener('visibilitychange', () => sfx.rearm())
  window.addEventListener('pointerdown', () => sfx.rearm())
  window.addEventListener('blur', () => sim.clearPendingEdges())
  if (new URLSearchParams(location.search).has('debug')) {
    ;(window as unknown as { __whispers?: { sim: Sim } }).__whispers = { sim }
  }

  const sinks = {
    footstep(xM: number, yM: number) { particles.dust(xM, yM); sfx.footstep() },
    gatherHit(xM: number, yM: number) { particles.spark(xM, yM); sfx.knock() },
  }
  let elapsed = 0
  let emberT = 0

  const playerLight: LightSpec = { xM: 0, yM: 0, radiusM: CONFIG.light.lanternRadiusM, phase: 0 }
  const allLights: LightSpec[] = [playerLight]
  let lightsDirty = true
  const staticLights = (st: SimState): LightSpec[] => [
    { xM: CONFIG.campfire.x, yM: CONFIG.campfire.y - 0.5, radiusM: CONFIG.light.campfireRadiusM, flicker: 1.8, phase: 1 },
    ...st.world.posts.map((p, i) => ({
      xM: p.x, yM: p.y - CONFIG.sizes.postH * 0.82, radiusM: CONFIG.light.postRadiusM, phase: 2 + i,
    })),
    ...st.world.nodes.map((n) => {
      const g = n.kind === 'ore' ? CONFIG.tiers.ore[n.tier]!.glow : CONFIG.tiers.tree[n.tier]!.glow
      return n.kind === 'ore'
        ? { xM: n.pos.x, yM: n.pos.y - 0.5, radiusM: CONFIG.light.oreGlow.radiusM * g, alpha: CONFIG.light.oreGlow.alpha, flicker: 0.5, phase: 10 + n.id }
        : { xM: n.pos.x, yM: n.pos.y - 1.6, radiusM: CONFIG.light.treeGlow.radiusM * g, alpha: CONFIG.light.treeGlow.alpha, flicker: 0.5, phase: 10 + n.id }
    }),
  ]

  app.ticker.add((ticker) => {
    const realDt = Math.min(0.1, ticker.deltaMS / 1000)
    elapsed += realDt

    // 输入路由：背包开时点击给 UI，不进 sim
    if (kb.consumeBagToggle()) ui.toggleBag()
    const clickL = kb.consumeInteract()
    const clickR = kb.consumePlace()
    const overUI = ui.hitTest(kb.mouse.x, kb.mouse.y)
    if (clickL && (ui.bagOpen || overUI)) ui.click(kb.mouse.x, kb.mouse.y)
    const digit = kb.consumeSelect()
    const wheel = kb.consumeWheel()
    const selNow = sim.state.world.selected
    const selectSlot = digit >= 0 ? digit : wheel !== 0 ? (selNow + wheel + CONFIG.inv.hotbar) % CONFIG.inv.hotbar : -1
    const aim: Vec2 = {
      x: (kb.mouse.x - scene.world.position.x) / CONFIG.pxPerMeter,
      y: (kb.mouse.y - scene.world.position.y) / CONFIG.pxPerMeter,
    }
    sim.advance(realDt, {
      ...kb.intent(),
      interact: clickL && !ui.bagOpen && !overUI,
      place: clickR && !ui.bagOpen && !overUI,
      aim, selectSlot,
    })
    const alphaV = sim.alpha()
    const st = sim.state

    for (const e of sim.drainEvents()) {
      switch (e.type) {
        case 'nodeHit': worldView.shake(e.nodeId); break
        case 'nodeBroken':
          worldView.breakNode(e)
          lightsDirty = true
          if (e.kind === 'tree') { particles.firefly(e.pos.x, e.pos.y - 1.2); sfx.treeFall() }
          else { particles.glint(e.pos.x, e.pos.y - 0.5); sfx.oreCrush() }
          break
        case 'pickup': particles.glint(e.pos.x, e.pos.y - 0.3); sfx.pickupPop(); ui.bump(); break
        case 'invFull': ui.toast('背包满了'); sfx.deny(); break
        case 'planted': sfx.plantDig(); break
        case 'grown': lightsDirty = true; break
        case 'crafted': sfx.chime(); ui.toast(`合成：${CONFIG.recipes[e.recipe]!.name}`); break
        case 'postPlaced':
          sfx.placeThump()
          lightsDirty = true
          ui.toast(e.index === 0 ? '第一盏灯亮起，森林安静了些。' : '提灯柱已放置')
          break
        case 'phantomSigh': sfx.sigh(); break
        case 'lostEnter': sfx.setMuffled(true); break
        case 'lostExit': sfx.setMuffled(false); break
      }
    }

    player.update(sim.prev, st, alphaV, elapsed, sinks)
    particles.update(realDt)
    const pp = sim.prev.player.pos
    const cp = st.player.pos
    const ipx = lerp(pp.x, cp.x, alphaV)
    const ipy = lerp(pp.y, cp.y, alphaV)
    scene.follow(ipx, ipy)
    const kind = selectedKind(st.world)
    worldView.update(sim.prev, st, alphaV, elapsed, realDt, {
      aimM: aim,
      showPlace: !ui.bagOpen && (kind === 'sapling' || kind === 'lanternPost'),
    })

    if (lightsDirty) {
      allLights.length = 1
      allLights.push(...staticLights(st))
      lightsDirty = false
    }
    playerLight.xM = ipx
    playerLight.yM = ipy - CONFIG.player.heightM * 0.45
    light.update(allLights, scene.world.position, elapsed)

    emberT -= realDt
    if (emberT <= 0) {
      emberT = 0.4 + Math.random() * 0.8
      particles.ember(CONFIG.campfire.x + (Math.random() - 0.5) * 0.6, CONFIG.campfire.y - 0.6)
    }
    const ph = st.world.phantom
    const dPh = dist(ph.pos, { x: ipx, y: ipy })
    const P = CONFIG.phantom
    sfx.humLevel(ph.mode === 'stare'
      ? 1 - Math.min(1, Math.max(0, (dPh - P.dissolveRange) / (P.stareExit - P.dissolveRange)))
      : 0)

    ui.sync(st.world)
    ui.setHint(deriveHint(st))
    ui.update(realDt, elapsed)
    lostFx.update(st.world.lost, realDt)
  })
}

main().catch((err) => { console.error('启动失败:', err) })
```
（Task 6 时点 UI 尚为旧版——为保编译，本任务先把 `src/render/ui.ts` 替换为 Task 7 的完整实现骨架同批提交；见 Task 7 代码，两任务连续提交。若希望每步可跑，Task 6 Step 3 与 Task 7 Step 1 合并执行后一起验证。）

- [ ] **Step 4: 与 Task 7 合并验证后提交**（见 Task 7）

---

### Task 7: UI 重做——热键栏/血心/背包面板

**Files:** Modify: `src/render/ui.ts`（全量替换）

**Interfaces:**
- Produces: `UI` 新接口：`sync(world)`（槽/选中/hp/配方可用性）、`toggleBag()`、`bagOpen: boolean`、`hitTest(x,y)`、`click(x,y)`、`bump()`（拾取跳动）、`onMove?/onCraft?` 回调、`setHint/toast/update` 保留

- [ ] **Step 1: 实现**（全量替换 `src/render/ui.ts`）

```ts
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { CONFIG } from '../config'
import { canAfford } from '../sim/inventory'
import type { ItemKind, ItemStack, WorldState } from '../sim/types'
import type { GameTextures } from './textures'

const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
const style = (size: number, fill: number) => ({ fontFamily: FONT, fontSize: size, fill })
const CELL = 46
const GAP = 6
const NAMES: Record<ItemKind, string> = {
  axe: '共鸣木斧', wood: '低语木材', fluorite: '萤石', sapling: '低语树苗', lanternPost: '提灯柱',
}

interface Toast { text: string; t: number }
const TOAST_IN = 0.4, TOAST_HOLD = 2.6, TOAST_OUT = 0.6

/** 一个圆角物品格：底/图标/数量/选中框 */
class Cell {
  readonly c = new Container()
  private bg = new Graphics()
  private icon = new Sprite()
  private count = new Text({ text: '', style: style(12, 0xe8e2d0) })
  private sel = false

  constructor(private tex: GameTextures) {
    this.icon.anchor.set(0.5)
    this.count.anchor.set(1, 1)
    this.count.position.set(CELL - 5, CELL - 3)
    this.c.addChild(this.bg, this.icon, this.count)
    this.draw()
  }
  private draw(): void {
    this.bg.clear().roundRect(0, 0, CELL, CELL, 10)
      .fill({ color: 0x10160f, alpha: 0.78 })
      .stroke({ color: this.sel ? 0xffe9b0 : 0x4a5244, width: this.sel ? 2.5 : 1.5, alpha: this.sel ? 0.95 : 0.8 })
  }
  set(stack: ItemStack | null, selected: boolean): void {
    if (selected !== this.sel) { this.sel = selected; this.draw() }
    if (!stack) { this.icon.visible = false; this.count.text = ''; return }
    const t = this.tex[stack.kind]
    if (this.icon.texture !== t) {
      this.icon.texture = t
      const k = (CELL - 12) / Math.max(t.width, t.height)
      this.icon.scale.set(k)
      this.icon.position.set(CELL / 2, CELL / 2)
    }
    this.icon.visible = true
    this.count.text = stack.count > 1 ? String(stack.count) : ''
  }
}

/** HUD：热键栏/血心/背包面板/提示/浮签/toast；命中与点击由 main 路由 */
export class UI {
  readonly container = new Container()
  bagOpen = false
  onMove?: (from: number, to: number) => void
  onCraft?: (recipe: number) => void

  private hotCells: Cell[] = []
  private hotbar = new Container()
  private hearts = new Container()
  private heartsFill = new Container()
  private heartsMask = new Graphics()
  private bag = new Container()
  private bagCells: Cell[] = []
  private recipeBtns: { c: Container; bg: Graphics; label: Text }[] = []
  private heldFrom: number | null = null
  private heldSprite = new Sprite()
  private heldCount = new Text({ text: '', style: style(12, 0xe8e2d0) })
  private nameFloat = new Text({ text: '', style: style(14, 0xf0ead8) })
  private nameT = 9
  private bumpT = 1
  private slots: readonly (ItemStack | null)[] = []
  private selected = 0
  private hp = CONFIG.hp.max
  private afford: boolean[] = []
  private hintText = new Text({ text: '', style: style(15, 0xe8e2d0) })
  private hintBg = new Graphics()
  private hint = new Container()
  private flower = new Graphics()
  private lastPetals = -1
  private serenity: number = CONFIG.serenity.initial
  private toastText = new Text({ text: '', style: style(17, 0xf0ead8) })
  private toastBg = new Graphics()
  private toastC = new Container()
  private toasts: Toast[] = []

  constructor(private app: Application, private tex: GameTextures) {
    for (let i = 0; i < CONFIG.inv.hotbar; i++) {
      const cell = new Cell(tex)
      cell.c.position.set(i * (CELL + GAP), 0)
      this.hotCells.push(cell)
      this.hotbar.addChild(cell.c)
    }
    // 血心：灰底一排 + 遮罩填充一排
    for (let layer = 0; layer < 2; layer++) {
      const row = layer ? this.heartsFill : new Container()
      for (let i = 0; i < 10; i++) {
        const h = new Sprite(tex.heart)
        h.anchor.set(0, 1)
        const k = 20 / tex.heart.height
        h.scale.set(k)
        h.position.set(i * 22, 0)
        if (!layer) h.tint = 0x3a3f38
        row.addChild(h)
      }
      if (!layer) this.hearts.addChild(row)
    }
    this.hearts.addChild(this.heartsFill)
    this.heartsFill.mask = this.heartsMask
    this.hearts.addChild(this.heartsMask)
    // 背包面板
    const panel = new Graphics()
    const bw = 9 * (CELL + GAP) - GAP + 32
    const bh = 4 * (CELL + GAP) - GAP + 130
    panel.roundRect(0, 0, bw, bh, 14).fill({ color: 0x0c120c, alpha: 0.9 }).stroke({ color: 0x4a5244, width: 2 })
    this.bag.addChild(panel)
    const title = new Text({ text: '背包（E 关闭）', style: style(15, 0xd8d2c0) })
    title.position.set(16, 12)
    this.bag.addChild(title)
    for (let i = 0; i < CONFIG.inv.slots; i++) {
      const cell = new Cell(tex)
      const row = i < 9 ? 3 : Math.floor((i - 9) / 9) // 热键行画在最下
      const col = i < 9 ? i : (i - 9) % 9
      cell.c.position.set(16 + col * (CELL + GAP), 40 + row * (CELL + GAP) + (row === 3 ? 10 : 0))
      this.bagCells.push(cell)
      this.bag.addChild(cell.c)
    }
    CONFIG.recipes.forEach((r, i) => {
      const c = new Container()
      const bg = new Graphics()
      const costText = r.cost.map((x) => `${NAMES[x.kind]}×${x.count}`).join(' ')
      const label = new Text({ text: `合成 ${r.name}（${costText}）`, style: style(13, 0xe8e2d0) })
      bg.roundRect(0, 0, label.width + 24, 30, 8).fill({ color: 0x24301f, alpha: 0.95 }).stroke({ color: 0x4a5244, width: 1.5 })
      label.position.set(12, 7)
      c.addChild(bg, label)
      c.position.set(16, 40 + 4 * (CELL + GAP) + 22 + i * 38)
      this.recipeBtns.push({ c, bg, label })
      this.bag.addChild(c)
    })
    this.bag.visible = false
    this.heldSprite.anchor.set(0.5)
    this.heldCount.anchor.set(0, 0)
    this.hint.addChild(this.hintBg, this.hintText)
    this.hint.visible = false
    this.toastC.addChild(this.toastBg, this.toastText)
    this.toastC.visible = false
    this.nameFloat.anchor.set(0.5)
    this.container.addChild(this.flower, this.hearts, this.hotbar, this.nameFloat, this.hint, this.toastC, this.bag, this.heldSprite, this.heldCount)
  }

  toggleBag(): void {
    this.bagOpen = !this.bagOpen
    this.bag.visible = this.bagOpen
    if (!this.bagOpen) this.heldFrom = null
  }

  bump(): void { this.bumpT = 0 }

  sync(w: WorldState): void {
    if (w.selected !== this.selected && this.slots[w.selected] !== undefined) {
      const st = w.slots[w.selected]
      if (st) { this.nameFloat.text = NAMES[st.kind]; this.nameT = 0 }
    }
    this.slots = w.slots
    this.selected = w.selected
    this.hp = w.hp
    this.serenity = w.serenity
    this.afford = CONFIG.recipes.map((r) => canAfford(w.slots, r.cost))
  }

  /** UI 命中：热键栏/背包面板/配方按钮区域 */
  hitTest(x: number, y: number): boolean {
    if (this.hotbarBounds().contains(x, y)) return true
    if (this.bagOpen && this.bagBounds().contains(x, y)) return true
    return false
  }

  private hotbarBounds() { return this.hotbar.getBounds() }
  private bagBounds() { return this.bag.getBounds() }

  /** 点击路由：热键选格 / 背包格拿放 / 配方合成 */
  click(x: number, y: number): void {
    for (let i = 0; i < this.hotCells.length; i++) {
      if (this.hotCells[i]!.c.getBounds().contains(x, y)) {
        if (this.bagOpen) this.cellClick(i)
        return // 关背包态：热键点击仅由数字键/滚轮选择，不抢采集点击语义之外的空间
      }
    }
    if (!this.bagOpen) return
    for (let i = 0; i < this.bagCells.length; i++) {
      if (this.bagCells[i]!.c.getBounds().contains(x, y)) { this.cellClick(i); return }
    }
    this.recipeBtns.forEach((b, i) => {
      if (b.c.getBounds().contains(x, y) && this.afford[i]) this.onCraft?.(i)
    })
  }

  private cellClick(idx: number): void {
    if (this.heldFrom === null) {
      if (this.slots[idx]) this.heldFrom = idx
    } else {
      this.onMove?.(this.heldFrom, idx)
      this.heldFrom = null
    }
  }

  setHint(t: string | null): void {
    this.hint.visible = t !== null && !this.bagOpen
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
    const hotW = 9 * (CELL + GAP) - GAP
    this.bumpT = Math.min(1, this.bumpT + realDt * 4)
    const bump = 1 + 0.12 * (1 - this.bumpT)
    this.hotbar.scale.set(bump)
    this.hotbar.position.set(width / 2 - (hotW * bump) / 2, height - 16 - CELL * bump)
    for (let i = 0; i < this.hotCells.length; i++) this.hotCells[i]!.set(this.slots[i] ?? null, i === this.selected && !this.bagOpen)
    // 血心与遮罩（半心粒度）
    this.hearts.position.set(width / 2 - hotW / 2, height - 16 - CELL - 14)
    const frac = this.hp / CONFIG.hp.max
    this.heartsMask.clear().rect(0, -22, (10 * 22) * frac, 24).fill(0xffffff)
    // 蒲公英
    const petals = Math.ceil((this.serenity / CONFIG.serenity.max) * 12)
    if (petals !== this.lastPetals) {
      this.lastPetals = petals
      const k = this.serenity / CONFIG.serenity.max
      const mix = (a: number, b: number) => Math.round(a + (b - a) * (1 - k))
      const col = (mix(255, 154) << 16) | (mix(242, 163) << 8) | mix(200, 155)
      this.flower.clear()
      for (let i = 0; i < petals; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2
        this.flower.moveTo(Math.cos(a) * 8, Math.sin(a) * 8).lineTo(Math.cos(a) * 24, Math.sin(a) * 24)
          .stroke({ color: col, width: 2, alpha: 0.9 })
        this.flower.circle(Math.cos(a) * 24, Math.sin(a) * 24, 2).fill({ color: col, alpha: 0.9 })
      }
      this.flower.circle(0, 0, 6).fill(col)
    }
    this.flower.position.set(64, height - 64)
    this.flower.rotation = Math.sin(timeS * 0.8) * 0.05
    // 选中物品名浮签
    this.nameT += realDt
    this.nameFloat.visible = this.nameT < 1.2
    this.nameFloat.alpha = Math.max(0, 1 - this.nameT / 1.2)
    this.nameFloat.position.set(width / 2, height - 16 - CELL - 40)
    // 背包居中 + 手上叠随鼠标
    this.bag.position.set(width / 2 - this.bag.width / 2, height / 2 - this.bag.height / 2)
    this.recipeBtns.forEach((b, i) => { b.c.alpha = this.afford[i] ? 1 : 0.45 })
    const held = this.heldFrom !== null ? this.slots[this.heldFrom] : null
    this.heldSprite.visible = !!held
    this.heldCount.visible = !!held && held!.count > 1
    if (held) {
      const t = this.tex[held.kind]
      if (this.heldSprite.texture !== t) {
        this.heldSprite.texture = t
        this.heldSprite.scale.set((CELL - 14) / Math.max(t.width, t.height))
      }
      // 位置由 main 在 update 前通过 setHeldPos 设置
    }
    // 提示条与 toast（同上版逻辑）
    this.hint.position.set(width / 2, height - 130)
    const cur = this.toasts[0]
    if (cur) {
      cur.t += realDt
      const total = TOAST_IN + TOAST_HOLD + TOAST_OUT
      let a = 1
      if (cur.t < TOAST_IN) a = cur.t / TOAST_IN
      else if (cur.t > TOAST_IN + TOAST_HOLD) a = Math.max(0, 1 - (cur.t - TOAST_IN - TOAST_HOLD) / TOAST_OUT)
      if (this.toastText.text !== cur.text) {
        this.toastText.text = cur.text
        const w2 = this.toastText.width + 36
        const h2 = this.toastText.height + 16
        this.toastBg.clear().roundRect(-w2 / 2, -h2 / 2, w2, h2, 9).fill({ color: 0x0a0e0a, alpha: 0.66 })
        this.toastText.position.set(-this.toastText.width / 2, -this.toastText.height / 2)
      }
      this.toastC.visible = true
      this.toastC.alpha = a
      this.toastC.position.set(width / 2, 72)
      if (cur.t >= total) this.toasts.shift()
    } else this.toastC.visible = false
  }

  setHeldPos(x: number, y: number): void {
    this.heldSprite.position.set(x, y)
    this.heldCount.position.set(x + 10, y + 6)
    if (this.heldFrom !== null) {
      const held = this.slots[this.heldFrom]
      if (held) this.heldCount.text = String(held.count)
    }
  }
}
```
main ticker 内 `ui.update(...)` 前加 `ui.setHeldPos(kb.mouse.x, kb.mouse.y)`。

- [ ] **Step 2: 全量验证 + 冒烟**
Run: `npm run check && npx vitest run && npm run build` → 全绿
Run: preview + `node tools/smoke_probe.mjs http://127.0.0.1:4179/ <scratchpad>/items-smoke.png` → 热键栏 9 圆角格（0 号斧头图标亮选）、血心一排、无右下角计数、无 pageerror
- [ ] **Step 3: Commit** `git commit -m "feat(render,ui): 世界渲染重做（分档/尸体/掉落/种植/放置视觉）与热键栏/血心/背包面板"`

---

### Task 8: 音效扩展与收尾接线

**Files:** Modify: `src/audio/sfx.ts`

- [ ] **Step 1: 实现**（类内追加；main 已在 Task 6 调用）
```ts
  /** 拾取：短促上扬 blip */
  pickupPop(): void { this.ping(660, 0.09, 0.07); this.ping(990, 0.07, 0.05, 0.03) }

  /** 树倒：低频俯冲 + 落地闷响 */
  treeFall(): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(220, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.7)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.001, ctx.currentTime)
    g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.12)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    o.connect(g).connect(this.out)
    o.start(); o.stop(ctx.currentTime + 0.85)
    this.noiseBurst(160, 0.3, 0.18)
  }

  /** 矿碎：三连噪声脆响 */
  oreCrush(): void {
    this.noiseBurst(2400, 0.06, 0.12)
    this.noiseBurst(1400, 0.09, 0.12)
    this.noiseBurst(700, 0.14, 0.1)
  }

  /** 种植：低频软挖土 */
  plantDig(): void { this.noiseBurst(200, 0.12, 0.12); this.ping(520, 0.15, 0.04, 0.08) }

  /** 拒绝/满包：闷钝 */
  deny(): void { this.ping(140, 0.15, 0.08) }
```
- [ ] **Step 2: 全量绿 + Commit** `git commit -m "feat(audio): 拾取/树倒/矿碎/种植/拒绝音"`

---

### Task 9: 回归、E2E 重写与合并部署

**Files:** Modify: `tools/e2e_probe.mjs`（全量替换流程）、`.superpowers/sdd/progress.md`（本地台账）

- [ ] **Step 1: e2e 流程重写**（保持既有断言风格；新流程）
1. 出生态：slots[0]=axe、hp=100、nodes 9、drops 0
2. 走到树0（中档 12.5,13）→ 连砍 4 轮 → 断言 nodeBroken 后 nodes=8、drops≥4
3. 原地等 2s 拾取 → countOf wood ≥4
4. 注入 wood10/萤5 → `__whispers.sim.queueAction({type:'craft',recipe:0})` → 断言 lanternPost 入包
5. 找到 lanternPost 槽位 → 按对应 Digit 键 → 鼠标移到玩家旁 1.5m 的屏幕坐标 → 右键 → posts=1
6. 注入 sapling → 选中 → 右键种下 → plantings=1；把 plantedAt 拨回 90s → 等 0.5s → nodes+1
7. 注入 serenity 20 → lost=true；截图 4 张关键帧；0 pageerror
（世界→屏幕换算在 evaluate 内读 `scene` 不可得——用 `__whispers` 暴露的 sim 玩家位（屏幕中心恒定）推算：目标屏幕 = 画布中心 + (目标世界 - 玩家世界)×48。）
- [ ] **Step 2: 全量回归** `npm run test && npm run check && npm run build` + e2e PASS + 冒烟截图人审（热键栏/血心/放置白圈红影）
- [ ] **Step 3: 台账 + 终审**（/code-review 工作流全分支）→ 必修项修复 → 复验
- [ ] **Step 4: 合并部署** `git checkout main && git merge --no-ff feat/items-hotbar` → 回归 → push → Pages 工作流 → 线上探针
