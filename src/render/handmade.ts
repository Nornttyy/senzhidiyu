import 'pixi.js/advanced-blend-modes' // overlay/soft-light 等高级混合注册,缺失会静默回退 normal
import { Application, Container, Sprite, Texture, TilingSprite } from 'pixi.js'
import { CONFIG } from '../config'
import { nextRand } from '../sim/rand'

/** 纸张纤维肌理：短笔触纤维 + 细噪点，乘法叠加铺满全屏（种子固定，刷新不变） */
function makePaperTexture(): Texture {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  let seed: number = CONFIG.handmade.paperSeed
  const rand = () => { const r = nextRand(seed); seed = r.seed; return r.value }
  ctx.fillStyle = '#808080' // overlay 混合以中灰为亮度中性基准,白底会洗亮黑夜
  ctx.fillRect(0, 0, size, size)
  // 纤维束：随机方向短划线，亮暗各半
  for (let i = 0; i < 1600; i++) {
    const x = rand() * size
    const y = rand() * size
    const len = 6 + rand() * 26
    const a = rand() * Math.PI
    const dark = rand() < 0.5
    ctx.strokeStyle = dark ? `rgba(0,0,0,${0.06 + rand() * 0.08})` : `rgba(255,255,255,${0.06 + rand() * 0.08})`
    ctx.lineWidth = 0.6 + rand() * 1.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  // 细颗粒
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 30
    d[i] = Math.max(0, Math.min(255, d[i]! + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n))
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(cv)
}

/** 胶片颗粒帧：每帧一张独立噪点图，播放时循环切换 */
function makeGrainTextures(frames: number): Texture[] {
  const size = 256
  let seed: number = CONFIG.handmade.paperSeed ^ 0x9e3779b9
  const rand = () => { const r = nextRand(seed); seed = r.seed; return r.value }
  const out: Texture[] = []
  for (let f = 0; f < frames; f++) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const v = 118 + Math.floor(rand() * 20) // 围绕中灰,overlay 混合下亮暗对称
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    out.push(Texture.from(cv))
  }
  return out
}

/** 轮廓沸腾用位移噪声图：RG 通道随机,DisplacementFilter 采样源 */
export function makeDisplacementTexture(): Texture {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  let seed: number = CONFIG.handmade.paperSeed ^ 0x51ed270b
  const rand = () => { const r = nextRand(seed); seed = r.seed; return r.value }
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.floor(rand() * 256)
    d[i + 1] = Math.floor(rand() * 256)
    d[i + 2] = 128
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(cv)
}

/** 手作质感层：纸张肌理（乘法）+ 动态颗粒（overlay），置于 UI 之下所有画面之上 */
export class Handmade {
  readonly container = new Container()
  private paper: TilingSprite
  private grain: TilingSprite
  private grainFrames: Texture[]
  private app: Application

  constructor(app: Application) {
    this.app = app
    const H = CONFIG.handmade
    this.paper = new TilingSprite({ texture: makePaperTexture(), width: app.screen.width, height: app.screen.height })
    this.paper.alpha = H.paperAlpha
    this.paper.blendMode = 'overlay' // 暗区也吃得到肌理
    this.grainFrames = makeGrainTextures(H.grainFrames)
    this.grain = new TilingSprite({ texture: this.grainFrames[0]!, width: app.screen.width, height: app.screen.height })
    this.grain.alpha = H.grainAlpha
    this.grain.blendMode = 'overlay'
    this.container.addChild(this.paper, this.grain)
  }

  update(timeS: number): void {
    const H = CONFIG.handmade
    const { width, height } = this.app.screen
    if (this.paper.width !== width || this.paper.height !== height) {
      this.paper.width = this.grain.width = width
      this.paper.height = this.grain.height = height
    }
    // 颗粒步进换帧 + 平移，破除静态花纹感
    const f = Math.floor(timeS * H.grainFps)
    this.grain.texture = this.grainFrames[f % this.grainFrames.length]!
    this.grain.tilePosition.set((f * 37) % 256, (f * 61) % 256)
  }
}
