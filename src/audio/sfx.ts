import { CONFIG } from '../config'

/** 全程序合成音。所有节点过主低通（迷失=闷化）；风与低鸣为常驻层。 */
export class Sfx {
  private ctx?: AudioContext
  private out?: GainNode
  private lp?: BiquadFilterNode
  private humGain?: GainNode

  unlock(): void {
    if (this.ctx) { this.rearm(); return }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = CONFIG.lost.lowpassOpenHz
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(this.lp).connect(ctx.destination)
    this.out = master
    this.startWind(ctx, master)
    this.startHum(ctx, master)
    // 部分浏览器（如 iOS Safari）键盘手势不授予音频激活，新建即 suspended
    if (ctx.state === 'suspended') ctx.resume().catch(() => {}) // 中断序列下可能 reject,静默即可
  }

  /** 标签页隐藏/系统打断后被挂起的 context 重新拉起 */
  rearm(): void { if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {}) }

  /** 迷失=true 时全局闷化 */
  setMuffled(on: boolean): void {
    if (!this.ctx || !this.lp) return
    this.lp.frequency.setTargetAtTime(on ? CONFIG.lost.lowpassHz : CONFIG.lost.lowpassOpenHz, this.ctx.currentTime, 0.25)
  }

  /** 幻影注视强度 0..1 → 低鸣音量 */
  humLevel(v: number): void {
    if (!this.ctx || !this.humGain) return
    this.humGain.gain.setTargetAtTime(v * 0.1, this.ctx.currentTime, 0.25)
  }

  private startWind(ctx: AudioContext, out: AudioNode): void {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) { // 一阶低通白噪声近似粉噪风声
      last += 0.02 * ((Math.random() * 2 - 1) - last)
      d[i] = last * 3
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const g = ctx.createGain()
    g.gain.value = 0.05
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.025
    lfo.connect(lfoG).connect(g.gain)
    src.connect(lp).connect(g).connect(out)
    src.start()
    lfo.start()
  }

  private startHum(ctx: AudioContext, out: AudioNode): void {
    const g = ctx.createGain()
    g.gain.value = 0
    this.humGain = g
    for (const f of [52, 53.7]) { // 轻微失谐制造拍频压迫感
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.connect(g)
      o.start()
    }
    g.connect(out)
  }

  private noiseBurst(freq: number, dur: number, gainV: number): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gainV, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp).connect(g).connect(this.out)
    src.start()
  }

  private ping(freq: number, dur: number, gainV: number, delay = 0): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gainV, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  footstep(): void { this.noiseBurst(300 + Math.random() * 120, 0.09, 0.12) }

  knock(): void {
    this.noiseBurst(1800, 0.05, 0.1)
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(180, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
    osc.connect(g).connect(this.out)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  }

  /** 幻影消散的轻叹：带通噪声中心频率下滑 */
  sigh(): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const dur = 0.8
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 4
    bp.frequency.setValueAtTime(520, ctx.currentTime)
    bp.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.15)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp).connect(g).connect(this.out)
    src.start()
  }

  pickupWood(): void { this.noiseBurst(260, 0.07, 0.1); this.ping(1320, 0.18, 0.045, 0.02) }
  pickupOre(): void { this.ping(1180, 0.22, 0.06); this.ping(1770, 0.26, 0.045, 0.05) }
  /** 合成成功：风铃琶音 */
  chime(): void { [880, 1174.7, 1318.5, 1760].forEach((f, i) => this.ping(f, 0.5, 0.055, i * 0.09)) }
  placeThump(): void {
    if (!this.ctx || !this.out) return
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(130, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.2, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    o.connect(g).connect(this.out)
    o.start()
    o.stop(ctx.currentTime + 0.3)
    this.ping(1568, 0.4, 0.05, 0.08)
  }
}
