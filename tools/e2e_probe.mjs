// E2E 行为探针：驱动"走位→采集→合成→放置→迷失"全循环并断言 sim 状态。
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
  return {
    pos: s.player.pos, wood: s.world.inventory.wood, fluorite: s.world.inventory.fluorite,
    tree0: s.world.nodes[0].charges, posts: s.world.posts.length,
    placing: s.world.placing, serenity: s.world.serenity, lost: s.world.lost,
    phantomMode: s.world.phantom.mode,
  }
})
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('[shot]', name) }
const assert = (cond, msg) => { if (!cond) { console.log('[FAIL]', msg); process.exitCode = 1 } else console.log('[ok]', msg) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1) 出生态
let s = await state()
assert(s.wood === 0 && s.tree0 === 4 && s.posts === 0, `出生态 wood=0 tree0=4 posts=0 (${JSON.stringify(s)})`)
assert(Math.abs(s.pos.x - 20) < 0.01 && Math.abs(s.pos.y - 20.8) < 0.01, `出生点 (20,20.8)`)

// 2) 走向树0 (12.5,13)：西北向 2.7s
await page.keyboard.down('KeyW')
await page.keyboard.down('KeyA')
await page.waitForTimeout(2700)
await page.keyboard.up('KeyW')
await page.keyboard.up('KeyA')
await page.waitForTimeout(300)
s = await state()
const dTree = Math.hypot(s.pos.x - 12.5, s.pos.y - 13)
assert(dTree < 1.6, `走到树0 交互半径内 (dist=${dTree.toFixed(2)})`)

// 3) 采集 4 次采空树0
for (let i = 0; i < 4; i++) {
  await page.mouse.click(640, 360)
  await page.waitForTimeout(1500)
}
await shot('e2e-1-tree-depleted')
s = await state()
assert(s.wood === 4, `采集 4 次得 4 木 (wood=${s.wood})`)
assert(s.tree0 === 0, `树0 耗尽 (charges=${s.tree0})`)

// 4) 注入资源，走回篝火合成（合成/放置走真实 E 键）
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, inventory: { wood: 10, fluorite: 5 } } }
})
await page.keyboard.down('KeyS')
await page.keyboard.down('KeyD')
await page.waitForTimeout(2600)
await page.keyboard.up('KeyS')
await page.keyboard.up('KeyD')
await page.waitForTimeout(300)
s = await state()
const dFire = Math.hypot(s.pos.x - 20, s.pos.y - 19)
assert(dFire < 2.5, `回到篝火合成半径内 (dist=${dFire.toFixed(2)})`)
await page.keyboard.press('KeyE')
await page.waitForTimeout(300)
s = await state()
assert(s.placing === true && s.wood === 0, `E 合成扣资源进放置 (placing=${s.placing} wood=${s.wood})`)
await shot('e2e-2-placing-preview')
await page.keyboard.press('KeyE')
await page.waitForTimeout(300)
s = await state()
assert(s.posts === 1 && s.placing === false, `E 放置提灯柱落地 (posts=${s.posts})`)
await page.waitForTimeout(700)
await shot('e2e-3-post-placed')

// 5) 注入低安宁值验证迷失表现
await page.evaluate(() => {
  const sim = window.__whispers.sim
  sim.state = { ...sim.state, world: { ...sim.state.world, serenity: 20 } }
})
await page.waitForTimeout(400)
s = await state()
assert(s.lost === true, `安宁值 20 触发迷失 (lost=${s.lost})`)
await page.waitForTimeout(1200)
await shot('e2e-4-lost-vignette')

// 6) 恢复路径:注入高安宁值退出迷失(滤镜卸载),再入迷失(滤镜重挂)——覆盖 lostExit 分支
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
