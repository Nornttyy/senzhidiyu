import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { addItem, canAfford, countOf, moveSlot, payCost, takeAt } from '../src/sim/inventory'
import type { ItemStack } from '../src/sim/types'

const empty = (): (ItemStack | null)[] => Array(CONFIG.inv.slots).fill(null)

describe('addItem', () => {
  it('先叠同类再占空格，返回余量', () => {
    const s = empty()
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
    const s = empty()
    s[0] = { kind: 'axe', count: 1 }
    const r = addItem(s, 'axe', 1)
    expect(r.slots[1]).toEqual({ kind: 'axe', count: 1 })
  })
})

describe('takeAt / cost', () => {
  it('takeAt 扣减并在归零时清格', () => {
    const s = empty()
    s[2] = { kind: 'sapling', count: 2 }
    let r = takeAt(s, 2, 1)
    expect(r.slots[2]).toEqual({ kind: 'sapling', count: 1 })
    r = takeAt(r.slots, 2, 1)
    expect(r.slots[2]).toBeNull()
    expect(takeAt(r.slots, 2, 1).taken).toBe(0)
  })
  it('canAfford/payCost 跨格聚合', () => {
    const s = empty()
    s[0] = { kind: 'wood', count: 6 }
    s[9] = { kind: 'wood', count: 4 }
    s[1] = { kind: 'fluorite', count: 5 }
    const cost = CONFIG.recipes[0]!.cost
    expect(canAfford(s, cost)).toBe(true)
    const paid = payCost(s, cost)
    expect(countOf(paid, 'wood')).toBe(0)
    expect(countOf(paid, 'fluorite')).toBe(0)
    expect(canAfford(empty(), cost)).toBe(false)
  })
})

describe('moveSlot', () => {
  it('越界下标不动槽组（防负一删物）', () => {
    const s = empty()
    s[3] = { kind: 'wood', count: 5 }
    expect(moveSlot(s, -1, 3)[3]).toEqual({ kind: 'wood', count: 5 })
    expect(moveSlot(s, 3, 99)[3]).toEqual({ kind: 'wood', count: 5 })
    expect(moveSlot(s, 99, 3)[3]).toEqual({ kind: 'wood', count: 5 })
  })
  it('同类合并到上限，异类交换', () => {
    let s = empty()
    s[0] = { kind: 'wood', count: 60 }
    s[1] = { kind: 'wood', count: 60 }
    let r = moveSlot(s, 0, 1)
    expect(r[1]).toEqual({ kind: 'wood', count: 99 })
    expect(r[0]).toEqual({ kind: 'wood', count: 21 })
    s = empty()
    s[0] = { kind: 'axe', count: 1 }
    s[1] = { kind: 'wood', count: 3 }
    r = moveSlot(s, 0, 1)
    expect(r[0]).toEqual({ kind: 'wood', count: 3 })
    expect(r[1]).toEqual({ kind: 'axe', count: 1 })
  })
})
