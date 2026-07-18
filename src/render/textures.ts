import { Assets, Container, Graphics, Texture, type Renderer } from 'pixi.js'

export interface GameTextures { seeker: Texture }

function placeholderSeeker(renderer: Renderer): Texture {
  const c = new Container()
  const g = new Graphics()
  g.roundRect(-20, -78, 40, 78, 12).fill(0x8a8f7a)      // 斗篷身
  g.circle(0, -64, 15).fill(0x6f7462)                   // 兜帽
  g.circle(-5, -64, 3).fill(0xffdf8a)                   // 双眼微光
  g.circle(5, -64, 3).fill(0xffdf8a)
  g.circle(-16, -34, 6).fill(0xffc862)                  // 提灯
  c.addChild(g)
  return renderer.generateTexture(c)
}

export async function loadTextures(renderer: Renderer): Promise<GameTextures> {
  let seeker: Texture
  try {
    seeker = await Assets.load<Texture>('./assets/seeker.png')
    // 立绘原图按 ~10:1 缩小显示，无 mipmap 时呼吸缩放/亚像素移动都会
    // 引发采样抖动（角色持续发晃）；置标志后 GL 上传时自动生成 mip 链
    seeker.source.autoGenerateMipmaps = true
  } catch {
    console.warn('seeker.png 缺失，使用程序占位')
    seeker = placeholderSeeker(renderer)
  }
  return { seeker }
}
