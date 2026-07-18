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
