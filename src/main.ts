import { Application } from 'pixi.js'
import { CONFIG } from './config'
import { Keyboard } from './input/keyboard'
import { PlayerView } from './render/playerView'
import { Scene } from './render/scene'
import { loadTextures } from './render/textures'
import { Sim } from './sim/sim'
import { initialSim } from './sim/types'

const app = new Application()
await app.init({ resizeTo: window, background: CONFIG.colors.night, antialias: true })
document.body.appendChild(app.canvas)

const textures = await loadTextures(app.renderer)
const scene = new Scene(app)
const sim = new Sim(initialSim(CONFIG.world.width / 2, CONFIG.world.height / 2))
const kb = new Keyboard()
kb.attach(window)
const player = new PlayerView(textures.seeker)
scene.world.addChild(player.sprite)

const noSinks = { footstep() {}, gatherHit() {} } // Task 7 接粒子与音效
let elapsed = 0

app.ticker.add((ticker) => {
  const realDt = Math.min(0.1, ticker.deltaMS / 1000)
  elapsed += realDt
  sim.advance(realDt, { ...kb.intent(), interact: kb.consumeInteract() })
  player.update(sim.prev, sim.state, sim.alpha(), elapsed, noSinks)
  const p = sim.state.player.pos
  scene.follow(p.x, p.y)
})
