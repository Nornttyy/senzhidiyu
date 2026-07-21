import { CONFIG } from '../config'
import { nextRand } from './rand'
import { dist } from './vec'
import type { ResourceNode, Vec2, WorldState } from './types'

/** 世界坐标转区块坐标；Math.floor 让负坐标也能连续分区。 */
export function chunkAt(pos: Vec2): { x: number; y: number } {
  const size = CONFIG.world.chunkSizeM
  return { x: Math.floor(pos.x / size), y: Math.floor(pos.y / size) }
}

export const chunkKey = (x: number, y: number): string => `${x},${y}`

/** 出生地使用策划手摆的九个节点，不额外叠程序森林。 */
export function isStarterChunk(x: number, y: number): boolean {
  const W = CONFIG.world
  return x >= W.starterChunkMin && x <= W.starterChunkMax
    && y >= W.starterChunkMin && y <= W.starterChunkMax
}

/** 当前应常驻的区块键，顺序固定便于测试、回放与状态比较。 */
export function activeChunkKeys(pos: Vec2): string[] {
  const c = chunkAt(pos)
  const r = CONFIG.world.activeChunkRadius
  const keys: string[] = []
  for (let y = c.y - r; y <= c.y + r; y++) {
    for (let x = c.x - r; x <= c.x + r; x++) keys.push(chunkKey(x, y))
  }
  return keys
}

/** 把地图种子和有符号区块坐标混成稳定的 32 位种子。 */
function chunkSeed(mapSeed: number, x: number, y: number): number {
  let h = mapSeed | 0
  h = Math.imul(h ^ (x | 0), 0x45d9f3b)
  h = Math.imul(h ^ (y | 0), 0x27d4eb2d)
  h ^= h >>> 16
  return h | 0
}

function proceduralId(x: number, y: number, index: number): string {
  return `chunk:${x},${y}:${index}`
}

/** 单个区块的资源完全由 mapSeed+坐标决定；resourceState 只覆盖玩家改动。 */
export function generateChunk(
  mapSeed: number, x: number, y: number, resourceState: Readonly<Record<string, number>>,
): ResourceNode[] {
  if (isStarterChunk(x, y)) return []
  const G = CONFIG.generation
  const size = CONFIG.world.chunkSizeM
  const key = chunkKey(x, y)
  let seed = chunkSeed(mapSeed, x, y)
  const rand = (): number => { const r = nextRand(seed); seed = r.seed; return r.value }
  const treeCount = G.treeMin + Math.floor(rand() * (G.treeMax - G.treeMin + 1))
  const oreCount = (rand() < G.oreChance ? 1 : 0) + (rand() < G.secondOreChance ? 1 : 0)
  const specs: { kind: 'tree' | 'ore'; tier: number }[] = []
  for (let i = 0; i < treeCount; i++) {
    const r = rand()
    specs.push({ kind: 'tree', tier: r < 0.48 ? 0 : r < 0.82 ? 1 : 2 })
  }
  for (let i = 0; i < oreCount; i++) specs.push({ kind: 'ore', tier: rand() < 0.72 ? 0 : 1 })

  const nodes: ResourceNode[] = []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!
    let pos: Vec2 | null = null
    // 同区块内做有限次拒绝采样，避免树与矿叠成一团。
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = {
        x: x * size + G.paddingM + rand() * (size - G.paddingM * 2),
        y: y * size + G.paddingM + rand() * (size - G.paddingM * 2),
      }
      if (nodes.every((n) => dist(n.pos, candidate) >= G.nodeSpacingM)) { pos = candidate; break }
    }
    if (!pos) continue
    const id = proceduralId(x, y, i)
    const full = CONFIG.tiers[spec.kind][spec.tier]!.charges
    const saved = Object.prototype.hasOwnProperty.call(resourceState, id) ? resourceState[id]! : full
    if (saved > 0) nodes.push({ id, kind: spec.kind, tier: spec.tier, pos, charges: saved, chunk: key })
  }
  return nodes
}

/** 玩家跨区块时卸载远处程序节点，并生成新进入视野的区块。 */
export function syncResourceChunks(world: WorldState, playerPos: Vec2): WorldState {
  const wanted = activeChunkKeys(playerPos)
  if (wanted.length === world.loadedChunks.length
    && wanted.every((key, i) => key === world.loadedChunks[i])) return world

  const wantedSet = new Set(wanted)
  const previous = new Set(world.loadedChunks)
  const nodes = world.nodes.filter((n) => !n.chunk || wantedSet.has(n.chunk))
  for (const key of wanted) {
    if (previous.has(key)) continue
    const split = key.indexOf(',')
    const x = Number(key.slice(0, split))
    const y = Number(key.slice(split + 1))
    nodes.push(...generateChunk(world.mapSeed, x, y, world.resourceState))
  }
  return { ...world, nodes, loadedChunks: wanted }
}
