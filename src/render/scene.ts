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
    this.world.position.set(
      Math.round(this.app.screen.width / 2 - xM * px),
      Math.round(this.app.screen.height / 2 - yM * px),
    )
  }
}
