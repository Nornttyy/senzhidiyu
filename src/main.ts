import { Application, Container, DisplacementFilter, Sprite, Texture } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { deriveHint } from './render/hints'
import { LightLayer, type LightSpec } from './render/lightLayer'
import { LostFx } from './render/lostFx'
import { Particles } from './render/particles'
import { UI } from './render/ui'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { WorldView } from './render/worldView'
import { Sfx } from './audio/sfx'
import { Handmade, makeDisplacementTexture } from './render/handmade'
import { Sim } from './sim/sim'
import { initialSim, type SimState } from './sim/types'
import { dist, lerp } from './sim/vec'

// 不用顶层 await：打包后 pixi 核心并入本入口 chunk，app.init() 动态
// import 的渲染器 chunk 又静态依赖入口——入口若停在顶层 await 上，
// 双方互等造成无异常的永久黑屏死锁（dev 不打包无此问题）。
async function main(): Promise<void> {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: CONFIG.colors.night,
    antialias: true,
    useBackBuffer: true, // 高级混合模式(overlay 等)需要回读缓冲
    // HiDPI 屏按物理像素渲染（上限 2 防 3x 屏过载），否则 1x 拉伸满屏锯齿
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  document.body.appendChild(app.canvas)

  const textures = await loadTextures(app.renderer)
  const sfx = new Sfx()
  const scene = new Scene(app)
  const particles = new Particles(scene.world)
  const sim = new Sim(initialSim(CONFIG.player.spawn.x, CONFIG.player.spawn.y))
  const kb = new Keyboard()
  kb.attach(window)
  kb.onFirstInput = () => sfx.unlock()
  const player = new PlayerView(textures.seeker)
  scene.world.addChild(player.sprite)

  const light = new LightLayer(app)
  app.stage.addChild(light.container)
  const overlay = new Container() // 暗幕之上：幻影等自发光体
  app.stage.addChild(overlay)
  const worldView = new WorldView(scene.world, overlay, textures, sim.state)
  const noink = new URLSearchParams(location.search).has('noink') // 手作质感层对比开关
  // 轮廓沸腾:噪声位移滤镜低帧步进,万物如逐帧手绘(与 lostFx 的滤镜组合共存)
  let boilFilters: DisplacementFilter[] = []
  let boilSprite: Sprite | null = null
  if (!noink) {
    boilSprite = new Sprite(makeDisplacementTexture())
    boilSprite.renderable = false
    app.stage.addChild(boilSprite)
    const disp = new DisplacementFilter({ sprite: boilSprite, scale: CONFIG.handmade.boilAmpPx })
    boilFilters = [disp]
    scene.world.filters = [disp]
  }
  const lostFx = new LostFx(app, scene.world, boilFilters)
  app.stage.addChild(lostFx.container)
  const handmade = noink ? null : new Handmade(app)
  if (handmade) app.stage.addChild(handmade.container)
  const ui = new UI(app)
  app.stage.addChild(ui.container)
  ui.toast('夜很深，跟随微光。')
  ui.toast('WASD 移动 · 左键 采集')
  document.addEventListener('visibilitychange', () => sfx.rearm())
  window.addEventListener('pointerdown', () => sfx.rearm())
  window.addEventListener('blur', () => sim.clearPendingEdges()) // 失焦丢弃陈旧输入边沿（与 Keyboard 的 blur 清理配套）
  // 无头探针的调试句柄（tools/e2e_probe.mjs 用于断言 sim 状态）；?debug 门控，不暴露给普通玩家会话
  if (new URLSearchParams(location.search).has('debug')) {
    ;(window as unknown as { __whispers?: { sim: Sim } }).__whispers = { sim }
  }

  const sinks = {
    footstep(xM: number, yM: number) { particles.dust(xM, yM); sfx.footstep() },
    gatherHit(xM: number, yM: number) { particles.spark(xM, yM); sfx.knock() },
  }
  let elapsed = 0
  let emberT = 0

  // 灯表：0 号为随身提灯（每帧就地更新）；静态部分仅在耗尽/放置事件后重建。
  // phase 为稳定呼吸相位种子，防止灯表增删时其余灯的呼吸跳变（终审#4）
  const playerLight: LightSpec = { xM: 0, yM: 0, radiusM: CONFIG.light.lanternRadiusM, phase: 0 }
  const allLights: LightSpec[] = [playerLight]
  let lightsDirty = true
  const staticLights = (st: SimState): LightSpec[] => [
    { xM: CONFIG.campfire.x, yM: CONFIG.campfire.y - 0.5, radiusM: CONFIG.light.campfireRadiusM, flicker: 1.8, phase: 1 },
    ...st.world.posts.map((p, i) => ({
      xM: p.x, yM: p.y - CONFIG.sizes.postH * 0.82, radiusM: CONFIG.light.postRadiusM, phase: 2 + i,
    })),
    ...st.world.nodes.filter((n) => n.charges > 0).map((n) => n.kind === 'ore'
      ? { xM: n.pos.x, yM: n.pos.y - 0.5, radiusM: CONFIG.light.oreGlow.radiusM, alpha: CONFIG.light.oreGlow.alpha, flicker: 0.5, phase: 10 + n.id }
      : { xM: n.pos.x, yM: n.pos.y - 1.6, radiusM: CONFIG.light.treeGlow.radiusM, alpha: CONFIG.light.treeGlow.alpha, flicker: 0.5, phase: 10 + n.id }),
  ]

  app.ticker.add((ticker) => {
    const realDt = Math.min(0.1, ticker.deltaMS / 1000)
    elapsed += realDt
    sim.advance(realDt, {
      ...kb.intent(),
      interact: kb.interactHeld() || kb.consumeInteract(), // held 连砍 + 边沿缓存点按
      craft: kb.consumeCraft(),
      aimFacing: kb.aimFacing(window.innerWidth), // 角色恒居屏幕中心,屏幕中线即角色位置
    })
    const alphaV = sim.alpha()
    const st = sim.state

    for (const e of sim.drainEvents()) {
      switch (e.type) {
        case 'harvest':
          worldView.shake(e.nodeId)
          if (e.depleted) lightsDirty = true // 微光熄灭
          if (e.kind === 'tree') { particles.firefly(e.pos.x, e.pos.y - 1.2); sfx.pickupWood() }
          else { particles.glint(e.pos.x, e.pos.y - 0.5); sfx.pickupOre() }
          break
        case 'phantomSigh': sfx.sigh(); break
        case 'crafted': sfx.chime(); ui.toast('合成完成——E 放下提灯柱'); break
        case 'postPlaced':
          sfx.placeThump()
          lightsDirty = true
          ui.toast(e.index === 0 ? '第一盏灯亮起，森林安静了些。' : '提灯柱已放置')
          break
        case 'lostEnter': sfx.setMuffled(true); break
        case 'lostExit': sfx.setMuffled(false); break
      }
    }

    player.update(sim.prev, st, alphaV, elapsed, sinks)
    particles.update(realDt)
    if (handmade) handmade.update(elapsed)
    if (boilSprite) {
      // 低帧步进移动位移采样窗,轮廓像逐帧重描
      const bf = Math.floor(elapsed * CONFIG.handmade.boilFps)
      boilSprite.position.set((bf * 13) % 128, (bf * 29) % 128)
    }
    // 相机与精灵使用同一插值位置，否则每个 sim tick 相机产生锯齿抖动
    const pp = sim.prev.player.pos
    const cp = st.player.pos
    const ipx = lerp(pp.x, cp.x, alphaV)
    const ipy = lerp(pp.y, cp.y, alphaV)
    scene.follow(ipx, ipy)
    worldView.update(sim.prev, st, alphaV, elapsed, realDt)

    if (lightsDirty) {
      allLights.length = 1
      allLights.push(...staticLights(st))
      lightsDirty = false
    }
    playerLight.xM = ipx
    playerLight.yM = ipy - CONFIG.player.heightM * 0.45
    light.update(allLights, scene.world.position, elapsed)

    // 篝火火星
    emberT -= realDt
    if (emberT <= 0) {
      emberT = 0.4 + Math.random() * 0.8
      particles.ember(CONFIG.campfire.x + (Math.random() - 0.5) * 0.6, CONFIG.campfire.y - 0.6)
    }
    // 幻影注视低鸣：距离越近越响；映射到 stareExit（9m）与模式滞回一致，8-9m 带内不静默
    const ph = st.world.phantom
    const dPh = dist(ph.pos, { x: ipx, y: ipy })
    const P = CONFIG.phantom
    sfx.humLevel(ph.mode === 'stare'
      ? 1 - Math.min(1, Math.max(0, (dPh - P.dissolveRange) / (P.stareExit - P.dissolveRange)))
      : 0)
    // HUD 与迷失表现
    ui.setCounts(st.world.inventory.wood, st.world.inventory.fluorite)
    ui.setSerenity(st.world.serenity)
    ui.setHint(deriveHint(st))
    ui.update(realDt, elapsed)
    lostFx.update(st.world.lost, realDt)
  })
}

main().catch((err) => {
  console.error('启动失败:', err)
})
