import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { CONFIG } from '../config'
import { lerp } from '../sim/vec'
import { canPlaceAt, selectedKind } from '../sim/world'
import { makeRadialTexture } from './lightLayer'
import { iconTex, type GameTextures } from './textures'
import type { NodeKind, ResourceNode, SimState, Vec2 } from '../sim/types'

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
  private nodeSprites = new Map<ResourceNode['id'], Sprite>()
  private dropSprites = new Map<number, Sprite>()
  private plantSprites = new Map<number, Sprite>()
  private campfireSprites = new Map<number, { body: Sprite; flame: Sprite }>()
  private torchSprites = new Map<number, { body: Sprite; flame: Sprite }>()
  private corpses: Corpse[] = []
  private postSprites: { body: Sprite; halo: Sprite; phase: number }[] = []
  private phantom: Sprite
  private phantomEcho: Sprite
  private phantomBaseScale: number
  private circle = new Graphics()
  private ghost = new Sprite()
  private shakes = new Map<ResourceNode['id'], number>()
  private glowTex = makeRadialTexture()

  constructor(private world: Container, overlay: Container, private tex: GameTextures, initial: SimState) {
    for (const n of initial.world.nodes) this.addNode(n.id, n.kind, n.tier, n.pos)
    // 出生点古石地标（不发光不交互，纯寻路锚点）
    const stone = footSprite(tex.stone, CONFIG.sizes.stoneH)
    stone.position.set(CONFIG.landmark.x * px, CONFIG.landmark.y * px)
    stone.zIndex = CONFIG.landmark.y * px
    world.addChild(stone)

    // 放置视觉：白色虚线圈（几何恒定，预铺一次，每帧只挪位置——终审#9）+ 鼠标残影
    const R = CONFIG.place.rangeM * px
    for (let i = 0; i < 24; i += 2) {
      const a0 = (i / 24) * Math.PI * 2
      const a1 = ((i + 1) / 24) * Math.PI * 2
      this.circle.moveTo(Math.cos(a0) * R, Math.sin(a0) * R)
        .arc(0, 0, R, a0, a1)
        .stroke({ color: 0xffffff, width: 2, alpha: 0.55 })
    }
    this.circle.visible = false
    this.circle.zIndex = 1
    world.addChild(this.circle)
    this.ghost.anchor.set(0.5, 1)
    this.ghost.visible = false
    world.addChild(this.ghost)

    // 幻影：暗幕之上的屏幕层（自发光体不受暗幕遮蔽，远处黑暗中可见）。
    // 黑底素材加法混合下中灰身躯加光量低——本体双重加法提亮成"可见的雾鬼"；
    // 不带光晕/光圈（用户裁定：幻影不是光源，不该照亮周围）
    this.phantom = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantomBaseScale = this.phantom.scale.x
    this.phantom.blendMode = 'add'
    this.phantom.tint = 0xfff4df
    overlay.addChild(this.phantom)
    this.phantomEcho = footSprite(tex.phantom, CONFIG.sizes.phantomH)
    this.phantomEcho.blendMode = 'add'
    this.phantomEcho.tint = 0xa8c6d8
    overlay.addChild(this.phantomEcho)
  }

  private nodeTexH(kind: NodeKind, tier: number): { tex: Texture; h: number } {
    return kind === 'tree'
      ? { tex: this.tex.tree, h: CONFIG.tiers.tree[tier]!.heightM }
      : { tex: this.tex.ore, h: CONFIG.tiers.ore[tier]!.heightM }
  }

  private addNode(id: ResourceNode['id'], kind: NodeKind, tier: number, pos: Vec2): void {
    const { tex, h } = this.nodeTexH(kind, tier)
    const s = footSprite(tex, h)
    s.position.set(pos.x * px, pos.y * px)
    s.zIndex = pos.y * px
    this.nodeSprites.set(id, s)
    this.world.addChild(s)
  }

  /** nodeHit：受击摇晃 */
  shake(nodeId: ResourceNode['id']): void { this.shakes.set(nodeId, 0) }

  /** nodeBroken：节点精灵转尸体动画（树倒/矿碎）；倒向由位置哈希定，确定可复现 */
  breakNode(e: { nodeId: ResourceNode['id']; kind: NodeKind; pos: Vec2 }): void {
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
    const seenN = new Set<ResourceNode['id']>()
    for (const n of cur.world.nodes) {
      seenN.add(n.id)
      if (!this.nodeSprites.has(n.id)) this.addNode(n.id, n.kind, n.tier, n.pos)
      const s = this.nodeSprites.get(n.id)!
      let t = this.shakes.get(n.id)
      if (t !== undefined) {
        t += realDt
        if (t >= SHAKE_DUR) this.shakes.delete(n.id)
        else { this.shakes.set(n.id, t); s.rotation = Math.sin(t * 40) * 0.07 * (1 - t / SHAKE_DUR) }
      } else s.rotation = Math.sin(timeS * 0.55 + n.pos.x * 0.37 + n.pos.y * 0.53) * 0.006
    }
    // 离开活动区块的程序资源会从 sim 卸载；对应精灵也及时销毁。
    for (const [id, s] of this.nodeSprites) {
      if (!seenN.has(id)) { s.destroy(); this.nodeSprites.delete(id); this.shakes.delete(id) }
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
      s.rotation = Math.sin(timeS * 2.2 + d.id * 0.9) * 0.07
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
      this.postSprites.push({ body: s, halo, phase: this.postSprites.length * 1.73 })
    }
    // 提灯柱的暖光轻轻呼吸；木柱保持稳固，不让整根柱子像橡皮一样摆动。
    for (const p of this.postSprites) {
      const breath = 1 + Math.sin(timeS * 2.4 + p.phase) * 0.06
      p.halo.alpha = 0.46 + Math.sin(timeS * 2.1 + p.phase) * 0.08
      p.halo.scale.set((1.2 * px * 2 * breath) / 512)
    }
    // 火源池同步:篝火(玩家搭建,火焰随余量;残烬=熄焰红点) / 插地火把
    const now = cur.time
    const liveC = new Set(cur.world.campfires.map((c) => c.id))
    for (const [id, sp] of this.campfireSprites) {
      if (!liveC.has(id)) { sp.body.destroy(); sp.flame.destroy(); this.campfireSprites.delete(id) }
    }
    for (const c of cur.world.campfires) {
      let sp = this.campfireSprites.get(c.id)
      if (!sp) {
        const body = footSprite(this.tex.campfire, CONFIG.sizes.campfireH)
        body.position.set(c.pos.x * px, c.pos.y * px)
        body.zIndex = c.pos.y * px
        const flame = new Sprite(this.glowTex)
        flame.anchor.set(0.5)
        flame.blendMode = 'add'
        flame.position.set(c.pos.x * px, (c.pos.y - 0.55) * px)
        flame.zIndex = c.pos.y * px + 1
        this.world.addChild(body, flame)
        sp = { body, flame }
        this.campfireSprites.set(c.id, sp)
      }
      const k = Math.max(0, 1 - (now - c.fedAt) / CONFIG.fire.campfireBurnS)
      const breath = 1 + 0.18 * 0.5 * (Math.sin(timeS * 7.3 + c.id) + Math.sin(timeS * 12.1 + c.id * 2))
      if (k > 0) {
        sp.flame.tint = 0xff9a40
        sp.flame.scale.set(((0.5 + 0.6 * k) * px * 2 * breath) / 512)
        sp.flame.alpha = 0.35 + 0.35 * k + 0.1 * Math.sin(timeS * 9.1 + c.id)
      } else {
        sp.flame.tint = 0xff5a30 // 残烬:一点暗红
        sp.flame.scale.set((0.35 * px * 2) / 512)
        sp.flame.alpha = 0.22 + 0.06 * Math.sin(timeS * 3.1 + c.id)
      }
    }
    const liveT = new Set(cur.world.plantedTorches.map((t) => t.id))
    for (const [id, sp] of this.torchSprites) {
      if (!liveT.has(id)) { sp.body.destroy(); sp.flame.destroy(); this.torchSprites.delete(id) }
    }
    for (const t of cur.world.plantedTorches) {
      let sp = this.torchSprites.get(t.id)
      if (!sp) {
        const body = footSprite(this.tex.torch, CONFIG.sizes.torchH)
        body.position.set(t.pos.x * px, t.pos.y * px)
        body.zIndex = t.pos.y * px
        const flame = new Sprite(this.glowTex)
        flame.anchor.set(0.5)
        flame.blendMode = 'add'
        flame.tint = 0xffb050
        flame.position.set(t.pos.x * px, (t.pos.y - CONFIG.sizes.torchH * 0.91) * px)
        flame.zIndex = t.pos.y * px + 1
        this.world.addChild(body, flame)
        sp = { body, flame }
        this.torchSprites.set(t.id, sp)
      }
      const k = Math.max(0, 1 - (now - t.litAt) / CONFIG.fire.torchBurnS)
      const breath = 1 + 0.2 * Math.sin(timeS * 11 + t.id * 1.7)
      sp.body.rotation = Math.sin(timeS * 2.1 + t.id) * 0.01
      sp.flame.scale.set(((0.16 + 0.2 * k) * px * 2 * breath) / 512)
      sp.flame.alpha = 0.4 + 0.4 * k
    }
    // 放置视觉：白圈跟玩家、残影跟鼠标（圈外/非法转红）
    this.circle.visible = view.showPlace
    this.ghost.visible = view.showPlace
    if (view.showPlace) {
      this.circle.position.set(
        lerp(prev.player.pos.x, cur.player.pos.x, alphaV) * px,
        lerp(prev.player.pos.y, cur.player.pos.y, alphaV) * px,
      )
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
    const sx = this.world.position.x + xM * px
    const sy = this.world.position.y + yM * px
    const visible = a > 0.01
    // 雾鬼没有脚步：本体缓慢上浮、侧摆，蓝灰残影稍慢半拍，像水彩在纸上晕开。
    const driftX = Math.sin(timeS * 0.83) * 5
    const floatY = Math.sin(timeS * 1.37 + 0.8) * 7
    const pulse = 0.92 + Math.sin(timeS * 2.05) * 0.08
    this.phantom.position.set(sx + driftX, sy + floatY)
    this.phantom.rotation = Math.sin(timeS * 0.71) * 0.025
    this.phantom.scale.set(this.phantomBaseScale * (1 + Math.sin(timeS * 1.17) * 0.025))
    this.phantom.alpha = a * 0.82 * pulse
    this.phantom.visible = visible
    this.phantomEcho.position.set(sx - driftX * 0.55, sy + floatY * 0.65 + 3)
    this.phantomEcho.rotation = -Math.sin(timeS * 0.63) * 0.018
    this.phantomEcho.scale.set(this.phantomBaseScale * (1.035 + Math.sin(timeS * 0.91) * 0.018))
    this.phantomEcho.alpha = a * 0.44 * (1.05 - pulse * 0.35)
    this.phantomEcho.visible = visible
  }
}
