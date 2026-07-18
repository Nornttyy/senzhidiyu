import { CONFIG } from '../config'
import { addItem, canAfford, moveSlot, payCost, takeAt } from './inventory'
import { stepPhantom } from './phantom'
import { stepPlayer } from './player'
import { nextRand } from './rand'
import { clamp, dist } from './vec'
import type { DropEntity, IntentInput, ItemKind, ResourceNode, SimAction, SimEvent, SimState, Vec2, WorldState } from './types'

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

export const selectedKind = (w: WorldState): ItemKind | null => w.slots[w.selected]?.kind ?? null

const PLACEABLE = new Set<ItemKind>(['sapling', 'lanternPost'])

/** 放置校验：玩家白圈内（rangeM）、界内（edgeMargin）、与既有实体间距 ≥ spacingM */
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

/** 安宁值每秒变化率：档位互斥取最高，注视为叠加项 */
export function serenityRate(inZone: boolean, hasLantern: boolean, staring: boolean): number {
  const S = CONFIG.serenity
  const base = inZone ? S.zoneRegen : hasLantern ? S.lanternDrain : S.darkDrain
  return base + (staring ? S.stareDrain : 0)
}

/** 预留伤害入口（本切片无伤害源） */
export const applyDamage = (w: WorldState, n: number): WorldState =>
  ({ ...w, hp: clamp(w.hp - n, 0, CONFIG.hp.max) })

export function stepWorld(
  s: SimState, input: IntentInput, dt: number, actions: readonly SimAction[] = [],
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = []
  const prevPlayer = s.player
  let world = s.world
  let seed = world.seed

  // 选中热键格（先于玩家步进，挥砍门槛用最新选中）
  if (input.selectSlot >= 0 && input.selectSlot < CONFIG.inv.hotbar && input.selectSlot !== world.selected) {
    world = { ...world, selected: input.selectSlot }
  }

  // 非斧头不起手：连挥砍姿态/敲击反馈都不给，避免"看着在砍却没效果"的假反馈（终审#2）
  const axeHeld = selectedKind(world) === 'axe'
  const player = stepPlayer(prevPlayer, axeHeld ? input : { ...input, interact: false }, dt)

  // 挥砍命中：gatherT 跨越 hitAt 的 tick 结算，命中时刻需在交互半径内且手持斧头。
  // 双通道判定 gathering 布尔；无缝衔接回绕 tick（prev 1.19→cur 0.02）天然不满足跨越，无重复结算。
  // 挖完才掉：命中只扣 charges，归零破坏节点并散射掉落物（树苗按档概率 roll）。
  const crossedHit = prevPlayer.gathering && player.gathering
    && prevPlayer.gatherT + EPS < CONFIG.gather.hitAt && player.gatherT + EPS >= CONFIG.gather.hitAt
  if (crossedHit && selectedKind(world) === 'axe') {
    const idx = nearestNodeIdx(world.nodes, player.pos, CONFIG.gather.rangeM)
    if (idx >= 0) {
      const node = world.nodes[idx]!
      const charges = node.charges - 1
      if (charges > 0) {
        world = { ...world, nodes: world.nodes.map((n, i) => (i === idx ? { ...n, charges } : n)) }
        events.push({ type: 'nodeHit', nodeId: node.id, pos: node.pos })
      } else {
        const drops: DropEntity[] = [...world.drops]
        let nextId = world.nextId
        const spawn = (kind: ItemKind) => {
          const r1 = nextRand(seed)
          const r2 = nextRand(r1.seed)
          seed = r2.seed
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
            const r = nextRand(seed)
            seed = r.seed
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

  // 掉落物：减速滑行 + 界内夹紧 + 延迟拾取（满包滞留并节流提示）
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

  // 右键放置（树苗/提灯柱通用）
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

  // 种植生长：到时转化为小树（tier0）
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

  // 背包动作队列（UI 权威路径）：搬格/合成
  for (const a of actions) {
    if (a.type === 'move') {
      world = { ...world, slots: moveSlot(world.slots, a.from, a.to) }
    } else {
      const r = CONFIG.recipes[a.recipe]
      if (r && canAfford(world.slots, r.cost)) {
        const paid = payCost(world.slots, r.cost)
        const add = addItem(paid, r.out, r.outCount)
        if (add.leftover === 0) { // 产出无处安放则整体不执行
          world = { ...world, slots: add.slots }
          events.push({ type: 'crafted', recipe: a.recipe })
        } else if (s.time - world.invFullAt > 3) { // 静默失败会显得按钮坏了（终审#5）
          events.push({ type: 'invFull' })
          world = { ...world, invFullAt: s.time }
        }
      }
    }
  }

  // 血量：篝火圈内回复（本切片无伤害源，applyDamage 为预留入口）
  const inCampfire = dist(CONFIG.campfire, player.pos) <= CONFIG.light.campfireRadiusM
  if (inCampfire && world.hp < CONFIG.hp.max) {
    world = { ...world, hp: clamp(world.hp + CONFIG.hp.campfireRegen * dt, 0, CONFIG.hp.max) }
  }

  // 幻影
  const phr = stepPhantom(world.phantom, player.pos, seed, dt)
  seed = phr.seed
  world = { ...world, phantom: phr.phantom }
  if (phr.sigh) events.push({ type: 'phantomSigh', pos: phr.phantom.pos })

  // 安宁值结算与迷失滞回（本切片玩家恒带提灯，黑暗档为完备性保留）
  const inZone = dist(CONFIG.campfire, player.pos) <= CONFIG.light.campfireRadiusM
    || world.posts.some((p) => dist(p, player.pos) <= CONFIG.light.postRadiusM)
  // 注视掉率跟随 stare 模式本身的 8m 进/9m 出滞回，不再二次卡距离（终审#1：避免 8-9m 死区与边界拍抖）
  const staring = world.phantom.mode === 'stare'
  const serenity = clamp(world.serenity + serenityRate(inZone, true, staring) * dt, 0, CONFIG.serenity.max)
  let lost = world.lost
  if (!lost && serenity < CONFIG.serenity.lostBelow) { lost = true; events.push({ type: 'lostEnter' }) }
  else if (lost && serenity >= CONFIG.serenity.clearAt) { lost = false; events.push({ type: 'lostExit' }) }
  world = { ...world, serenity, lost, seed }

  return { state: { time: s.time + dt, player, world }, events }
}
