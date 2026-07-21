import { CONFIG } from '../config'
import { syncResourceChunks } from './chunks'
import { clockInfo } from './clock'
import { addItem, canAfford, moveSlot, payCost, takeAt } from './inventory'
import { stepPhantom } from './phantom'
import { stepPlayer } from './player'
import { nextRand } from './rand'
import { clamp, dist } from './vec'
import type { Campfire, DropEntity, IntentInput, ItemKind, PlantedTorch, ResourceNode, SimAction, SimEvent, SimState, Vec2, WorldState } from './types'

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

const PLACEABLE = new Set<ItemKind>(['sapling', 'lanternPost', 'torch', 'campfire'])

/** 放置校验：玩家白圈内（rangeM），并与既有实体保持间距；无限地图没有边界判定。 */
export function canPlaceAt(world: WorldState, playerPos: Vec2, aim: Vec2): boolean {
  const P = CONFIG.place
  if (dist(playerPos, aim) > P.rangeM) return false
  const others: Vec2[] = [
    CONFIG.landmark,
    ...world.nodes.map((n) => n.pos),
    ...world.posts,
    ...world.campfires.map((c) => c.pos),
    ...world.plantedTorches.map((t) => t.pos),
    ...world.plantings.map((p) => p.pos),
  ]
  return others.every((o) => dist(o, aim) >= P.spacingM)
}

/** 插地火把当前光圈半径:随燃烧余量线性缩小 */
export const torchRadius = (t: PlantedTorch, now: number): number => {
  const k = clamp(1 - (now - t.litAt) / CONFIG.fire.torchBurnS, 0, 1)
  return CONFIG.fire.torchMinM + (CONFIG.light.torchPlantedM - CONFIG.fire.torchMinM) * k
}

/** 篝火当前光圈半径:烧尽收缩至残烬(不消失,可添柴复燃) */
export const campfireRadius = (c: Campfire, now: number): number => {
  const k = clamp(1 - (now - c.fedAt) / CONFIG.fire.campfireBurnS, 0, 1)
  return CONFIG.fire.campfireEmberM + (CONFIG.light.campfireM - CONFIG.fire.campfireEmberM) * k
}

/** 篝火是否仍在燃烧(非残烬) */
export const campfireLit = (c: Campfire, now: number): boolean =>
  now - c.fedAt < CONFIG.fire.campfireBurnS

/** 安宁值每秒变化率(分相):白昼平回升;暮/夜按火圈与注视 */
export function serenityRate(phase: 'day' | 'dusk' | 'night', inFireZone: boolean, staring: boolean): number {
  const S = CONFIG.serenity
  if (phase === 'day') return S.dayRegen
  return (inFireZone ? S.zoneRegen : S.darkDrain) + (staring ? S.stareDrain : 0)
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

  // 昼夜时钟推进与相位事件
  const clock = world.clock + dt
  const ci = clockInfo(clock)
  if (ci.phase !== clockInfo(world.clock).phase) events.push({ type: 'phase', phase: ci.phase })
  world = { ...world, clock }

  // 选中热键格（先于玩家步进，挥砍门槛用最新选中）
  if (input.selectSlot >= 0 && input.selectSlot < CONFIG.inv.hotbar && input.selectSlot !== world.selected) {
    world = { ...world, selected: input.selectSlot }
  }

  // 非斧头不起手：连挥砍姿态/敲击反馈都不给，避免"看着在砍却没效果"的假反馈（终审#2）
  const axeHeld = selectedKind(world) === 'axe'
  const player = stepPlayer(prevPlayer, axeHeld ? input : { ...input, interact: false }, dt)
  world = syncResourceChunks(world, player.pos)

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
        const resourceState = typeof node.id === 'string'
          ? { ...world.resourceState, [node.id]: charges }
          : world.resourceState
        world = { ...world, resourceState, nodes: world.nodes.map((n, i) => (i === idx ? { ...n, charges } : n)) }
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
        const resourceState = typeof node.id === 'string'
          ? { ...world.resourceState, [node.id]: 0 }
          : world.resourceState
        world = { ...world, resourceState, nodes: world.nodes.filter((_, i) => i !== idx), drops, nextId }
        events.push({ type: 'nodeBroken', kind: node.kind, tier: node.tier, pos: node.pos, nodeId: node.id })
      }
    }
  }

  // 掉落物：减速滑行 + 延迟拾取（满包滞留并节流提示）
  if (world.drops.length) {
    const D = CONFIG.drops
    let slots = world.slots
    let invFullAt = world.invFullAt
    const remain: DropEntity[] = []
    for (const d of world.drops) {
      const k = Math.max(0, 1 - D.dragPerS * dt)
      const vel = { x: d.vel.x * k, y: d.vel.y * k }
      const pos = {
        x: d.pos.x + vel.x * dt,
        y: d.pos.y + vel.y * dt,
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

  // 右键:持木对篝火=添柴(优先);否则放置(树苗/提灯柱/火把/篝火通用)
  if (input.place) {
    const kind = selectedKind(world)
    const fedIdx = kind === 'wood'
      ? world.campfires.findIndex((c) => dist(c.pos, input.aim) <= CONFIG.fire.feedRangeM
          && dist(c.pos, player.pos) <= CONFIG.place.rangeM + CONFIG.fire.feedRangeM)
      : -1
    if (fedIdx >= 0) {
      const takenFeed = takeAt(world.slots, world.selected, CONFIG.fire.feedWood)
      if (takenFeed.taken === CONFIG.fire.feedWood) {
        const fedPos = world.campfires[fedIdx]!.pos
        world = {
          ...world, slots: takenFeed.slots,
          campfires: world.campfires.map((c, i) => (i === fedIdx ? { ...c, fedAt: s.time } : c)),
        }
        events.push({ type: 'campfireFed', pos: fedPos })
      }
    } else if (kind && PLACEABLE.has(kind) && canPlaceAt(world, player.pos, input.aim)) {
      const taken = takeAt(world.slots, world.selected, 1)
      if (taken.taken === 1) {
        if (kind === 'sapling') {
          const p = { id: world.nextId, pos: input.aim, plantedAt: s.time }
          world = { ...world, slots: taken.slots, plantings: [...world.plantings, p], nextId: world.nextId + 1 }
          events.push({ type: 'planted', pos: input.aim })
        } else if (kind === 'torch') {
          const t = { id: world.nextId, pos: input.aim, litAt: s.time }
          world = { ...world, slots: taken.slots, plantedTorches: [...world.plantedTorches, t], nextId: world.nextId + 1 }
          events.push({ type: 'torchPlanted', pos: input.aim })
        } else if (kind === 'campfire') {
          const c = { id: world.nextId, pos: input.aim, fedAt: s.time }
          world = { ...world, slots: taken.slots, campfires: [...world.campfires, c], nextId: world.nextId + 1 }
          events.push({ type: 'campfirePlaced', pos: input.aim })
        } else {
          const posts = [...world.posts, input.aim]
          world = { ...world, slots: taken.slots, posts }
          events.push({ type: 'postPlaced', pos: input.aim, index: posts.length - 1 })
        }
      }
    }
  }

  // 火源生命周期:插地火把燃尽消失;篝火烧尽瞬间发残烬事件(实体保留)
  const burnt = world.plantedTorches.filter((t) => s.time - t.litAt >= CONFIG.fire.torchBurnS)
  if (burnt.length) {
    for (const t of burnt) events.push({ type: 'torchBurnt', pos: t.pos })
    world = { ...world, plantedTorches: world.plantedTorches.filter((t) => !burnt.includes(t)) }
  }
  for (const c of world.campfires) {
    const prevLit = s.time - dt - c.fedAt < CONFIG.fire.campfireBurnS
    if (prevLit && !campfireLit(c, s.time)) events.push({ type: 'campfireEmber', pos: c.pos })
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

  // 血量：燃着的篝火圈内回复（残烬不回）
  const nearLitFire = world.campfires.some((c) => campfireLit(c, s.time)
    && dist(c.pos, player.pos) <= campfireRadius(c, s.time))
  if (nearLitFire && world.hp < CONFIG.hp.max) {
    world = { ...world, hp: clamp(world.hp + CONFIG.hp.fireRegen * dt, 0, CONFIG.hp.max) }
  }

  // 幻影(昼退暮归:黄昏最后 duskRespawnS 秒起允许活动)
  const allowActive = ci.phase === 'night'
    || (ci.phase === 'dusk' && ci.phaseK >= 1 - CONFIG.clock.duskRespawnS / CONFIG.clock.duskS)
  const phr = stepPhantom(world.phantom, player.pos, seed, dt, allowActive)
  seed = phr.seed
  world = { ...world, phantom: phr.phantom }
  if (phr.sigh) events.push({ type: 'phantomSigh', pos: phr.phantom.pos })

  // 安宁值分相结算:白昼平回升;暮/夜看火圈(持炬/插炬/篝火/提灯柱)与注视
  const heldTorch = selectedKind(world) === 'torch'
  const inFireZone = heldTorch
    || world.posts.some((p) => dist(p, player.pos) <= CONFIG.light.postRadiusM)
    || world.campfires.some((c) => dist(c.pos, player.pos) <= campfireRadius(c, s.time))
    || world.plantedTorches.some((t) => dist(t.pos, player.pos) <= torchRadius(t, s.time))
  // 注视掉率跟随 stare 模式本身滞回（终审#1）
  const staring = world.phantom.mode === 'stare'
  const serenity = clamp(world.serenity + serenityRate(ci.phase, inFireZone, staring) * dt, 0, CONFIG.serenity.max)
  let lost = world.lost
  if (!lost && serenity < CONFIG.serenity.lostBelow) { lost = true; events.push({ type: 'lostEnter' }) }
  else if (lost && serenity >= CONFIG.serenity.clearAt) { lost = false; events.push({ type: 'lostExit' }) }
  world = { ...world, serenity, lost, seed }

  return { state: { time: s.time + dt, player, world }, events }
}
