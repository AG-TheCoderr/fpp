export type TouchAction = 'jump' | 'slide' | 'grapple' | 'pause' | 'restart' | 'checkpoint';

export interface TouchInputSnapshot {
  forward: number;
  right: number;
  jumpHeld: boolean;
  slideHeld: boolean;
  grappleHeld: boolean;
  lookDX: number;
  lookDY: number;
}

export function detectTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/**
 * Brutalist on-screen parkour pad: left analog stick, right look-drag,
 * JUMP / SLIDE / GRAPPLE, plus pause / restart / checkpoint.
 */
export class TouchControls {
  readonly root: HTMLElement;
  readonly enabled: boolean;

  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private lookPad: HTMLElement;

  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private stickX = 0;
  private stickY = 0;
  private lookLastX = 0;
  private lookLastY = 0;
  private lookDX = 0;
  private lookDY = 0;

  private jumpHeld = false;
  private slideHeld = false;
  private grappleHeld = false;
  private jumpPressed = false;
  private slidePressed = false;
  private grapplePressed = false;

  private onAction: (action: TouchAction) => void;

  constructor(host: HTMLElement, onAction: (action: TouchAction) => void) {
    this.enabled = detectTouchPrimary();
    this.onAction = onAction;
    this.root = document.createElement('div');
    this.root.id = 'touch-hud';
    this.root.className = 'touch-hud';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="touch-look" id="touch-look"></div>
      <div class="touch-stick" id="touch-stick">
        <div class="touch-stick-ring"></div>
        <div class="touch-stick-knob" id="touch-knob"></div>
      </div>
      <div class="touch-actions">
        <button type="button" class="touch-btn touch-btn-jump" data-act="jump">JUMP</button>
        <button type="button" class="touch-btn touch-btn-slide" data-act="slide">SLIDE</button>
        <button type="button" class="touch-btn touch-btn-grapple" data-act="grapple">HOOK</button>
      </div>
      <div class="touch-sys">
        <button type="button" class="touch-sys-btn" data-act="pause">II</button>
        <button type="button" class="touch-sys-btn" data-act="restart">R</button>
        <button type="button" class="touch-sys-btn" data-act="checkpoint">F</button>
      </div>
    `;
    host.appendChild(this.root);

    this.stickBase = this.root.querySelector('#touch-stick')!;
    this.stickKnob = this.root.querySelector('#touch-knob')!;
    this.lookPad = this.root.querySelector('#touch-look')!;

    if (!this.enabled) return;
    document.documentElement.classList.add('is-touch');
    this.bind();
  }

  setActive(active: boolean): void {
    if (!this.enabled) return;
    this.root.hidden = !active;
    if (!active) this.reset();
  }

  consumeLook(): [number, number] {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return [dx, dy];
  }

  snapshot(): TouchInputSnapshot {
    const mag = Math.hypot(this.stickX, this.stickY);
    let fx = 0;
    let fy = 0;
    if (mag > 0.14) {
      const k = Math.min(1, (mag - 0.14) / 0.86);
      fx = (this.stickX / mag) * k;
      fy = (this.stickY / mag) * k;
    }
    return {
      forward: -fy,
      right: fx,
      jumpHeld: this.jumpHeld,
      slideHeld: this.slideHeld,
      grappleHeld: this.grappleHeld,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
    };
  }

  takeJumpPress(): boolean {
    const v = this.jumpPressed;
    this.jumpPressed = false;
    return v;
  }

  takeSlidePress(): boolean {
    const v = this.slidePressed;
    this.slidePressed = false;
    return v;
  }

  takeGrapplePress(): boolean {
    const v = this.grapplePressed;
    this.grapplePressed = false;
    return v;
  }

  private bind(): void {
    this.stickBase.addEventListener('pointerdown', (e) => this.onStickDown(e), { passive: false });
    this.lookPad.addEventListener('pointerdown', (e) => this.onLookDown(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));

    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      const act = btn.dataset.act as TouchAction;
      const hold = act === 'jump' || act === 'slide' || act === 'grapple';
      btn.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          btn.setPointerCapture(e.pointerId);
          btn.classList.add('is-down');
          if (act === 'jump') {
            this.jumpHeld = true;
            this.jumpPressed = true;
          } else if (act === 'slide') {
            this.slideHeld = true;
            this.slidePressed = true;
          } else if (act === 'grapple') {
            this.grappleHeld = true;
            this.grapplePressed = true;
          } else {
            this.onAction(act);
          }
        },
        { passive: false }
      );
      const release = () => {
        btn.classList.remove('is-down');
        if (act === 'jump') this.jumpHeld = false;
        if (act === 'slide') this.slideHeld = false;
        if (act === 'grapple') this.grappleHeld = false;
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      if (!hold) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
        });
      }
    });
  }

  private onStickDown(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    const r = this.stickBase.getBoundingClientRect();
    this.stickOriginX = r.left + r.width * 0.5;
    this.stickOriginY = r.top + r.height * 0.5;
    this.updateStick(e.clientX, e.clientY);
  }

  private onLookDown(e: PointerEvent): void {
    if (this.lookId !== null) return;
    e.preventDefault();
    this.lookId = e.pointerId;
    this.lookLastX = e.clientX;
    this.lookLastY = e.clientY;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.lookDX += e.clientX - this.lookLastX;
      this.lookDY += e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickX = 0;
      this.stickY = 0;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    }
    if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  private updateStick(x: number, y: number): void {
    const max = 54;
    let dx = x - this.stickOriginX;
    let dy = y - this.stickOriginY;
    const mag = Math.hypot(dx, dy);
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    this.stickX = dx / max;
    this.stickY = dy / max;
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
  }

  private reset(): void {
    this.stickId = null;
    this.lookId = null;
    this.stickX = 0;
    this.stickY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.jumpHeld = false;
    this.slideHeld = false;
    this.grappleHeld = false;
    this.jumpPressed = false;
    this.slidePressed = false;
    this.grapplePressed = false;
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    this.root.querySelectorAll('.is-down').forEach((el) => el.classList.remove('is-down'));
  }
}
