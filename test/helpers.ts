import type { IntentInput, ItemStack, SimState } from '../src/sim/types'

export const DT = 1 / 30

/** 标准输入夹具：全空输入 + 局部覆写 */
export const I = (o: Partial<IntentInput> = {}): IntentInput =>
  ({ moveX: 0, moveY: 0, interact: false, place: false, aim: { x: 0, y: 0 }, selectSlot: -1, aimFacing: 0 as const, ...o })

/** 整包重铺槽位 */
export const withSlots = (s: SimState, fill: (i: number) => ItemStack | null): SimState =>
  ({ ...s, world: { ...s.world, slots: s.world.slots.map((_, i) => fill(i)) } })
