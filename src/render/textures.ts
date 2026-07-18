import { Assets, Container, Graphics, Texture, type Renderer } from 'pixi.js'

export interface GameTextures {
  seeker: Texture; tree: Texture; ore: Texture; campfire: Texture; post: Texture; phantom: Texture
}

const FILES: Record<keyof GameTextures, string> = {
  seeker: 'seeker.png', tree: 'whisper-tree.png', ore: 'lumina-ore.png',
  campfire: 'campfire.png', post: 'lantern-post.png', phantom: 'phantom.png',
}

/** 素材缺失时的程序占位（形状 y 以脚底为 0 向上为负） */
const builders: Record<keyof GameTextures, (g: Graphics) => void> = {
  seeker(g) {
    g.roundRect(-20, -78, 40, 78, 12).fill(0x8a8f7a)
    g.circle(0, -64, 15).fill(0x6f7462)
    g.circle(-5, -64, 3).fill(0xffdf8a)
    g.circle(5, -64, 3).fill(0xffdf8a)
    g.circle(-16, -34, 6).fill(0xffc862)
  },
  tree(g) {
    g.rect(-7, -62, 14, 62).fill(0x2e4038)
    g.circle(0, -84, 34).fill(0x2f5a4c)
    g.circle(-22, -66, 22).fill(0x2a5044)
    g.circle(22, -66, 22).fill(0x2a5044)
    g.circle(-8, -90, 3).fill(0x9fe8c8)
    g.circle(14, -72, 3).fill(0x9fe8c8)
  },
  ore(g) {
    g.poly([-26, 0, -12, -32, 2, -6]).fill(0x3b6ea8)
    g.poly([-6, 0, 8, -42, 22, 0]).fill(0x5b9ad0)
    g.poly([12, -2, 26, -22, 30, 0]).fill(0x4a80b8)
  },
  campfire(g) {
    g.ellipse(0, -3, 30, 9).fill(0x2c2a24)
    g.circle(-30, -4, 6).fill(0x4a4a48)
    g.circle(30, -4, 6).fill(0x4a4a48)
    g.roundRect(-26, -16, 52, 10, 4).fill(0x5a4630)
    g.roundRect(-9, -30, 18, 24, 6).fill(0x6b563a)
  },
  post(g) {
    g.rect(-4, -88, 8, 88).fill(0x4c3f2e)
    g.roundRect(-14, -108, 28, 26, 6).fill(0x6b5638)
    g.circle(0, -95, 8).fill(0xffd98a)
  },
  phantom(g) {
    g.ellipse(0, -30, 20, 30).fill(0x9aa4a8)
    g.ellipse(0, -58, 12, 14).fill(0xaab4b8)
    g.circle(-4, -60, 2).fill(0xdce8ee)
    g.circle(4, -60, 2).fill(0xdce8ee)
  },
}

async function loadOne(renderer: Renderer, name: keyof GameTextures): Promise<Texture> {
  let tex: Texture
  try {
    tex = await Assets.load<Texture>(`./assets/${FILES[name]}`)
  } catch {
    console.warn(`${FILES[name]} 缺失，使用程序占位`)
    const c = new Container()
    const g = new Graphics()
    builders[name](g)
    c.addChild(g)
    tex = renderer.generateTexture(c)
  }
  // 立绘原图按 ~10:1 缩小显示，无 mipmap 会持续采样抖动
  tex.source.autoGenerateMipmaps = true
  return tex
}

export async function loadTextures(renderer: Renderer): Promise<GameTextures> {
  const [seeker, tree, ore, campfire, post, phantom] = await Promise.all([
    loadOne(renderer, 'seeker'), loadOne(renderer, 'tree'), loadOne(renderer, 'ore'),
    loadOne(renderer, 'campfire'), loadOne(renderer, 'post'), loadOne(renderer, 'phantom'),
  ])
  return { seeker, tree, ore, campfire, post, phantom }
}
