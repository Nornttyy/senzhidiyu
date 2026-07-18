import { CONFIG } from '../config'
import { stepPhantom } from './phantom'
import { stepPlayer } from './player'
import { clamp, dist } from './vec'
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

/** 安宁值每秒变化率：档位互斥取最高，注视为叠加项 */
export function serenityRate(inZone: boolean, hasLantern: boolean, staring: boolean): number {
  const S = CONFIG.serenity
  const base = inZone ? S.zoneRegen : hasLantern ? S.lanternDrain : S.darkDrain
  return base + (staring ? S.stareDrain : 0)
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

  // 幻影
  const phr = stepPhantom(world.phantom, player.pos, world.seed, dt)
  world = { ...world, phantom: phr.phantom, seed: phr.seed }
  if (phr.sigh) events.push({ type: 'phantomSigh', pos: phr.phantom.pos })

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

  return { state: { time: s.time + dt, player, world }, events }
}
