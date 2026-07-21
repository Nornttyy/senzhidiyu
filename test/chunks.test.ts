import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { activeChunkKeys, chunkAt, generateChunk, syncResourceChunks } from '../src/sim/chunks'
import { initialSim } from '../src/sim/types'

describe('无限区块地图', () => {
  it('负坐标使用正确区块，活动区数量恒定', () => {
    expect(chunkAt({ x: -0.1, y: -16.1 })).toEqual({ x: -1, y: -2 })
    expect(activeChunkKeys({ x: -0.1, y: -16.1 })).toHaveLength((CONFIG.world.activeChunkRadius * 2 + 1) ** 2)
  })

  it('同种子同坐标生成完全一致，不同种子不同', () => {
    const a = generateChunk(123, -8, 5, {})
    const b = generateChunk(123, -8, 5, {})
    const c = generateChunk(124, -8, 5, {})
    expect(a).toEqual(b)
    expect(c).not.toEqual(a)
    expect(new Set(a.map((n) => n.id)).size).toBe(a.length)
  })

  it('远行时旧区块卸载，活动节点数量保持有上限', () => {
    let world = initialSim(20, 20.8, 77).world
    for (let i = 1; i <= 30; i++) world = syncResourceChunks(world, { x: i * 73, y: -i * 41 })
    expect(world.loadedChunks).toHaveLength((CONFIG.world.activeChunkRadius * 2 + 1) ** 2)
    expect(world.nodes.length).toBeLessThan(150)
    expect(world.nodes.filter((n) => typeof n.id === 'number')).toHaveLength(9)
  })

  it('受损程序资源离开后再回来，剩余次数不会恢复', () => {
    let world = initialSim(-100, -100, 88).world
    const node = world.nodes.find((n) => typeof n.id === 'string')!
    const saved = node.charges - 1
    world = {
      ...world,
      nodes: world.nodes.map((n) => n.id === node.id ? { ...n, charges: saved } : n),
      resourceState: { ...world.resourceState, [node.id]: saved },
    }
    world = syncResourceChunks(world, { x: 900, y: 900 })
    expect(world.nodes.some((n) => n.id === node.id)).toBe(false)
    world = syncResourceChunks(world, node.pos)
    expect(world.nodes.find((n) => n.id === node.id)?.charges).toBe(saved)
  })
})
