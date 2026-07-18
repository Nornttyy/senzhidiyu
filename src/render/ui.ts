import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { CONFIG } from '../config'
import { canAfford } from '../sim/inventory'
import { iconTex, type GameTextures } from './textures'
import type { ItemKind, ItemStack, WorldState } from '../sim/types'

const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
const style = (size: number, fill: number) => ({ fontFamily: FONT, fontSize: size, fill })
const CELL = 46
const GAP = 6
const NAMES: Record<ItemKind, string> = {
  axe: '共鸣木斧', wood: '低语木材', fluorite: '萤石', sapling: '低语树苗', lanternPost: '提灯柱',
}

interface Toast { text: string; t: number }
const TOAST_IN = 0.4
const TOAST_HOLD = 2.6
const TOAST_OUT = 0.6

/** 一个圆角物品格：底/图标/数量/选中框（圆角方格，按用户要求不走硬直角） */
class Cell {
  readonly c = new Container()
  private bg = new Graphics()
  private icon = new Sprite()
  private count = new Text({ text: '', style: style(12, 0xe8e2d0) })
  private sel = false
  private dim = false

  constructor(private tex: GameTextures) {
    this.icon.anchor.set(0.5)
    this.count.anchor.set(1, 1)
    this.count.position.set(CELL - 5, CELL - 3)
    this.c.addChild(this.bg, this.icon, this.count)
    this.draw()
  }

  private draw(): void {
    this.bg.clear().roundRect(0, 0, CELL, CELL, 10)
      .fill({ color: 0x10160f, alpha: 0.78 })
      .stroke({
        color: this.sel ? 0xffe9b0 : 0x4a5244,
        width: this.sel ? 2.5 : 1.5,
        alpha: this.sel ? 0.95 : 0.8,
      })
  }

  set(stack: ItemStack | null, selected: boolean, dimmed = false): void {
    if (selected !== this.sel) { this.sel = selected; this.draw() }
    if (dimmed !== this.dim) { this.dim = dimmed; this.c.alpha = dimmed ? 0.35 : 1 }
    if (!stack) { this.icon.visible = false; this.count.text = ''; return }
    const t = iconTex(this.tex, stack.kind)
    if (this.icon.texture !== t) {
      this.icon.texture = t
      const k = (CELL - 12) / Math.max(t.width, t.height)
      this.icon.scale.set(k)
      this.icon.position.set(CELL / 2, CELL / 2)
    }
    this.icon.visible = true
    this.count.text = stack.count > 1 ? String(stack.count) : ''
  }
}

/** HUD：热键栏/血心/背包面板/蒲公英/提示/toast；UI 命中与点击由 main 经 hitTest/click 路由 */
export class UI {
  readonly container = new Container()
  bagOpen = false
  onMove?: (from: number, to: number) => void
  onCraft?: (recipe: number) => void

  private hotCells: Cell[] = []
  private hotbar = new Container()
  private hearts = new Container()
  private heartsFill = new Container()
  private heartsMask = new Graphics()
  private bag = new Container()
  private bagCells: Cell[] = []
  private recipeBtns: { c: Container; label: Text }[] = []
  private heldFrom: number | null = null
  private heldSprite = new Sprite()
  private heldCount = new Text({ text: '', style: style(12, 0xe8e2d0) })
  private nameFloat = new Text({ text: '', style: style(14, 0xf0ead8) })
  private nameT = 9
  private bumpT = 1
  private slots: readonly (ItemStack | null)[] = []
  private selected = 0
  private hp: number = CONFIG.hp.max
  private serenity: number = CONFIG.serenity.initial
  private afford: boolean[] = []
  private flower = new Graphics()
  private lastPetals = -1
  private hintText = new Text({ text: '', style: style(15, 0xe8e2d0) })
  private hintBg = new Graphics()
  private hint = new Container()
  private toastText = new Text({ text: '', style: style(17, 0xf0ead8) })
  private toastBg = new Graphics()
  private toastC = new Container()
  private toasts: Toast[] = []

  constructor(private app: Application, private tex: GameTextures) {
    for (let i = 0; i < CONFIG.inv.hotbar; i++) {
      const cell = new Cell(tex)
      cell.c.position.set(i * (CELL + GAP), 0)
      this.hotCells.push(cell)
      this.hotbar.addChild(cell.c)
    }
    // 血心：灰底一排 + 遮罩填充一排（半心粒度=遮罩宽度）
    const heartRow = (tint: number | null): Container => {
      const row = new Container()
      for (let i = 0; i < 10; i++) {
        const h = new Sprite(tex.heart)
        h.anchor.set(0, 1)
        h.scale.set(20 / tex.heart.height)
        h.position.set(i * 22, 0)
        if (tint !== null) h.tint = tint
        row.addChild(h)
      }
      return row
    }
    this.hearts.addChild(heartRow(0x3a3f38))
    this.heartsFill = heartRow(null)
    this.heartsFill.mask = this.heartsMask
    this.hearts.addChild(this.heartsFill, this.heartsMask)
    // 背包面板
    const bw = 9 * (CELL + GAP) - GAP + 32
    const bh = 4 * (CELL + GAP) - GAP + 148
    const panel = new Graphics()
      .roundRect(0, 0, bw, bh, 14)
      .fill({ color: 0x0c120c, alpha: 0.92 })
      .stroke({ color: 0x4a5244, width: 2 })
    this.bag.addChild(panel)
    const title = new Text({ text: '背包（E 关闭）', style: style(15, 0xd8d2c0) })
    title.position.set(16, 12)
    this.bag.addChild(title)
    for (let i = 0; i < CONFIG.inv.slots; i++) {
      const cell = new Cell(tex)
      const isHot = i < CONFIG.inv.hotbar
      const row = isHot ? 3 : Math.floor((i - 9) / 9)
      const col = isHot ? i : (i - 9) % 9
      cell.c.position.set(16 + col * (CELL + GAP), 40 + row * (CELL + GAP) + (isHot ? 10 : 0))
      this.bagCells.push(cell)
      this.bag.addChild(cell.c)
    }
    CONFIG.recipes.forEach((r, i) => {
      const c = new Container()
      const costText = r.cost.map((x) => `${NAMES[x.kind]}×${x.count}`).join(' ')
      const label = new Text({ text: `合成 ${r.name}（${costText}）`, style: style(13, 0xe8e2d0) })
      const bg = new Graphics()
        .roundRect(0, 0, label.width + 24, 30, 8)
        .fill({ color: 0x24301f, alpha: 0.95 })
        .stroke({ color: 0x4a5244, width: 1.5 })
      label.position.set(12, 7)
      c.addChild(bg, label)
      c.position.set(16, 40 + 4 * (CELL + GAP) + 24 + i * 38)
      this.recipeBtns.push({ c, label })
      this.bag.addChild(c)
    })
    this.bag.visible = false
    this.heldSprite.anchor.set(0.5)
    this.hint.addChild(this.hintBg, this.hintText)
    this.hint.visible = false
    this.toastC.addChild(this.toastBg, this.toastText)
    this.toastC.visible = false
    this.nameFloat.anchor.set(0.5)
    this.container.addChild(
      this.flower, this.hearts, this.hotbar, this.nameFloat,
      this.hint, this.toastC, this.bag, this.heldSprite, this.heldCount,
    )
  }

  toggleBag(): void {
    this.bagOpen = !this.bagOpen
    this.bag.visible = this.bagOpen
    if (!this.bagOpen) this.heldFrom = null
  }

  /** 拾取入包的计数跳动 */
  bump(): void { this.bumpT = 0 }

  sync(w: WorldState): void {
    if (w.selected !== this.selected) {
      const st = w.slots[w.selected]
      if (st) { this.nameFloat.text = NAMES[st.kind]; this.nameT = 0 }
    }
    this.slots = w.slots
    this.selected = w.selected
    this.hp = w.hp
    this.serenity = w.serenity
    this.afford = CONFIG.recipes.map((r) => canAfford(w.slots, r.cost))
  }

  /** UI 命中：热键栏区域 / 打开的背包面板 */
  hitTest(x: number, y: number): boolean {
    if (this.hotbar.getBounds().containsPoint(x, y)) return true
    if (this.bagOpen && this.bag.getBounds().containsPoint(x, y)) return true
    return false
  }

  /** 点击路由：背包格拿放 / 配方合成（热键区点击在关背包态不做事，选格走键盘滚轮） */
  click(x: number, y: number): void {
    if (!this.bagOpen) return
    for (let i = 0; i < this.bagCells.length; i++) {
      if (this.bagCells[i]!.c.getBounds().containsPoint(x, y)) { this.cellClick(i); return }
    }
    this.recipeBtns.forEach((b, i) => {
      if (b.c.getBounds().containsPoint(x, y) && this.afford[i]) this.onCraft?.(i)
    })
  }

  private cellClick(idx: number): void {
    if (this.heldFrom === null) {
      if (this.slots[idx]) this.heldFrom = idx
    } else {
      this.onMove?.(this.heldFrom, idx)
      this.heldFrom = null
    }
  }

  setHint(t: string | null): void {
    this.hint.visible = t !== null && !this.bagOpen
    if (t !== null && this.hintText.text !== t) {
      this.hintText.text = t
      const w = this.hintText.width + 28
      const h = this.hintText.height + 14
      this.hintBg.clear().roundRect(-w / 2, -h / 2, w, h, 8).fill({ color: 0x0a0e0a, alpha: 0.72 })
      this.hintText.position.set(-this.hintText.width / 2, -this.hintText.height / 2)
    }
  }

  toast(text: string): void { this.toasts.push({ text, t: 0 }) }

  /** 手上叠随鼠标（main 每帧喂屏幕坐标） */
  setHeldPos(x: number, y: number): void {
    this.heldSprite.position.set(x, y)
    this.heldCount.position.set(x + 10, y + 8)
  }

  update(realDt: number, timeS: number): void {
    const { width, height } = this.app.screen
    const hotW = 9 * (CELL + GAP) - GAP
    // 热键栏 + 拾取跳动
    this.bumpT = Math.min(1, this.bumpT + realDt * 4)
    const bump = 1 + 0.12 * (1 - this.bumpT)
    this.hotbar.scale.set(bump)
    this.hotbar.position.set(width / 2 - (hotW * bump) / 2, height - 16 - CELL * bump)
    for (let i = 0; i < this.hotCells.length; i++) {
      this.hotCells[i]!.set(this.slots[i] ?? null, i === this.selected && !this.bagOpen)
    }
    // 血心：遮罩宽度表现血量（半心粒度自然呈现）
    this.hearts.position.set(width / 2 - hotW / 2, height - 16 - CELL - 14)
    this.heartsMask.clear().rect(0, -24, 10 * 22 * (this.hp / CONFIG.hp.max), 26).fill(0xffffff)
    // 蒲公英安宁值
    const petals = Math.ceil((this.serenity / CONFIG.serenity.max) * 12)
    if (petals !== this.lastPetals) {
      this.lastPetals = petals
      const k = this.serenity / CONFIG.serenity.max
      const mix = (a: number, b: number) => Math.round(a + (b - a) * (1 - k))
      const col = (mix(255, 154) << 16) | (mix(242, 163) << 8) | mix(200, 155)
      this.flower.clear()
      for (let i = 0; i < petals; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2
        this.flower.moveTo(Math.cos(a) * 8, Math.sin(a) * 8)
          .lineTo(Math.cos(a) * 24, Math.sin(a) * 24)
          .stroke({ color: col, width: 2, alpha: 0.9 })
        this.flower.circle(Math.cos(a) * 24, Math.sin(a) * 24, 2).fill({ color: col, alpha: 0.9 })
      }
      this.flower.circle(0, 0, 6).fill(col)
    }
    this.flower.position.set(64, height - 64)
    this.flower.rotation = Math.sin(timeS * 0.8) * 0.05
    // 选中物品名浮签
    this.nameT += realDt
    this.nameFloat.visible = this.nameT < 1.2 && !this.bagOpen
    this.nameFloat.alpha = Math.max(0, 1 - this.nameT / 1.2)
    this.nameFloat.position.set(width / 2, height - 16 - CELL - 44)
    // 背包面板：格内容、配方可用性、手上叠
    if (this.bagOpen) {
      this.bag.position.set(
        Math.round(width / 2 - this.bag.width / 2),
        Math.round(height / 2 - this.bag.height / 2),
      )
      for (let i = 0; i < this.bagCells.length; i++) {
        this.bagCells[i]!.set(this.slots[i] ?? null, i === this.selected, i === this.heldFrom)
      }
      this.recipeBtns.forEach((b, i) => { b.c.alpha = this.afford[i] ? 1 : 0.45 })
      const held = this.heldFrom !== null ? this.slots[this.heldFrom] : null
      this.heldSprite.visible = !!held
      this.heldCount.visible = !!held && held.count > 1
      if (held) {
        const t = iconTex(this.tex, held.kind)
        if (this.heldSprite.texture !== t) {
          this.heldSprite.texture = t
          this.heldSprite.scale.set((CELL - 14) / Math.max(t.width, t.height))
        }
        this.heldCount.text = String(held.count)
      }
    } else {
      this.heldSprite.visible = false
      this.heldCount.visible = false
    }
    // 提示条
    this.hint.position.set(width / 2, height - 130)
    // toast 队列
    const cur = this.toasts[0]
    if (cur) {
      cur.t += realDt
      const total = TOAST_IN + TOAST_HOLD + TOAST_OUT
      let a = 1
      if (cur.t < TOAST_IN) a = cur.t / TOAST_IN
      else if (cur.t > TOAST_IN + TOAST_HOLD) a = Math.max(0, 1 - (cur.t - TOAST_IN - TOAST_HOLD) / TOAST_OUT)
      if (this.toastText.text !== cur.text) {
        this.toastText.text = cur.text
        const w = this.toastText.width + 36
        const h = this.toastText.height + 16
        this.toastBg.clear().roundRect(-w / 2, -h / 2, w, h, 9).fill({ color: 0x0a0e0a, alpha: 0.66 })
        this.toastText.position.set(-this.toastText.width / 2, -this.toastText.height / 2)
      }
      this.toastC.visible = true
      this.toastC.alpha = a
      this.toastC.position.set(width / 2, 72)
      if (cur.t >= total) this.toasts.shift()
    } else {
      this.toastC.visible = false
    }
  }
}
