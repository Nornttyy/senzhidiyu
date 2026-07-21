import { Application, Container, DisplacementFilter, Sprite } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { deriveHint } from './render/hints'
import { LightLayer, type LightSpec } from './render/lightLayer'
import { clockInfo } from './sim/clock'
import { campfireLit, campfireRadius, torchRadius } from './sim/world'
import { LostFx } from './render/lostFx'
import { Particles } from './render/particles'
import { UI } from './render/ui'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { WorldView } from './render/worldView'
import { Sfx } from './audio/sfx'
import { Handmade, makeDisplacementTexture } from './render/handmade'
import { Menu } from './ui/menu'
import { Sim } from './sim/sim'
import { initialSim, type SimState, type Vec2 } from './sim/types'
import { selectedKind } from './sim/world'
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
  const player = new PlayerView(textures)
  scene.world.addChild(player.container)

  const light = new LightLayer(app)
  app.stage.addChild(light.container)
  const overlay = new Container() // 暗幕之上：幻影等自发光体
  app.stage.addChild(overlay)
  const worldView = new WorldView(scene.world, overlay, textures, sim.state)
  const noink = new URLSearchParams(location.search).has('noink') // 手作质感层对比开关
  // 轮廓沸腾:噪声位移滤镜低帧步进,万物如逐帧手绘(与 lostFx 的滤镜组合共存)
  const boilFilters: DisplacementFilter[] = []
  let boilSprite: Sprite | null = null
  let dispRef: DisplacementFilter | null = null
  if (!noink) {
    boilSprite = new Sprite(makeDisplacementTexture())
    boilSprite.renderable = false
    app.stage.addChild(boilSprite)
    dispRef = new DisplacementFilter({ sprite: boilSprite, scale: CONFIG.handmade.boilAmpPx })
    boilFilters.push(dispRef)
    scene.world.filters = [dispRef]
  }
  const lostFx = new LostFx(app, scene.world, boilFilters)
  app.stage.addChild(lostFx.container)
  const handmade = noink ? null : new Handmade(app)
  if (handmade) app.stage.addChild(handmade.container)
  const ui = new UI(app, textures)
  app.stage.addChild(ui.container)
  ui.onMove = (from, to) => sim.queueAction({ type: 'move', from, to })
  ui.onCraft = (recipe) => sim.queueAction({ type: 'craft', recipe })
  ui.container.visible = false // HUD 待开始游戏后再现
  const menu = new Menu({
    onStart() {
      sfx.unlock() // 开始按钮点击即用户手势,音频体面解锁
      ui.container.visible = true
      kb.clear(); sim.clearPendingEdges()
      ui.toast('美术更新：角色会自然握住斧头和火把。')
      ui.toast('夜很深，跟随微光。')
      ui.toast('WASD 移动 · 左键 采集 · E 背包')
    },
    onResume() { kb.clear(); sim.clearPendingEdges() },
    onBackToTitle() { location.reload() }, // 无存档,整页重载即回到开局
    onVolume(v) { sfx.setVolume(v) },
    onInk(on) {
      if (handmade) handmade.container.visible = on
      // 就地改共享数组:迷失滤镜组合(lostFx baseFilters)与直接赋值都以它为准
      boilFilters.length = 0
      if (on && dispRef) boilFilters.push(dispRef)
      scene.world.filters = boilFilters.length ? [...boilFilters] : (null as unknown as [])
    },
  })
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape') menu.togglePause() })
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

  // 灯表：0 号为随身光(手持火把时才有)；提灯柱静态部分事件后重建；
  // 火源(篝火/插地火把)半径随燃烧连续衰减,每帧重建。phase 稳定种子防呼吸跳变(终审#4)
  const playerLight: LightSpec = { xM: 0, yM: 0, radiusM: 0, phase: 0 }
  const allLights: LightSpec[] = [playerLight]
  let lightsDirty = true
  const staticLights = (st: SimState): LightSpec[] =>
    st.world.posts.map((p, i) => ({
      xM: p.x, yM: p.y - CONFIG.sizes.postH * 0.82, radiusM: CONFIG.light.postRadiusM, phase: 2 + i,
    }))
  const fireLights = (st: SimState): LightSpec[] => [
    ...st.world.campfires.map((c) => ({
      xM: c.pos.x, yM: c.pos.y - 0.5,
      radiusM: campfireRadius(c, st.time),
      flicker: campfireLit(c, st.time) ? 1.8 : 0.5,
      alpha: campfireLit(c, st.time) ? 1 : 0.55,
      phase: 30 + c.id,
    })),
    ...st.world.plantedTorches.map((t) => ({
      xM: t.pos.x, yM: t.pos.y - 0.6, radiusM: torchRadius(t, st.time), flicker: 1.3, phase: 60 + t.id,
    })),
  ]

  app.ticker.add((ticker) => {
    const realDt = Math.min(0.1, ticker.deltaMS / 1000)
    elapsed += realDt
    const paused = menu.isOpen || !menu.hasStarted

    // 输入路由：背包/菜单状态决定点击去向；UI 命中的点击不进 sim
    const aim: Vec2 = {
      x: (kb.mouse.x - scene.world.position.x) / CONFIG.pxPerMeter,
      y: (kb.mouse.y - scene.world.position.y) / CONFIG.pxPerMeter,
    }
    if (!paused) {
      if (kb.consumeBagToggle()) {
        ui.toggleBag()
        sim.clearPendingEdges() // 开合背包丢弃陈旧点击/排队动作
      }
      const clickL = kb.consumeInteract()
      const clickR = kb.consumePlace()
      // 仅背包开启时点击归 UI（设计§8）；热键栏悬停不吞挥砍（终审#1）
      if (clickL && ui.bagOpen) ui.click(kb.mouse.x, kb.mouse.y)
      const digit = kb.consumeSelect()
      const wheel = kb.consumeWheel()
      const selNow = sim.state.world.selected
      // 背包开启时不换热键格（终审#6），锁存仍被消费防积压
      const selectSlot = ui.bagOpen ? -1 : digit >= 0
        ? digit
        : wheel !== 0 ? (selNow + wheel + CONFIG.inv.hotbar) % CONFIG.inv.hotbar : -1
      sim.advance(realDt, {
        ...kb.intent(),
        interact: !ui.bagOpen && (kb.interactHeld() || clickL), // held 连砍 + 边沿缓存点按
        place: !ui.bagOpen && clickR,
        aim,
        selectSlot,
        aimFacing: kb.aimFacing(window.innerWidth), // 角色恒居屏幕中心,屏幕中线即角色位置
      })
    }
    const alphaV = sim.alpha()
    const st = sim.state

    for (const e of sim.drainEvents()) {
      switch (e.type) {
        case 'nodeHit': worldView.shake(e.nodeId); break
        case 'nodeBroken':
          worldView.breakNode(e)
          if (e.kind === 'tree') { particles.firefly(e.pos.x, e.pos.y - 1.2); sfx.treeFall() }
          else { particles.glint(e.pos.x, e.pos.y - 0.5); sfx.oreCrush() }
          break
        case 'pickup': particles.glint(e.pos.x, e.pos.y - 0.3); sfx.pickupPop(); ui.bump(); break
        case 'invFull': ui.toast('背包满了'); sfx.deny(); break
        case 'planted': sfx.plantDig(); break
        case 'crafted': sfx.chime(); ui.toast(`合成：${CONFIG.recipes[e.recipe]!.name}`); break
        case 'postPlaced':
          sfx.placeThump()
          lightsDirty = true
          ui.toast(e.index === 0 ? '第一盏灯亮起，森林安静了些。' : '提灯柱已放置')
          break
        case 'phantomSigh': sfx.sigh(); break
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
    const kind = selectedKind(st.world)
    worldView.update(sim.prev, st, alphaV, elapsed, realDt, {
      aimM: aim,
      showPlace: !paused && !ui.bagOpen && (kind === 'sapling' || kind === 'lanternPost'),
    })

    if (lightsDirty) {
      allLights.length = 1
      allLights.push(...staticLights(st))
      lightsDirty = false
    }
    // 火源灯每帧重建(半径连续衰减);挂在静态段之后
    const staticCount = 1 + staticLights(st).length
    allLights.length = staticCount
    allLights.push(...fireLights(st))
    playerLight.xM = ipx
    playerLight.yM = ipy - CONFIG.player.heightM * 0.45
    playerLight.radiusM = selectedKind(st.world) === 'torch' ? CONFIG.light.torchHeldM : 0
    // 昼夜暗幕插值
    const ci = clockInfo(st.world.clock)
    light.setDarkness(CONFIG.light.dayDarkness + (CONFIG.light.darkness - CONFIG.light.dayDarkness) * ci.ambient01)
    ui.setClock(ci.phase, (st.world.clock % ci.dayLen) / ci.dayLen)
    light.update(allLights, scene.world.position, elapsed)

    // 篝火火星(燃着的玩家篝火轮发)
    emberT -= realDt
    if (emberT <= 0) {
      emberT = 0.4 + Math.random() * 0.8
      const lit = st.world.campfires.filter((c) => campfireLit(c, st.time))
      if (lit.length) {
        const c = lit[Math.floor(Math.random() * lit.length)]!
        particles.ember(c.pos.x + (Math.random() - 0.5) * 0.6, c.pos.y - 0.6)
      }
    }
    // 幻影注视低鸣：距离越近越响；映射到 stareExit（9m）与模式滞回一致，8-9m 带内不静默
    const ph = st.world.phantom
    const dPh = dist(ph.pos, { x: ipx, y: ipy })
    const P = CONFIG.phantom
    sfx.humLevel(ph.mode === 'stare'
      ? 1 - Math.min(1, Math.max(0, (dPh - P.dissolveRange) / (P.stareExit - P.dissolveRange)))
      : 0)
    // HUD 与迷失表现
    ui.sync(st.world)
    ui.setHint(deriveHint(st))
    ui.setHeldPos(kb.mouse.x, kb.mouse.y)
    ui.update(realDt, elapsed)
    lostFx.update(st.world.lost, realDt)
  })
}

main().catch((err) => {
  console.error('启动失败:', err)
})
