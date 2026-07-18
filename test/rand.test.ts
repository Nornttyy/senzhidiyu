import { describe, expect, it } from 'vitest'
import { nextRand } from '../src/sim/rand'

describe('nextRand', () => {
  it('同种子序列完全一致', () => {
    const seq = (seed: number, n: number) => {
      const out: number[] = []
      for (let i = 0; i < n; i++) { const r = nextRand(seed); out.push(r.value); seed = r.seed }
      return out
    }
    expect(seq(42, 10)).toEqual(seq(42, 10))
  })
  it('值域 [0,1) 且非常数', () => {
    let seed = 7
    const vals: number[] = []
    for (let i = 0; i < 100; i++) { const r = nextRand(seed); vals.push(r.value); seed = r.seed }
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(new Set(vals.map((v) => v.toFixed(6))).size).toBeGreaterThan(90)
  })
})
