import { CONFIG } from '../config'

export type DayPhase = 'day' | 'dusk' | 'night'

export interface ClockInfo {
  phase: DayPhase
  phaseK: number    // 阶段内进度 0..1
  ambient01: number // 环境暗度:0=全亮白昼,1=全黑夜(黎明坡道/黄昏线性由此统一承载)
  dayLen: number    // 一整天秒数
}

export function clockInfo(clockS: number): ClockInfo {
  const C = CONFIG.clock
  const dayLen = C.dayS + C.duskS + C.nightS
  const t = ((clockS % dayLen) + dayLen) % dayLen
  if (t < C.dayS) {
    const ambient = t < C.dawnRampS ? 1 - t / C.dawnRampS : 0
    return { phase: 'day', phaseK: t / C.dayS, ambient01: ambient, dayLen }
  }
  if (t < C.dayS + C.duskS) {
    const k = (t - C.dayS) / C.duskS
    return { phase: 'dusk', phaseK: k, ambient01: k, dayLen }
  }
  return { phase: 'night', phaseK: (t - C.dayS - C.duskS) / C.nightS, ambient01: 1, dayLen }
}
