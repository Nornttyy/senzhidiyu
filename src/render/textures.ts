import { Assets, Container, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js'

export interface GameTextures {
  seeker: Texture
  seekerSideHead: Texture; seekerSideBody: Texture
  seekerSideUpperArm: Texture; seekerSideLowerArm: Texture
  seekerSideUpperLeg: Texture; seekerSideLowerLeg: Texture
  tree: Texture; ore: Texture; campfire: Texture; post: Texture; phantom: Texture
  axe: Texture; wood: Texture; fluorite: Texture; sapling: Texture; heart: Texture
  torch: Texture; stone: Texture
  torchIcon: Texture; postIcon: Texture
}

type LoadableTex = Exclude<keyof GameTextures, 'torchIcon' | 'postIcon'>
const FILES: Record<LoadableTex, string> = {
  seeker: 'seeker-front-clean.png?v=3',
  seekerSideHead: 'seeker-side-head.png?v=3', seekerSideBody: 'seeker-side-body.png?v=3',
  seekerSideUpperArm: 'seeker-side-upper-arm.png?v=3', seekerSideLowerArm: 'seeker-side-lower-arm.png?v=3',
  seekerSideUpperLeg: 'seeker-side-upper-leg.png?v=3', seekerSideLowerLeg: 'seeker-side-lower-leg.png?v=3',
  tree: 'whisper-tree.png', ore: 'lumina-ore.png',
  campfire: 'campfire.png', post: 'lantern-post.png', phantom: 'phantom.png',
  axe: 'hand-axe.png?v=1', wood: 'wood.png', fluorite: 'fluorite.png', sapling: 'sapling.png', heart: 'heart.png',
  // 版本号让已经打开过旧占位图的浏览器重新下载正式素材。
  torch: 'torch.png?v=3', stone: 'ancient-stone.png?v=3',
}

/** 物品图标/掉落物纹理（可放置物复用世界立绘） */
export function iconTex(t: GameTextures, k: import('../sim/types').ItemKind): Texture {
  if (k === 'lanternPost') return t.postIcon
  if (k === 'torch') return t.torchIcon
  if (k === 'campfire') return t.campfire
  return t[k]
}

/** 素材缺失时的程序占位（形状 y 以脚底为 0 向上为负） */
const drawSeeker = (g: Graphics): void => {
  g.roundRect(-20, -78, 40, 78, 12).fill(0x8a8f7a)
  g.circle(0, -64, 15).fill(0x6f7462)
  g.circle(-5, -64, 3).fill(0xffdf8a)
  g.circle(5, -64, 3).fill(0xffdf8a)
  g.circle(-16, -34, 6).fill(0xffc862)
}

const builders: Record<LoadableTex, (g: Graphics) => void> = {
  seeker: drawSeeker,
  seekerSideHead(g) {
    g.circle(0, 14, 16).fill(0x777a6c)
    g.circle(7, 12, 3).fill(0xffd77a)
  },
  seekerSideBody(g) { g.roundRect(-16, 0, 32, 52, 10).fill(0x888b7b) },
  seekerSideUpperArm(g) { g.roundRect(-6, 0, 12, 28, 6).fill(0x999b8b) },
  seekerSideLowerArm(g) { g.roundRect(-5, 0, 10, 26, 5).fill(0xaaa99a) },
  seekerSideUpperLeg(g) { g.roundRect(-7, 0, 14, 30, 6).fill(0x777a6c) },
  seekerSideLowerLeg(g) { g.roundRect(-6, 0, 18, 30, 5).fill(0x666a5f) },
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
  torch(g) {
    g.roundRect(-4, -58, 8, 58, 3).fill(0x6b4a2a)
    g.roundRect(-10, -66, 20, 12, 4).fill(0x3a3129)
    g.poly([0, -92, -10, -70, 0, -64, 10, -70]).fill(0xffb050)
    g.poly([0, -84, -5, -70, 0, -67, 5, -70]).fill(0xffe29a)
  },
  stone(g) {
    g.poly([-30, 0, -35, -32, -22, -72, 0, -88, 24, -68, 34, -28, 28, 0]).fill(0x626b61)
    g.circle(0, -44, 15).stroke({ color: 0x343d38, width: 3 })
    g.circle(0, -44, 3).fill(0xb98a42)
  },
}

async function loadOne(renderer: Renderer, name: LoadableTex, fallback?: Texture): Promise<Texture> {
  let tex: Texture
  try {
    tex = await Assets.load<Texture>(`./assets/${FILES[name]}`)
  } catch {
    console.warn(`${FILES[name]} 缺失，使用程序占位`)
    if (fallback) tex = fallback
    else {
      const c = new Container()
      const g = new Graphics()
      builders[name](g)
      c.addChild(g)
      tex = renderer.generateTexture(c)
    }
  }
  // 立绘原图按 ~10:1 缩小显示，无 mipmap 会持续采样抖动
  tex.source.autoGenerateMipmaps = true
  return tex
}

export async function loadTextures(renderer: Renderer): Promise<GameTextures> {
  const [seeker, seekerSideHead, seekerSideBody, seekerSideUpperArm, seekerSideLowerArm,
    seekerSideUpperLeg, seekerSideLowerLeg,
    tree, ore, campfire, post, phantom, axe, wood, fluorite, sapling, heart, torch, stone] = await Promise.all([
    loadOne(renderer, 'seeker'),
    loadOne(renderer, 'seekerSideHead'), loadOne(renderer, 'seekerSideBody'),
    loadOne(renderer, 'seekerSideUpperArm'), loadOne(renderer, 'seekerSideLowerArm'),
    loadOne(renderer, 'seekerSideUpperLeg'), loadOne(renderer, 'seekerSideLowerLeg'),
    loadOne(renderer, 'tree'), loadOne(renderer, 'ore'),
    loadOne(renderer, 'campfire'), loadOne(renderer, 'post'), loadOne(renderer, 'phantom'),
    loadOne(renderer, 'axe'), loadOne(renderer, 'wood'), loadOne(renderer, 'fluorite'),
    loadOne(renderer, 'sapling'), loadOne(renderer, 'heart'), loadOne(renderer, 'torch'), loadOne(renderer, 'stone'),
  ])
  // 细长的世界立绘直接缩进物品格会变成一条线，图标只截取最有辨识度的顶部。
  const topCrop = (tex: Texture, height: number): Texture => new Texture({
    source: tex.source,
    frame: new Rectangle(tex.frame.x, tex.frame.y, tex.frame.width, Math.min(tex.frame.height, height)),
  })
  const torchIcon = topCrop(torch, torch.width * 1.7)
  const postIcon = topCrop(post, post.width * 1.12)
  return {
    seeker, seekerSideHead, seekerSideBody, seekerSideUpperArm, seekerSideLowerArm,
    seekerSideUpperLeg, seekerSideLowerLeg, tree, ore, campfire, post, phantom,
    axe, wood, fluorite, sapling, heart, torch, stone, torchIcon, postIcon,
  }
}
