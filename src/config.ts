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
  clock: { dayS: 240, duskS: 60, nightS: 180, startAtS: 30, dawnRampS: 12, duskRespawnS: 10 },
  fire: { torchBurnS: 90, torchMinM: 0.6, campfireBurnS: 120, campfireEmberM: 1.2, feedWood: 1, feedRangeM: 2 },
  light: {
    torchHeldM: 2.8, torchPlantedM: 2.2, campfireM: 5, postRadiusM: 5,
    flickerAmp: 0.06, darkness: 0.94, dayDarkness: 0.06,
  },
  serenity: {
    max: 100, initial: 100, lostBelow: 30, clearAt: 40,
    zoneRegen: 5, dayRegen: 1.5, darkDrain: -3, stareDrain: -2, // 每秒
  },
  phantom: {
    speed: 0.6, stareRange: 8, stareExit: 9, dissolveRange: 6,
    fadeDur: 1.2, goneDur: 6, fadeInDur: 1, respawnMinDist: 12,
    ringMin: 10, ringMax: 18, spawn: { x: 32, y: 32 },
  },
  landmark: { x: 20, y: 19 }, // 出生点古石(不发光不交互)
  inv: { slots: 36, hotbar: 9, stackMax: 99 },
  drops: { pickupRadiusM: 1.0, pickupDelayS: 0.5, scatterMin: 1.5, scatterMax: 3, dragPerS: 6, itemH: 0.45 },
  place: { rangeM: 3, spacingM: 0.8, edgeMarginM: 1 },
  growth: { durS: 90 },
  hp: { max: 100, fireRegen: 10 },
  saplingChance: 0.35,
  recipes: [
    { name: '提灯柱', out: 'lanternPost', outCount: 1, cost: [{ kind: 'wood', count: 10 }, { kind: 'fluorite', count: 5 }] },
    { name: '火把', out: 'torch', outCount: 2, cost: [{ kind: 'wood', count: 2 }] },
    { name: '篝火', out: 'campfire', outCount: 1, cost: [{ kind: 'wood', count: 8 }, { kind: 'fluorite', count: 2 }] },
  ],
  tiers: {
    tree: [
      { charges: 3, drop: 2, heightM: 2.4, saplingRolls: 1 },
      { charges: 4, drop: 4, heightM: 3.2, saplingRolls: 1 },
      { charges: 5, drop: 6, heightM: 4.2, saplingRolls: 2 },
    ],
    ore: [
      { charges: 3, drop: 2, heightM: 0.9 },
      { charges: 5, drop: 5, heightM: 1.4 },
    ],
  },
  corpse: { treeFallS: 0.8, treeFadeS: 1.5, oreCrushS: 0.5, oreFadeS: 1.2 },
  nodes: {
    trees: [
      { x: 12.5, y: 13, tier: 1 }, { x: 27, y: 11.5, tier: 0 }, { x: 31.5, y: 22, tier: 2 },
      { x: 9, y: 25.5, tier: 0 }, { x: 15.5, y: 31, tier: 1 }, { x: 25.5, y: 29.5, tier: 2 },
    ],
    ores: [{ x: 7.5, y: 16.5, tier: 0 }, { x: 33, y: 15.5, tier: 1 }, { x: 21.5, y: 34.5, tier: 0 }],
  },
  sizes: { campfireH: 1.3, postH: 2.2, phantomH: 1.8 }, // 米（树/矿高度见 tiers）
  handmade: {
    paperSeed: 20260718, paperAlpha: 0.22,
    grainAlpha: 0.12, grainFrames: 4, grainFps: 9,
    lightEdgeNoise: 0.16, lightBoilFps: 6, lightVariants: 3,
    boilAmpPx: 2.2, boilFps: 8,
  },
  lost: { rampRate: 1.5, lowpassHz: 700, lowpassOpenHz: 18000, desatMax: 0.75, vignetteMax: 0.9 },
  colors: { night: 0x101612, ground: 0x1c2418 },
} as const
