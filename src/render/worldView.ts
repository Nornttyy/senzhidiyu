import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import { lerp } from '../sim/vec'
import { canPlaceAt, selectedKind } from '../sim/world'
import { makeRadialTexture } from './lightLayer'
import { iconTex, type GameTextures } from './textures'
import type { NodeKind, SimState, Vec2 } from '../sim/types'

const px = CONFIG.pxPerMeter
const SHAKE_DUR = 0.3
const easeIn = (x: number) => x * x

interface Corpse { sp: Sprite; kind: NodeKind; t: number; dir: 1 | -1 }

function footSprite(tex: Texture, heightM: number): Sprite {
  const s = new Sprite(tex)
  s.anchor.set(0.5, 1)
  s.scale.set((heightM * px) / tex.height)
  return s
}

/** 世界实体渲染：分档节点/尸体动画/掉落物/种植体/篝火/幻影/放置圈与残影（每帧状态驱动，幂等） */
export class WorldView {
  private nodeSprites = new Map<number, Sprite>()
  private dropSprites = new Map<number, Sprite>()
  private plantSprites = new Map<number, Sprite>()
  private corpses: Corpse[] = []
  private postSprites: Sprite[] = []
  private flame: Sprite
  private phantom: Sprite
  private circle = new Graphics()
  private ghost = new Sprite()
  private shakes = new Map<number, number>()
  private glowTex = makeRadialTexture()

  constructor(private world: Container, overlay: Container, private tex: GameTextures, initial: SimState) {
    for (const n of initial.world.nodes) this.addNode(n.id, n.kind, n.tier, n.pos)
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

    // 放置视觉：白色虚线圈 + 鼠标残影
    this.circle.visible = false
    this.circle.zIndex = 1
    world.addChild(this.circle)
    this.ghost.anchor.set(0.5, 1)
    this.ghost.visible = false
    world.addChild(this.ghost)

    // 幻影：暗幕之上的屏幕层（自发光体不受暗幕遮蔽，远处黑暗中可见）
    this.phantom = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantom.blendMode = 'add'
    overlay.addChild(this.phantom)
  }

  private nodeTexH(kind: NodeKind, tier: number): { tex: Texture; h: number } {
    return kind === 'tree'
      ? { tex: this.tex.tree, h: CONFIG.tiers.tree[tier]!.heightM }
      : { tex: this.tex.ore, h: CONFIG.tiers.ore[tier]!.heightM }
  }

  private addNode(id: number, kind: NodeKind, tier: number, pos: Vec2): void {
    const { tex, h } = this.nodeTexH(kind, tier)
    const s = footSprite(tex, h)
    s.position.set(pos.x * px, pos.y * px)
    s.zIndex = pos.y * px
    this.nodeSprites.set(id, s)
    this.world.addChild(s)
  }

  /** nodeHit：受击摇晃 */
  shake(nodeId: number): void { this.shakes.set(nodeId, 0) }

  /** nodeBroken：节点精灵转尸体动画（树倒/矿碎）；倒向由位置哈希定，确定可复现 */
  breakNode(e: { nodeId: number; kind: NodeKind; pos: Vec2 }): void {
    const sp = this.nodeSprites.get(e.nodeId)
    if (!sp) return
    this.nodeSprites.delete(e.nodeId)
    this.shakes.delete(e.nodeId)
    this.corpses.push({ sp, kind: e.kind, t: 0, dir: Math.round(e.pos.x * 7 + e.pos.y * 3) % 2 ? 1 : -1 })
  }

  update(prev: SimState, cur: SimState, alphaV: number, timeS: number, realDt: number,
    view: { aimM: Vec2; showPlace: boolean }): void {
    const C = CONFIG.corpse
    // 节点：新生（grown）与受击摇晃
    for (const n of cur.world.nodes) {
      if (!this.nodeSprites.has(n.id)) this.addNode(n.id, n.kind, n.tier, n.pos)
      const s = this.nodeSprites.get(n.id)!
      let t = this.shakes.get(n.id)
      if (t !== undefined) {
        t += realDt
        if (t >= SHAKE_DUR) { this.shakes.delete(n.id); s.rotation = 0 }
        else { this.shakes.set(n.id, t); s.rotation = Math.sin(t * 40) * 0.07 * (1 - t / SHAKE_DUR) }
      }
    }
    // 尸体动画：树倒下再淡出，矿抖碎再淡出
    this.corpses = this.corpses.filter((c) => {
      c.t += realDt
      if (c.kind === 'tree') {
        const fall = Math.min(1, c.t / C.treeFallS)
        c.sp.rotation = c.dir * easeIn(fall) * 1.48
        c.sp.alpha = c.t <= C.treeFallS ? 1 : Math.max(0, 1 - (c.t - C.treeFallS) / C.treeFadeS)
        if (c.t >= C.treeFallS + C.treeFadeS) { c.sp.destroy(); return false }
      } else {
        const crush = Math.min(1, c.t / C.oreCrushS)
        c.sp.scale.y = c.sp.scale.x * (1 - 0.6 * crush)
        c.sp.position.x += Math.sin(c.t * 60) * (1 - crush) * 1.5
        c.sp.alpha = c.t <= C.oreCrushS ? 1 : Math.max(0, 1 - (c.t - C.oreCrushS) / C.oreFadeS)
        if (c.t >= C.oreCrushS + C.oreFadeS) { c.sp.destroy(); return false }
      }
      return true
    })
    // 掉落物：状态同步 + 落地起伏
    const seenD = new Set<number>()
    for (const d of cur.world.drops) {
      seenD.add(d.id)
      let s = this.dropSprites.get(d.id)
      if (!s) {
        s = footSprite(iconTex(this.tex, d.kind), CONFIG.drops.itemH)
        this.dropSprites.set(d.id, s)
        this.world.addChild(s)
      }
      const bob = Math.sin(timeS * 3 + d.id) * 2
      s.position.set(d.pos.x * px, d.pos.y * px + bob)
      s.zIndex = d.pos.y * px
    }
    for (const [id, s] of this.dropSprites) {
      if (!seenD.has(id)) { s.destroy(); this.dropSprites.delete(id) }
    }
    // 种植体：按生长进度 0.5→1.0 缩放
    const seenP = new Set<number>()
    for (const p of cur.world.plantings) {
      seenP.add(p.id)
      let s = this.plantSprites.get(p.id)
      if (!s) {
        s = footSprite(this.tex.sapling, 0.9)
        s.position.set(p.pos.x * px, p.pos.y * px)
        s.zIndex = p.pos.y * px
        this.plantSprites.set(p.id, s)
        this.world.addChild(s)
      }
      const k = Math.min(1, (cur.time - p.plantedAt) / CONFIG.growth.durS)
      const base = (0.9 * px) / this.tex.sapling.height
      s.scale.set(base * (0.5 + 0.5 * k))
    }
    for (const [id, s] of this.plantSprites) {
      if (!seenP.has(id)) { s.destroy(); this.plantSprites.delete(id) }
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
    // 放置视觉：白圈跟玩家、残影跟鼠标（圈外/非法转红）
    this.circle.visible = view.showPlace
    this.ghost.visible = view.showPlace
    if (view.showPlace) {
      const cx = lerp(prev.player.pos.x, cur.player.pos.x, alphaV) * px
      const cy = lerp(prev.player.pos.y, cur.player.pos.y, alphaV) * px
      const R = CONFIG.place.rangeM * px
      this.circle.clear()
      for (let i = 0; i < 24; i += 2) { // 虚线圆：24 段取偶
        const a0 = (i / 24) * Math.PI * 2
        const a1 = ((i + 1) / 24) * Math.PI * 2
        this.circle.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
          .arc(cx, cy, R, a0, a1)
          .stroke({ color: 0xffffff, width: 2, alpha: 0.55 })
      }
      const kind = selectedKind(cur.world)
      const tex = kind === 'sapling' ? this.tex.sapling : this.tex.post
      if (this.ghost.texture !== tex) {
        this.ghost.texture = tex
        this.ghost.scale.set(((kind === 'sapling' ? 0.9 : CONFIG.sizes.postH) * px) / tex.height)
      }
      const ok = canPlaceAt(cur.world, cur.player.pos, view.aimM)
      this.ghost.position.set(view.aimM.x * px, view.aimM.y * px)
      this.ghost.zIndex = view.aimM.y * px
      this.ghost.alpha = 0.55
      this.ghost.tint = ok ? 0xffffff : 0xff5050
    }
    // 幻影：世界坐标经 world 容器原点换算到屏幕层；跨重生不插值（瞬移）
    const pf = prev.world.phantom
    const cf = cur.world.phantom
    const same = pf.mode !== 'gone' && cf.mode !== 'gone'
    const xM = same ? lerp(pf.pos.x, cf.pos.x, alphaV) : cf.pos.x
    const yM = same ? lerp(pf.pos.y, cf.pos.y, alphaV) : cf.pos.y
    const a = same ? lerp(pf.alpha, cf.alpha, alphaV) : cf.alpha
    this.phantom.position.set(this.world.position.x + xM * px, this.world.position.y + yM * px)
    this.phantom.alpha = a * 0.85
    this.phantom.visible = a > 0.01
  }
}
