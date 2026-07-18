/** mulberry32 的纯函数形态：种子显式串行传递，测试与回放可复现 */
export function nextRand(seed: number): { value: number; seed: number } {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: s }
}
