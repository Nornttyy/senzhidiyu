/** 主菜单/暂停菜单：DOM 覆盖层（canvas 之上），活的夜景世界作背景。
 * 视图状态机：main | pause | help | settings | credits；help/settings/credits
 * 记录来源视图，返回时回到正确的上级。 */

export type MenuView = 'main' | 'pause' | 'help' | 'settings' | 'credits'

export interface MenuCallbacks {
  onStart(): void                 // 主菜单点开始（首次，用户手势→解锁音频）
  onResume(): void                // 暂停菜单点继续
  onBackToTitle(): void           // 暂停菜单回主菜单
  onVolume(v: number): void       // 0..1
  onInk(on: boolean): void        // 手作质感开关
}

const CSS = `
#wm-menu { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 9, 6, 0.42); font-family: "Songti SC", "Noto Serif CJK SC", "SimSun", serif;
  color: #d8d2bd; user-select: none; }
#wm-menu.hidden { display: none; }
#wm-menu .panel { text-align: center; padding: 2.2rem 3.4rem; background: rgba(12, 16, 11, 0.72);
  border: 1px solid rgba(216, 210, 189, 0.22); border-radius: 3px; box-shadow: 0 0 60px rgba(0,0,0,0.55);
  min-width: 20rem; }
#wm-menu h1 { font-size: 2.6rem; letter-spacing: 0.55rem; margin: 0 0 0.4rem; font-weight: 600;
  text-shadow: 0 0 18px rgba(255, 214, 140, 0.25); }
#wm-menu .sub { font-size: 0.8rem; letter-spacing: 0.28rem; opacity: 0.55; margin-bottom: 1.8rem; }
#wm-menu button { display: block; margin: 0.55rem auto; padding: 0.5rem 2.4rem; font: inherit;
  font-size: 1.05rem; letter-spacing: 0.35rem; color: #d8d2bd; background: transparent;
  border: 1px solid rgba(216, 210, 189, 0.35); border-radius: 2px; cursor: pointer; }
#wm-menu button:hover { background: rgba(216, 210, 189, 0.12); border-color: rgba(255, 220, 150, 0.6);
  color: #ffe9c0; }
#wm-menu .body { font-size: 0.95rem; line-height: 2; letter-spacing: 0.12rem; text-align: left;
  margin: 0 0 1.2rem; opacity: 0.92; }
#wm-menu .row { display: flex; align-items: center; gap: 1rem; justify-content: space-between; margin: 1rem 0; }
#wm-menu input[type=range] { width: 10rem; accent-color: #d8b26a; }
#wm-menu .small { font-size: 0.75rem; opacity: 0.5; margin-top: 1.4rem; letter-spacing: 0.15rem; }
`

export class Menu {
  private root: HTMLDivElement
  private view: MenuView = 'main'
  private from: 'main' | 'pause' = 'main'
  private started = false
  private volume = 0.9
  private ink = true

  constructor(private cb: MenuCallbacks) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'wm-menu'
    document.body.appendChild(this.root)
    this.render()
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden') }
  get hasStarted(): boolean { return this.started }

  /** ESC：游戏中呼出暂停；菜单内等效"返回/继续" */
  togglePause(): void {
    if (!this.started) return
    if (this.isOpen) {
      if (this.view === 'help' || this.view === 'settings' || this.view === 'credits') { this.show(this.from); return }
      this.hide(); this.cb.onResume()
    } else {
      this.show('pause')
    }
  }

  show(view: MenuView): void {
    this.view = view
    if (view === 'main' || view === 'pause') this.from = view
    this.root.classList.remove('hidden')
    this.render()
  }

  hide(): void { this.root.classList.add('hidden') }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  private render(): void {
    this.root.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'panel'
    const add = (el: HTMLElement) => panel.appendChild(el)

    if (this.view === 'main' || this.view === 'pause') {
      const h1 = document.createElement('h1')
      h1.textContent = this.view === 'main' ? '森之低语' : '暂　停'
      add(h1)
      if (this.view === 'main') {
        const sub = document.createElement('div')
        sub.className = 'sub'
        sub.textContent = 'WHISPERS OF THE WOODS'
        add(sub)
        add(this.button('开始游戏', () => { this.started = true; this.hide(); this.cb.onStart() }))
      } else {
        add(this.button('继续', () => { this.hide(); this.cb.onResume() }))
      }
      add(this.button('操作说明', () => this.show('help')))
      add(this.button('设置', () => this.show('settings')))
      if (this.view === 'main') add(this.button('制作名单', () => this.show('credits')))
      else add(this.button('回主菜单', () => this.cb.onBackToTitle()))
      if (this.view === 'main') {
        const s = document.createElement('div')
        s.className = 'small'
        s.textContent = '夜很深，跟随微光。'
        add(s)
      }
    } else if (this.view === 'help') {
      const body = document.createElement('div')
      body.className = 'body'
      body.innerHTML = 'WASD / 方向键 —— 移动<br>鼠标左键（可长按）—— 手持斧头朝指针方向挥砍，挖完才会掉落<br>数字键 1-9 / 滚轮 —— 切换热键栏<br>E —— 打开背包（点格子搬移，材料够可合成提灯柱）<br>鼠标右键 —— 在白圈内放置提灯柱 / 种下树苗<br><br>黑暗与幻影的注视会消磨安宁，回到灯火旁恢复。<br>攒够 10 木 5 萤，把光种进森林里。'
      add(body)
      add(this.button('返回', () => this.show(this.from)))
    } else if (this.view === 'settings') {
      const rowV = document.createElement('div')
      rowV.className = 'row'
      rowV.innerHTML = '<span>音量</span>'
      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'; slider.max = '1'; slider.step = '0.05'
      slider.value = String(this.volume)
      slider.addEventListener('input', () => { this.volume = Number(slider.value); this.cb.onVolume(this.volume) })
      rowV.appendChild(slider)
      add(rowV)
      const rowI = document.createElement('div')
      rowI.className = 'row'
      rowI.innerHTML = '<span>手作质感</span>'
      const ink = document.createElement('input')
      ink.type = 'checkbox'
      ink.checked = this.ink
      ink.addEventListener('change', () => { this.ink = ink.checked; this.cb.onInk(this.ink) })
      rowI.appendChild(ink)
      add(rowI)
      add(this.button('返回', () => this.show(this.from)))
    } else {
      const body = document.createElement('div')
      body.className = 'body'
      body.style.textAlign = 'center'
      body.innerHTML = '制作 —— Nornttyy<br>美术生成 —— 千问 AI<br>程序协力 —— Claude<br><br>《森之低语》切片 A'
      add(body)
      add(this.button('返回', () => this.show(this.from)))
    }
    this.root.appendChild(panel)
  }
}
