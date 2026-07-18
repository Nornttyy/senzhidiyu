export function intentFromKeys(keys: ReadonlySet<string>): { moveX: number; moveY: number } {
  const has = (...codes: string[]) => codes.some((c) => keys.has(c))
  const moveX = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0)
  const moveY = (has('KeyS', 'ArrowDown') ? 1 : 0) - (has('KeyW', 'ArrowUp') ? 1 : 0)
  return { moveX, moveY }
}

export class Keyboard {
  private keys = new Set<string>()
  private interactPressed = false
  private unlocked = false
  onFirstKey?: () => void

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if (!this.unlocked) { this.unlocked = true; this.onFirstKey?.() }
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'KeyE') this.interactPressed = true
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    target.addEventListener('blur', () => this.keys.clear())
  }

  intent(): { moveX: number; moveY: number } { return intentFromKeys(this.keys) }

  consumeInteract(): boolean {
    const v = this.interactPressed
    this.interactPressed = false
    return v
  }
}
