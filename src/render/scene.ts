import { Application, Container, Graphics } from 'pixi.js'
import { CONFIG } from '../config'

export class Scene {
  readonly world = new Container()
  private app: Application

  constructor(app: Application) {
    this.app = app
    const px = CONFIG.pxPerMeter
    const ground = new Graphics()
      .rect(0, 0, CONFIG.world.width * px, CONFIG.world.height * px)
      .fill(CONFIG.colors.ground)
    this.world.addChild(ground)
    this.world.sortableChildren = true // y 排序遮挡
    app.stage.addChild(this.world)
  }

  follow(xM: number, yM: number): void {
    const px = CONFIG.pxPerMeter
    // 不取整：取整会把相机量化到整 CSS 像素，而精灵位置是浮点，
    // 两者相对差每帧 ±0.5px 锯齿即行走晃动；有 mipmap 后亚像素采样平滑
    this.world.position.set(
      this.app.screen.width / 2 - xM * px,
      this.app.screen.height / 2 - yM * px,
    )
  }
}
