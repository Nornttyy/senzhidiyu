import { Assets, Container, Graphics, Texture, type Renderer } from 'pixi.js'

export interface GameTextures {
  seeker: Texture; tree: Texture; ore: Texture; campfire: Texture; post: Texture; phantom: Texture
  axe: Texture; wood: Texture; fluorite: Texture; sapling: Texture; heart: Texture
}

const FILES: Record<keyof GameTextures, string> = {
  seeker: 'seeker.png', tree: 'whisper-tree.png', ore: 'lumina-ore.png',
  campfire: 'campfire.png', post: 'lantern-post.png', phantom: 'phantom.png',
  axe: 'axe.png', wood: 'wood.png', fluorite: 'fluorite.png', sapling: 'sapling.png', heart: 'heart.png',
}

/** 物品图标/掉落物纹理（lanternPost 复用立绘） */
export function iconTex(t: GameTextures, k: import('../sim/types').ItemKind): Texture {
  return k === 'lanternPost' ? t.post : t[k]
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
  axe(g) {
    g.roundRect(-5, -60, 10, 60, 4).fill(0x6b563a)
    g.poly([-6, -60, -30, -50, -30, -30, -6, -36]).fill(0x8a8f80)
  },
  wood(g) {
    g.roundRect(-26, -20, 52, 20, 8).fill(0x3c554c)
    g.circle(-26, -10, 9).fill(0xcbb99a)
  },
  fluorite(g) { g.poly([-12, 0, 0, -34, 12, 0]).fill(0x8ac0e8) },
  sapling(g) {
    g.rect(-2, -26, 4, 26).fill(0x4c5a44)
    g.circle(0, -30, 8).fill(0x5a8a6a)
  },
  heart(g) {
    g.circle(-7, -18, 8).fill(0x9a3040)
    g.circle(7, -18, 8).fill(0x9a3040)
    g.poly([-14, -14, 0, 2, 14, -14]).fill(0x9a3040)
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
  const [seeker, tree, ore, campfire, post, phantom, axe, wood, fluorite, sapling, heart] = await Promise.all([
    loadOne(renderer, 'seeker'), loadOne(renderer, 'tree'), loadOne(renderer, 'ore'),
    loadOne(renderer, 'campfire'), loadOne(renderer, 'post'), loadOne(renderer, 'phantom'),
    loadOne(renderer, 'axe'), loadOne(renderer, 'wood'), loadOne(renderer, 'fluorite'),
    loadOne(renderer, 'sapling'), loadOne(renderer, 'heart'),
  ])
  return { seeker, tree, ore, campfire, post, phantom, axe, wood, fluorite, sapling, heart }
}
