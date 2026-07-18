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

export const canAfford = (slots: Slots, cost: Cost): boolean =>
  cost.every((c) => countOf(slots, c.kind) >= c.count)

/** 跨格扣费（假定 canAfford 已通过） */
export function payCost(slots: Slots, cost: Cost): (ItemStack | null)[] {
  let out: (ItemStack | null)[] = [...slots]
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

/** 同类可叠则灌注到上限，否则交换；越界下标不动槽组（防 out[-1] 隐性删物） */
export function moveSlot(slots: Slots, from: number, to: number): (ItemStack | null)[] {
  const out = [...slots]
  if (from === to) return out
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out
  const a = out[from] ?? null
  const b = out[to] ?? null
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
