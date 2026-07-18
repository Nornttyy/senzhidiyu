import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { CONFIG } from '../config'

export interface LightSpec {
  xM: number       // 世界米坐标
  yM: number
  radiusM: number
  alpha?: number   // 0..1 光洞强度（微光装饰用低值），默认 1
  flicker?: number // 呼吸幅度倍率，默认 1
  phase?: number   // 呼吸相位种子；不随灯表数组增删漂移（默认退化为数组下标）
}

let radialTex: Texture | undefined

/** 半径 256 的柔边径向渐变纹理（模块级缓存单份）；光洞/火焰/光晕共用 */
export function makeRadialTexture(): Texture {
  if (radialTex) return radialTex
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  radialTex = Texture.from(cv)
  return radialTex
}

let tornTexs: Texture[] | undefined

/** 光洞撕边变体：半径随角度噪声起伏的径向渐变，多张循环制造毛边沸腾感 */
export function makeTornHoleTextures(): Texture[] {
  if (tornTexs) return tornTexs
  const H = CONFIG.handmade
  const size = 512
  const out: Texture[] = []
  for (let v = 0; v < H.lightVariants; v++) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const ctx = cv.getContext('2d')!
    // 角度噪声:低频正弦叠加,变体间相位错开
    const wobble = (a: number) =>
      1 + H.lightEdgeNoise * (0.55 * Math.sin(a * 5 + v * 2.1) + 0.3 * Math.sin(a * 9 + v * 4.7) + 0.15 * Math.sin(a * 17 + v * 8.3))
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    // 以噪声半径裁剪路径,渐变只画在撕边形状内
    ctx.beginPath()
    const R = 254
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2
      const r = R * Math.min(1, wobble(a))
      const x = 256 + Math.cos(a) * r
      const y = 256 + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.clip()
    ctx.fillRect(0, 0, size, size)
    out.push(Texture.from(cv))
  }
  tornTexs = out
  return out
}

export class LightLayer {
  readonly container = new Container()
  private app: Application
  private rt: RenderTexture
  private darkness: Sprite
  private scratch = new Container()
  private cover = new Graphics()
  private holes: Sprite[] = []
  private tornVariants = makeTornHoleTextures()

  constructor(app: Application) {
    this.app = app
    this.rt = RenderTexture.create({ width: app.screen.width, height: app.screen.height })
    this.darkness = new Sprite(this.rt)
    this.container.addChild(this.darkness)
    this.scratch.addChild(this.cover)
  }

  /** lights 为世界米坐标；originPx 为 world 容器在屏幕上的原点（相机偏移） */
  update(lights: LightSpec[], originPx: { x: number; y: number }, timeS: number): void {
    const { width, height } = this.app.screen
    if (this.rt.width !== width || this.rt.height !== height) {
      this.rt.resize(width, height)
    }
    this.cover.clear().rect(0, 0, width, height).fill({ color: 0x000000, alpha: CONFIG.light.darkness })
    while (this.holes.length < lights.length) {
      const s = new Sprite(this.tornVariants[0])
      s.anchor.set(0.5)
      s.blendMode = 'erase'
      this.holes.push(s)
      this.scratch.addChild(s)
    }
    const px = CONFIG.pxPerMeter
    this.holes.forEach((s, i) => {
      const l = lights[i]
      s.visible = !!l
      if (!l) return
      s.position.set(originPx.x + l.xM * px, originPx.y + l.yM * px)
      s.alpha = l.alpha ?? 1
      // 火光呼吸：双正弦伪噪声，相位取稳定种子（灯表增删时不跳变）；flicker 缩放幅度
      const ph = l.phase ?? i
      const amp = CONFIG.light.flickerAmp * (l.flicker ?? 1)
      const f = 1 + amp * 0.5 * (Math.sin(timeS * 7.3 + ph * 1.7) + Math.sin(timeS * 12.1 + ph * 4.1))
      s.scale.set((l.radiusM * px * 2 * f) / 512)
      // 撕边沸腾:低帧步进换变体 + 微转,毛边像逐帧手绘
      const vi = Math.floor(timeS * CONFIG.handmade.lightBoilFps + ph * 7) % this.tornVariants.length
      s.texture = this.tornVariants[vi]!
      s.rotation = (Math.floor(timeS * CONFIG.handmade.lightBoilFps + ph) % 4) * (Math.PI / 2)
    })
    this.app.renderer.render({ container: this.scratch, target: this.rt, clear: true })
  }
}
