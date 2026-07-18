import { Container, Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import { previewPos } from '../sim/world'
import { makeRadialTexture } from './lightLayer'
import type { SimState } from '../sim/types'
import type { GameTextures } from './textures'

const px = CONFIG.pxPerMeter
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const SHAKE_DUR = 0.3

function footSprite(tex: Texture, heightM: number): Sprite {
  const s = new Sprite(tex)
  s.anchor.set(0.5, 1)
  s.scale.set((heightM * px) / tex.height)
  return s
}

/** 树/矿/篝火/提灯柱/幻影/放置预览的精灵同步（每帧由状态驱动，幂等） */
export class WorldView {
  private nodeSprites = new Map<number, Sprite>()
  private baseScaleY = new Map<number, number>()
  private postSprites: Sprite[] = []
  private flame: Sprite
  private phantom: Sprite
  private preview: Sprite
  private shakes = new Map<number, number>()
  private glowTex = makeRadialTexture()

  constructor(private world: Container, overlay: Container, private tex: GameTextures, initial: SimState) {
    for (const n of initial.world.nodes) {
      const s = footSprite(n.kind === 'tree' ? tex.tree : tex.ore, n.kind === 'tree' ? CONFIG.sizes.treeH : CONFIG.sizes.oreH)
      s.position.set(n.pos.x * px, n.pos.y * px)
      s.zIndex = n.pos.y * px
      this.nodeSprites.set(n.id, s)
      this.baseScaleY.set(n.id, s.scale.y)
      world.addChild(s)
    }
    const campfire = footSprite(tex.campfire, CONFIG.sizes.campfireH)
    campfire.position.set(CONFIG.campfire.x * px, CONFIG.campfire.y * px)
    campfire.zIndex = CONFIG.campfire.y * px
    world.addChild(campfire)

    // 木堆素材"未点燃"，程序火焰点燃它
    this.flame = new Sprite(this.glowTex)
    this.flame.anchor.set(0.5)
    this.flame.blendMode = 'add'
    this.flame.tint = 0xff9a40
    this.flame.position.set(CONFIG.campfire.x * px, (CONFIG.campfire.y - 0.55) * px)
    this.flame.zIndex = CONFIG.campfire.y * px + 1
    world.addChild(this.flame)

    this.preview = footSprite(tex.post, CONFIG.sizes.postH)
    this.preview.alpha = 0.45
    this.preview.visible = false
    world.addChild(this.preview)

    // 幻影：暗幕之上的屏幕层（自发光体不受暗幕遮蔽，远处黑暗中可见）
    this.phantom = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantom.blendMode = 'add' // 黑底发光素材
    overlay.addChild(this.phantom)
  }

  /** harvest 事件触发的受击摇晃 */
  shake(nodeId: number): void { this.shakes.set(nodeId, 0) }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, realDt: number): void {
    // 节点：耗尽降级 + 摇晃
    for (const n of cur.world.nodes) {
      const s = this.nodeSprites.get(n.id)
      if (!s) continue
      const base = this.baseScaleY.get(n.id)!
      const depleted = n.charges <= 0
      if (n.kind === 'tree') {
        s.scale.y = depleted ? base * 0.35 : base // 残桩剪影
        s.tint = depleted ? 0x4a4f42 : 0xffffff
      } else {
        s.tint = depleted ? 0x5a6672 : 0xffffff
      }
      let t = this.shakes.get(n.id)
      if (t !== undefined) {
        t += realDt
        if (t >= SHAKE_DUR) { this.shakes.delete(n.id); s.rotation = 0 }
        else { this.shakes.set(n.id, t); s.rotation = Math.sin(t * 40) * 0.07 * (1 - t / SHAKE_DUR) }
      }
    }
    // 提灯柱：按状态增量建精灵
    while (this.postSprites.length < cur.world.posts.length) {
      const p = cur.world.posts[this.postSprites.length]!
      const s = footSprite(this.tex.post, CONFIG.sizes.postH)
      s.position.set(p.x * px, p.y * px)
      s.zIndex = p.y * px
      const halo = new Sprite(this.glowTex)
      halo.anchor.set(0.5)
      halo.blendMode = 'add'
      halo.tint = 0xffd98a
      halo.alpha = 0.5
      halo.scale.set((1.2 * px * 2) / 512)
      halo.position.set(p.x * px, (p.y - CONFIG.sizes.postH * 0.82) * px)
      halo.zIndex = p.y * px + 1
      this.world.addChild(s, halo)
      this.postSprites.push(s)
    }
    // 篝火火焰呼吸
    const f = 1 + 0.18 * 0.5 * (Math.sin(timeS * 7.3) + Math.sin(timeS * 12.1))
    this.flame.scale.set((1.1 * px * 2 * f) / 512)
    this.flame.alpha = 0.6 + 0.1 * Math.sin(timeS * 9.1)
    // 放置预览
    this.preview.visible = cur.world.placing
    if (cur.world.placing) {
      const p = previewPos(cur.player)
      this.preview.position.set(p.x * px, p.y * px)
      this.preview.zIndex = p.y * px
      this.preview.alpha = 0.35 + 0.12 * Math.sin(timeS * 5)
    }
    // 幻影：世界坐标经 world 容器原点换算到屏幕层；跨重生不插值（瞬移）
    const pp = prev.world.phantom
    const cp = cur.world.phantom
    const sameLife = pp.mode !== 'gone' && cp.mode !== 'gone'
    const xM = sameLife ? lerp(pp.pos.x, cp.pos.x, alphaV) : cp.pos.x
    const yM = sameLife ? lerp(pp.pos.y, cp.pos.y, alphaV) : cp.pos.y
    const a = sameLife ? lerp(pp.alpha, cp.alpha, alphaV) : cp.alpha
    this.phantom.position.set(this.world.position.x + xM * px, this.world.position.y + yM * px)
    this.phantom.alpha = a * 0.85
    this.phantom.visible = a > 0.01
  }
}
