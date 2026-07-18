const DEG = Math.PI / 180

export const CONFIG = {
  pxPerMeter: 48,
  world: { width: 40, height: 40 }, // 米
  player: { speed: 4, radius: 0.35, heightM: 1.7, flipDebounce: 0.1, spawn: { x: 20, y: 20.8 } },
  gather: {
    duration: 1.2, windup: 0.3, swing: 0.15, hitAt: 0.45,
    backAngle: -8 * DEG, chopAngle: 15 * DEG,
    rangeM: 1.6,
    moveSpeedFactor: 0.6, // 边走边砍移速系数
  },
  anim: {
    breathAmp: 0.015, breathPeriod: 2.5,
    bobAmpPx: 5, strideM: 2, lean: 4 * DEG, stopRebound: 0.15,
  },
  light: {
    lanternRadiusM: 3.5, flickerAmp: 0.06, darkness: 0.94,
    campfireRadiusM: 6, postRadiusM: 5,
    oreGlow: { radiusM: 1.2, alpha: 0.35 }, treeGlow: { radiusM: 0.9, alpha: 0.25 },
  },
  serenity: {
    max: 100, initial: 100, lostBelow: 30, clearAt: 40,
    zoneRegen: 5, lanternDrain: -0.5, darkDrain: -3, stareDrain: -2, // 每秒
  },
  phantom: {
    speed: 0.6, stareRange: 8, stareExit: 9, dissolveRange: 6,
    fadeDur: 1.2, goneDur: 6, fadeInDur: 1, respawnMinDist: 12,
    ringMin: 10, ringMax: 18, spawn: { x: 32, y: 32 },
  },
  craft: { rangeM: 2.5, wood: 10, fluorite: 5, placeAheadM: 1.5, edgeMarginM: 1 },
  campfire: { x: 20, y: 19 },
  nodes: {
    treeCharges: 4, oreCharges: 5,
    trees: [
      { x: 12.5, y: 13 }, { x: 27, y: 11.5 }, { x: 31.5, y: 22 },
      { x: 9, y: 25.5 }, { x: 15.5, y: 31 }, { x: 25.5, y: 29.5 },
    ],
    ores: [{ x: 7.5, y: 16.5 }, { x: 33, y: 15.5 }, { x: 21.5, y: 34.5 }],
  },
  sizes: { treeH: 3.2, oreH: 1.1, campfireH: 1.3, postH: 2.2, phantomH: 1.8 }, // 米
  handmade: {
    paperSeed: 20260718, paperAlpha: 0.22,
    grainAlpha: 0.12, grainFrames: 4, grainFps: 9,
    lightEdgeNoise: 0.16, lightBoilFps: 6, lightVariants: 3,
    boilAmpPx: 2.2, boilFps: 8,
  },
  lost: { rampRate: 1.5, lowpassHz: 700, lowpassOpenHz: 18000, desatMax: 0.75, vignetteMax: 0.9 },
  colors: { night: 0x101612, ground: 0x1c2418 },
} as const
