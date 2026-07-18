// E2E 行为探针：驱动"长按砍倒→扫拾掉落→合成→选格→右键放置→种树速生→昼夜火源(白昼安宁/持炬入夜/插地燃尽/篝火回血/残烬添柴)→迷失往返"全循环并断言 sim 状态。
// 仅本容器可跑（playwright 为环境工具，不入 package.json）。
// 用法: node tools/e2e_probe.mjs <url> <截图目录>
import { chromium } from 'playwright'

const rawUrl = process.argv[2] ?? 'http://127.0.0.1:4179/'
const url = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'debug' // __whispers 句柄由 ?debug 门控
const outDir = process.argv[3] ?? '/tmp'
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
let errors = 0
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()) } })

const state = () => page.evaluate(() => {
  const s = window.__whispers.sim.state
  const count = (k) => s.world.slots.reduce((n, x) => n + (x && x.kind === k ? x.count : 0), 0)
  return {
    pos: s.player.pos,
    wood: count('wood'), fluorite: count('fluorite'), sapling: count('sapling'), post: count('lanternPost'),
    torch: count('torch'),
    slot0: s.world.slots[0], selected: s.world.selected,
    nodes: s.world.nodes.length, drops: s.world.drops.length, plantings: s.world.plantings.length,
    posts: s.world.posts.length, campfires: s.world.campfires.length, torches: s.world.plantedTorches.length,
    clock: s.world.clock, phantom: s.world.phantom.mode,
    fedAge: s.world.campfires[0] ? s.time - s.world.campfires[0].fedAt : -1,
    hp: s.world.hp, serenity: s.world.serenity, lost: s.world.lost,
  }
})
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('[shot]', name) }
const assert = (cond, msg) => { if (!cond) { console.log('[FAIL]', msg); process.exitCode = 1 } else console.log('[ok]', msg) }
/** 玩家恒居屏幕中心：世界坐标 → 屏幕像素 */
const toScreen = async (xM, yM) => {
  const p = await page.evaluate(() => window.__whispers.sim.state.player.pos)
  return { x: 640 + (xM - p.x) * 48, y: 360 + (yM - p.y) * 48 }
}
/** 条件走位：朝方向键走直到谓词满足（首秒解码卡顿会吞帧，定时走位不可靠） */
const walkUntil = async (keys, predSrc, maxIter = 40) => {
  for (const k of keys) await page.keyboard.down(k)
  for (let i = 0; i < maxIter; i++) {
    await page.waitForTimeout(150)
    if (await page.evaluate(predSrc)) break
  }
  for (const k of keys) await page.keyboard.up(k)
  await page.waitForTimeout(250)
}

page.setDefaultTimeout(60000) // 容器多会话争抢 CPU 时帧率骤降,宽限所有动作
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500) // 首秒解码+争抢双重卡顿沉降
await page.click('text=开始游戏') // 主菜单起手（点击手势顺带解锁音频）
await page.waitForTimeout(1200)

// 1) 出生态：斧头开局、满血、9 节点
let s = await state()
assert(s.slot0 && s.slot0.kind === 'axe' && s.selected === 0, `开局斧头选中 (${JSON.stringify(s.slot0)})`)
assert(s.nodes === 9 && s.drops === 0 && s.hp === 100, `出生态 nodes=9 drops=0 hp=100`)

// 2) 走向树0（中档 12.5,13）
await walkUntil(['KeyW', 'KeyA'], `(() => {
  const p = window.__whispers.sim.state.player.pos
  return Math.hypot(p.x - 12.5, p.y - 13) < 1.25
})()`)
s = await state()
assert(Math.hypot(s.pos.x - 12.5, s.pos.y - 13) < 1.6, `走到树0 交互半径内`)

// 3) 长按连砍采空树0（4 次），松开；断言节点破坏与掉落物产生
await page.mouse.move(640, 300) // 指针置角色上方，挥砍朝向稳定
await page.mouse.down()
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(200)
  const gone = await page.evaluate(() => !window.__whispers.sim.state.world.nodes.some((n) => n.id === 0))
  if (gone) break
}
await page.mouse.up()
await page.waitForTimeout(400)
await shot('e2e-1-tree-broken')
s = await state()
assert(s.nodes === 8, `树0 破坏节点移除 (nodes=${s.nodes})`)
assert(s.wood + s.drops >= 4, `掉落产生（含树苗 roll） wood=${s.wood} drops=${s.drops}`)

// 4) 扫拾掉落：绕树位画个小圈
await walkUntil(['KeyW'], `(() => window.__whispers.sim.state.world.drops.length === 0)()`, 10)
await walkUntil(['KeyA'], `(() => window.__whispers.sim.state.world.drops.length === 0)()`, 6)
await walkUntil(['KeyS'], `(() => window.__whispers.sim.state.world.drops.length === 0)()`, 8)
await walkUntil(['KeyD'], `(() => window.__whispers.sim.state.world.drops.length === 0)()`, 8)
s = await state()
assert(s.wood >= 4, `掉落木材已拾取 (wood=${s.wood})`)

// 5) 注入配方材料，开背包点真实"合成"按钮（终审#7：走用户路径而非 queueAction 直灌）
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const slots = [...sim.state.world.slots]
  slots[2] = { kind: 'wood', count: 10 } // 槽1是开局火把×2,夜段要用,勿覆盖
  slots[3] = { kind: 'fluorite', count: 5 }
  sim.state = { ...sim.state, world: { ...sim.state.world, slots } }
})
await page.keyboard.press('KeyE')
await page.waitForTimeout(400)
// 背包面板居中(494x350)，配方按钮位于面板内 (16, 40+4*52+24)，点按钮左段
await page.mouse.click(640 - 247 + 16 + 40, 360 - 175 + 272 + 15)
await page.waitForTimeout(400)
s = await state()
assert(s.post >= 1, `真实按钮点击合成得提灯柱 (post=${s.post})`)
await page.keyboard.press('KeyE') // 关背包
await page.waitForTimeout(200)

// 6) 找到提灯柱所在热键格（扣费清格后产出落首空格，位置随拾取历史浮动），数字键选中，右键放置
const postIdx = await page.evaluate(() =>
  window.__whispers.sim.state.world.slots.findIndex((x) => x && x.kind === 'lanternPost'))
assert(postIdx >= 0 && postIdx < 9, `提灯柱落在热键区 (idx=${postIdx})`)
await page.keyboard.press(`Digit${postIdx + 1}`)
await page.waitForTimeout(200)
s = await state()
assert(s.selected === postIdx, `数字键选中提灯柱格 (selected=${s.selected})`)
const target = await page.evaluate(() => {
  const p = window.__whispers.sim.state.player.pos
  return { x: p.x + 1.6, y: p.y }
})
const scr = await toScreen(target.x, target.y)
await page.mouse.move(scr.x, scr.y)
await page.waitForTimeout(250)
await shot('e2e-2-place-ghost')
await page.mouse.click(scr.x, scr.y, { button: 'right' })
await page.waitForTimeout(300)
s = await state()
assert(s.posts === 1, `右键放置提灯柱落地 (posts=${s.posts})`)
await shot('e2e-3-post-placed')

// 7) 种树闭环：注入树苗→选中→右键种下→快进 90s→长成小树
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const slots = [...sim.state.world.slots]
  slots[4] = { kind: 'sapling', count: 1 }
  sim.state = { ...sim.state, world: { ...sim.state.world, slots } }
})
await page.keyboard.press('Digit5')
await page.waitForTimeout(200)
const t2 = await page.evaluate(() => {
  const p = window.__whispers.sim.state.player.pos
  return { x: p.x - 1.6, y: p.y + 0.6 }
})
const scr2 = await toScreen(t2.x, t2.y)
await page.mouse.move(scr2.x, scr2.y)
for (let a = 0; a < 4; a++) { // 争抢冻结帧可能吞点击:轮询+补击
  await page.mouse.click(scr2.x, scr2.y, { button: 'right' })
  await page.waitForTimeout(400)
  s = await state()
  if (s.plantings === 1) break
}
assert(s.plantings === 1 && s.sapling === 0, `树苗种下 (plantings=${s.plantings})`)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const w = sim.state.world
  sim.state = {
    ...sim.state,
    world: { ...w, plantings: w.plantings.map((p) => ({ ...p, plantedAt: sim.state.time - 90 })) },
  }
})
await page.waitForTimeout(400)
s = await state()
assert(s.plantings === 0 && s.nodes === 9, `90s 长成小树 (nodes=${s.nodes})`)
await shot('e2e-4-sapling-grown')

// 8) 背包面板开合冒烟
await page.keyboard.press('KeyE')
await page.waitForTimeout(300)
await shot('e2e-5-bag-open')
await page.keyboard.press('KeyE')
await page.waitForTimeout(200)

// 9) 白昼契约：安宁平回升(+1.5/s)、幻影日间退场(gone 不返场)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 60 } }
})
for (let a = 0; a < 8; a++) { // 条件轮询:负载尖峰下 sim 步进可能滞后
  await page.waitForTimeout(400)
  s = await state()
  if (s.serenity > 60.3) break
}
assert(s.clock < 240, `仍在白昼相位 (clock=${s.clock.toFixed(1)})`)
assert(s.serenity > 60.3 && s.serenity < 100, `白昼安宁平回升 (serenity=${s.serenity.toFixed(1)})`)
assert(s.phantom === 'gone', `白昼幻影退场 (phantom=${s.phantom})`)

// 10) 动作队列合成火把(2木→2支,叠上开局2支),数字键持炬
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const slots = [...sim.state.world.slots]
  slots[2] = { kind: 'wood', count: 14 } // 后续开销:火把-2/篝火-8/添柴-1
  slots[3] = { kind: 'fluorite', count: 2 }
  sim.state = { ...sim.state, world: { ...sim.state.world, slots } }
  sim.queueAction({ type: 'craft', recipe: 1 })
})
for (let a = 0; a < 6; a++) {
  await page.waitForTimeout(400)
  s = await state()
  if (s.torch === 4) break
}
assert(s.torch === 4, `动作队列合成火把 2木→2支 (torch=${s.torch})`)
const torchIdx = await page.evaluate(() =>
  window.__whispers.sim.state.world.slots.findIndex((x) => x && x.kind === 'torch'))
assert(torchIdx >= 0 && torchIdx < 9, `火把在热键区 (idx=${torchIdx})`)
await page.keyboard.press(`Digit${torchIdx + 1}`)
await page.waitForTimeout(200)

// 11) 移师古石圈:离提灯柱光圈(5m)足够远,夜段光源语义不被它污染
await walkUntil(['KeyS', 'KeyD'], `(() => {
  const p = window.__whispers.sim.state.player.pos
  return Math.hypot(p.x - 20, p.y - 19) < 2.2
})()`)
const dPost = await page.evaluate(() => {
  const st = window.__whispers.sim.state
  const post = st.world.posts[0]
  return Math.hypot(st.player.pos.x - post.x, st.player.pos.y - post.y)
})
assert(dPost > 5.2, `已脱离提灯柱光圈 (d=${dPost.toFixed(1)}m)`)

// 12) 时钟注入黄昏末梢→自然跨过 300s 入夜(真实相位事件),持炬安宁上行(+5/s)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, clock: 299.5, serenity: 50 } }
})
for (let a = 0; a < 8; a++) {
  await page.waitForTimeout(400)
  s = await state()
  if (s.clock % 480 >= 300 && s.serenity > 51) break
}
assert(s.clock % 480 >= 300, `已入夜 (clock=${s.clock.toFixed(1)})`)
assert(s.selected === torchIdx && s.serenity > 51, `夜晚持炬安宁上行 (serenity=${s.serenity.toFixed(1)})`)
await shot('e2e-7-night-torch')

// 13) 右键插地火把→litAt 回拨注入燃尽(沿用树苗速生锚点,不跳全局 time)
// 走位落点受争抢冻结漂移,可能贴着古石(0.8m 间距拒放):每次补击换一个偏移方向
const tOffsets = [{ x: 0, y: -1.8 }, { x: -1.8, y: -0.8 }, { x: 1.8, y: 0.8 }, { x: 0, y: 1.8 }]
for (let a = 0; a < tOffsets.length; a++) {
  const p = await page.evaluate(() => window.__whispers.sim.state.player.pos)
  const scrT = await toScreen(p.x + tOffsets[a].x, p.y + tOffsets[a].y)
  await page.mouse.move(scrT.x, scrT.y)
  await page.mouse.click(scrT.x, scrT.y, { button: 'right' })
  await page.waitForTimeout(400)
  s = await state()
  if (s.torches === 1) break
}
assert(s.torches === 1 && s.torch === 3, `火把插地 (planted=${s.torches} 剩${s.torch}支)`)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const w = sim.state.world
  sim.state = { ...sim.state, world: { ...w, plantedTorches: w.plantedTorches.map((t) => ({ ...t, litAt: t.litAt - 91 })) } }
})
for (let a = 0; a < 6; a++) {
  await page.waitForTimeout(400)
  s = await state()
  if (s.torches === 0) break
}
assert(s.torches === 0, `插地火把 90s 燃尽消失 (planted=${s.torches})`)

// 14) 动作队列合成篝火(8木2萤)→放置→燃着圈内血量回复(固定篝火已废,用例迁此)
await page.evaluate(() => { window.__whispers.sim.queueAction({ type: 'craft', recipe: 2 }) })
let cfIdx = -1
for (let a = 0; a < 6; a++) {
  await page.waitForTimeout(400)
  cfIdx = await page.evaluate(() =>
    window.__whispers.sim.state.world.slots.findIndex((x) => x && x.kind === 'campfire'))
  if (cfIdx >= 0) break
}
assert(cfIdx >= 0 && cfIdx < 9, `篝火在热键区 (idx=${cfIdx})`)
await page.keyboard.press(`Digit${cfIdx + 1}`)
await page.waitForTimeout(200)
// 偏移轮换同步骤13;幅度 1.5~2.3m:置于残烬圈(1.2m)外、放置圈(3m)与回血/添柴圈内
const cOffsets = [{ x: -1.5, y: 0 }, { x: -2.2, y: 0.6 }, { x: -0.6, y: -2.2 }, { x: 2.2, y: 0 }]
for (let a = 0; a < cOffsets.length; a++) {
  const p = await page.evaluate(() => window.__whispers.sim.state.player.pos)
  const scrC = await toScreen(p.x + cOffsets[a].x, p.y + cOffsets[a].y)
  await page.mouse.move(scrC.x, scrC.y)
  await page.mouse.click(scrC.x, scrC.y, { button: 'right' })
  await page.waitForTimeout(400)
  s = await state()
  if (s.campfires === 1) break
}
assert(s.campfires === 1, `篝火落地燃起 (campfires=${s.campfires})`)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, hp: 40 } }
})
for (let a = 0; a < 10; a++) { // 条件轮询:负载尖峰下 sim 步进可能滞后
  await page.waitForTimeout(500)
  s = await state()
  if (s.hp > 42) break
}
assert(s.hp > 42 && s.hp <= 100, `燃着篝火圈内血量回复 (hp=${s.hp.toFixed(1)})`)
await shot('e2e-8-campfire-night')

// 15) fedAt 回拨→残烬;无光黑夜安宁下坠;持木添柴复燃回满
await page.evaluate(() => {
  const sim = window.__whispers.sim
  const w = sim.state.world
  sim.state = { ...sim.state, world: { ...w, campfires: w.campfires.map((c) => ({ ...c, fedAt: c.fedAt - 121 })) } }
})
await page.waitForTimeout(400)
s = await state()
assert(s.fedAge >= 120, `篝火烧尽转残烬 (fedAge=${s.fedAge.toFixed(0)}s)`)
await shot('e2e-9-ember')
await page.keyboard.press('Digit1') // 收起火把:验证无光语义(玩家在残烬圈 1.2m 外)
await page.waitForTimeout(200)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 80 } }
})
for (let a = 0; a < 8; a++) {
  await page.waitForTimeout(400)
  s = await state()
  if (s.serenity < 79.5) break
}
assert(s.serenity < 79.5, `无火把黑夜安宁下坠 (serenity=${s.serenity.toFixed(1)})`)
const woodIdx = await page.evaluate(() =>
  window.__whispers.sim.state.world.slots.findIndex((x) => x && x.kind === 'wood'))
assert(woodIdx >= 0 && woodIdx < 9, `木头在热键区 (idx=${woodIdx})`)
await page.keyboard.press(`Digit${woodIdx + 1}`)
await page.waitForTimeout(200)
const wBefore = (await state()).wood
const cfPos = await page.evaluate(() => window.__whispers.sim.state.world.campfires[0].pos)
const scrF = await toScreen(cfPos.x, cfPos.y)
await page.mouse.move(scrF.x, scrF.y)
for (let a = 0; a < 4; a++) {
  await page.mouse.click(scrF.x, scrF.y, { button: 'right' })
  await page.waitForTimeout(400)
  s = await state()
  if (s.fedAge >= 0 && s.fedAge < 2) break
}
assert(s.wood === wBefore - 1 && s.fedAge < 2, `持木添柴复燃回满 (wood=${s.wood} fedAge=${s.fedAge.toFixed(1)}s)`)

// 16) 迷失往返（滤镜卸载/重挂路径）
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 20 } }
})
await page.waitForTimeout(400)
s = await state()
assert(s.lost === true, `安宁值 20 触发迷失 (lost=${s.lost})`)
await page.waitForTimeout(1000)
await shot('e2e-10-lost')
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 100 } }
})
await page.waitForTimeout(400)
s = await state()
assert(s.lost === false, `安宁值回满解除迷失 (lost=${s.lost})`)
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 20 } }
})
await page.waitForTimeout(400)
s = await state()
assert(s.lost === true, `再入迷失滤镜重挂 (lost=${s.lost})`)

assert(errors === 0, `无页面错误 (errors=${errors})`)
console.log(process.exitCode ? '[E2E] FAIL' : '[E2E] PASS')
await browser.close()
