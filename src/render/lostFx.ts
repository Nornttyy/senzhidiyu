import { Application, ColorMatrixFilter, Container, type Filter, Sprite, Texture } from 'pixi.js'
import { CONFIG } from '../config'

/** 屏幕边缘雾圈纹理：中心透明、边缘烟黑 */
function makeVignette(): Texture {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const grad = ctx.createRadialGradient(256, 256, 120, 256, 256, 256)
  grad.addColorStop(0, 'rgba(6,8,6,0)')
  grad.addColorStop(0.62, 'rgba(6,8,6,0.12)')
  grad.addColorStop(1, 'rgba(6,8,6,0.92)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return Texture.from(cv)
}

/** 迷失状态表现：边缘起雾 + 世界降饱和，强度平滑渐变（进出无跳变） */
export class LostFx {
  readonly container = new Container()
  private vignette = new Sprite(makeVignette())
  private desat = new ColorMatrixFilter()
  private k = 0

  constructor(private app: Application, private worldC: Container, private baseFilters: Filter[] = []) {
    this.vignette.alpha = 0
    this.container.addChild(this.vignette)
  }

  update(lost: boolean, realDt: number): void {
    const target = lost ? 1 : 0
    const step = CONFIG.lost.rampRate * realDt
    this.k = this.k + Math.max(-step, Math.min(step, target - this.k))
    this.vignette.width = this.app.screen.width
    this.vignette.height = this.app.screen.height
    this.vignette.alpha = this.k * CONFIG.lost.vignetteMax
    if (this.k > 0.005) {
      this.desat.reset()
      this.desat.saturate(-CONFIG.lost.desatMax * this.k, false)
      if (!this.worldC.filters || (this.worldC.filters as Filter[]).every((f) => f !== this.desat)) this.worldC.filters = [...this.baseFilters, this.desat]
    } else if (this.worldC.filters && (this.worldC.filters as Filter[]).some((f) => f === this.desat)) {
      this.worldC.filters = this.baseFilters.length ? [...this.baseFilters] : (null as unknown as [])
    }
  }
}
