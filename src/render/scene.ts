import { Application, Container, Graphics } from 'pixi.js'
import { CONFIG } from '../config'

export class Scene {
  readonly world = new Container()
  private app: Application
  private ground = new Graphics()
  private groundSpan = 0

  constructor(app: Application) {
    this.app = app
    this.ground.zIndex = -1_000_000_000
    this.world.addChild(this.ground)
    this.world.sortableChildren = true // y 排序遮挡
    app.stage.addChild(this.world)
  }

  follow(xM: number, yM: number): void {
    const px = CONFIG.pxPerMeter
    // 地面像一张始终铺在玩家脚下的大毯子，跟着相机挪动，因此视觉上没有尽头。
    const span = Math.ceil(Math.max(this.app.screen.width, this.app.screen.height) * 2
      + CONFIG.world.chunkSizeM * px * 2)
    if (span !== this.groundSpan) {
      this.groundSpan = span
      this.ground.clear().rect(-span / 2, -span / 2, span, span).fill(CONFIG.colors.ground)
    }
    this.ground.position.set(xM * px, yM * px)
    // 不取整：取整会把相机量化到整 CSS 像素，而精灵位置是浮点，
    // 两者相对差每帧 ±0.5px 锯齿即行走晃动；有 mipmap 后亚像素采样平滑
    this.world.position.set(
      this.app.screen.width / 2 - xM * px,
      this.app.screen.height / 2 - yM * px,
    )
  }
}
