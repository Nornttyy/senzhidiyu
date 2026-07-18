import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { CONFIG } from '../config'

export interface LightSpec { xPx: number; yPx: number; radiusPx: number }

/** 半径 256 的柔边径向渐变纹理（canvas 生成一次） */
function makeHoleTexture(): Texture {
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
  return Texture.from(cv)
}

export class LightLayer {
  readonly container = new Container()
  private app: Application
  private rt: RenderTexture
  private darkness: Sprite
  private scratch = new Container()
  private cover = new Graphics()
  private holes: Sprite[] = []
  private holeTex = makeHoleTexture()

  constructor(app: Application) {
    this.app = app
    this.rt = RenderTexture.create({ width: app.screen.width, height: app.screen.height })
    this.darkness = new Sprite(this.rt)
    this.container.addChild(this.darkness)
    this.scratch.addChild(this.cover)
  }

  update(lights: LightSpec[], timeS: number): void {
    const { width, height } = this.app.screen
    if (this.rt.width !== width || this.rt.height !== height) {
      this.rt.resize(width, height)
    }
    this.cover.clear().rect(0, 0, width, height).fill({ color: 0x000000, alpha: CONFIG.light.darkness })
    while (this.holes.length < lights.length) {
      const s = new Sprite(this.holeTex)
      s.anchor.set(0.5)
      s.blendMode = 'erase'
      this.holes.push(s)
      this.scratch.addChild(s)
    }
    // 火光呼吸：双正弦伪噪声，各灯相位随索引错开
    const flicker = (i: number) =>
      1 + CONFIG.light.flickerAmp * 0.5 * (Math.sin(timeS * 7.3 + i * 1.7) + Math.sin(timeS * 12.1 + i * 4.1))
    this.holes.forEach((s, i) => {
      const l = lights[i]
      s.visible = !!l
      if (!l) return
      s.position.set(l.xPx, l.yPx)
      const d = (l.radiusPx * 2 * flicker(i)) / 512
      s.scale.set(d)
    })
    this.app.renderer.render({ container: this.scratch, target: this.rt, clear: true })
  }
}
