import { Application, Container } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { LightLayer, type LightSpec } from './render/lightLayer'
import { Particles } from './render/particles'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { WorldView } from './render/worldView'
import { Sfx } from './audio/sfx'
import { Sim } from './sim/sim'
import { initialSim } from './sim/types'

// 不用顶层 await：打包后 pixi 核心并入本入口 chunk，app.init() 动态
// import 的渲染器 chunk 又静态依赖入口——入口若停在顶层 await 上，
// 双方互等造成无异常的永久黑屏死锁（dev 不打包无此问题）。
async function main(): Promise<void> {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: CONFIG.colors.night,
    antialias: true,
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

  const sinks = {
    footstep(xM: number, yM: number) { particles.dust(xM, yM); sfx.footstep() },
    gatherHit(xM: number, yM: number) { particles.spark(xM, yM); sfx.knock() },
  }
  let elapsed = 0

  app.ticker.add((ticker) => {
    const realDt = Math.min(0.1, ticker.deltaMS / 1000)
    elapsed += realDt
    sim.advance(realDt, { ...kb.intent(), interact: kb.consumeInteract(), craft: kb.consumeCraft() })
    const alphaV = sim.alpha()
    const st = sim.state

    for (const e of sim.drainEvents()) {
      if (e.type === 'harvest') worldView.shake(e.nodeId)
    }

    player.update(sim.prev, st, alphaV, elapsed, sinks)
    particles.update(realDt)
    // 相机与精灵使用同一插值位置，否则每个 sim tick 相机产生锯齿抖动
    const pp = sim.prev.player.pos
    const cp = st.player.pos
    const ipx = pp.x + (cp.x - pp.x) * alphaV
    const ipy = pp.y + (cp.y - pp.y) * alphaV
    scene.follow(ipx, ipy)
    worldView.update(sim.prev, st, alphaV, elapsed, realDt)

    const lights: LightSpec[] = [
      { xM: ipx, yM: ipy - CONFIG.player.heightM * 0.45, radiusM: CONFIG.light.lanternRadiusM },
      { xM: CONFIG.campfire.x, yM: CONFIG.campfire.y - 0.5, radiusM: CONFIG.light.campfireRadiusM, flicker: 1.8 },
      ...st.world.posts.map((p) => ({ xM: p.x, yM: p.y - 1.8, radiusM: CONFIG.light.postRadiusM })),
      ...st.world.nodes.filter((n) => n.charges > 0).map((n) => n.kind === 'ore'
        ? { xM: n.pos.x, yM: n.pos.y - 0.5, radiusM: CONFIG.light.oreGlow.radiusM, alpha: CONFIG.light.oreGlow.alpha, flicker: 0.5 }
        : { xM: n.pos.x, yM: n.pos.y - 1.6, radiusM: CONFIG.light.treeGlow.radiusM, alpha: CONFIG.light.treeGlow.alpha, flicker: 0.5 }),
    ]
    light.update(lights, scene.world.position, elapsed)
  })
}

main().catch((err) => {
  console.error('启动失败:', err)
})
