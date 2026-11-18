import { PlayerInputState } from './player';
import { TouchAction, TouchControls } from '../ui/touch';

const JUMP_BUFFER = 0.15;
const SLIDE_BUFFER = 0.16;
const GRAPPLE_BUFFER = 0.18;

export interface InputCallbacks {
  onRestart?: () => void;
  onCheckpointReset?: () => void;
  onPauseToggle?: () => void;
  onNextCourse?: () => void;
  onPointerLockLost?: () => void;
}

export class InputManager {
  private keys = new Set<string>();
  private rmbHeld = false;
  private lmbHeld = false;
  private dragLookActive = false;
  private lastDragX = 0;
  private lastDragY = 0;
  readonly touch: TouchControls;

  private accumDX = 0;
  private accumDY = 0;

  readonly state: PlayerInputState = {
    forward: 0,
    right: 0,
    jumpHeld: false,
    jumpBufferTimer: 0,
    slideHeld: false,
    slideBufferTimer: 0,
    grappleHeld: false,
    grappleBufferTimer: 0,
  };

  pointerLocked = false;
  pointerLockFailed = false;
  gameplayActive = false;
  finishedActive = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: InputCallbacks
  ) {
    const touchHost = document.getElementById('touch-root') ?? document.body;
    this.touch = new TouchControls(touchHost, (action: TouchAction) => {
      if (action === 'pause') this.callbacks.onPauseToggle?.();
      else if (action === 'restart') this.callbacks.onRestart?.();
      else if (action === 'checkpoint') this.callbacks.onCheckpointReset?.();
    });
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
          e.preventDefault();
        }
        return;
      }

      // Pause handling
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.gameplayActive || this.finishedActive) {
          e.preventDefault();
          this.callbacks.onPauseToggle?.();
        }
        return;
      }

      // Finish screen hotkeys
      if (this.finishedActive) {
        if (e.code === 'KeyR') {
          e.preventDefault();
          this.callbacks.onRestart?.();
        } else if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.callbacks.onNextCourse?.();
        }
        return;
      }

      if (!this.gameplayActive) return;

      if (
        [
          'Space',
          'Tab',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'ControlLeft',
          'ShiftLeft',
        ].includes(e.code)
      ) {
        e.preventDefault();
      }

      this.keys.add(e.code);

      if (e.code === 'Space') {
        this.state.jumpBufferTimer = JUMP_BUFFER;
      } else if (
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight' ||
        e.code === 'KeyC' ||
        e.code === 'ControlLeft'
      ) {
        this.state.slideBufferTimer = SLIDE_BUFFER;
      } else if (e.code === 'KeyE') {
        this.state.grappleBufferTimer = GRAPPLE_BUFFER;
      } else if (e.code === 'KeyR') {
        this.callbacks.onRestart?.();
      } else if (e.code === 'KeyF') {
        this.callbacks.onCheckpointReset?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.clearInputs();
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.gameplayActive) return;
      if (this.touch.enabled) return;

      // Acquire pointer lock if not yet locked
      if (!this.pointerLocked) {
        this.requestLock();
      }

      if (e.button === 2) {
        e.preventDefault();
        this.rmbHeld = true;
        this.state.grappleBufferTimer = GRAPPLE_BUFFER;
      } else if (e.button === 0) {
        if (this.pointerLocked) {
          // Left click also fires grapple when locked for super intuitive feel
          this.lmbHeld = true;
          this.state.grappleBufferTimer = GRAPPLE_BUFFER;
        } else {
          // Seamless click-drag look fallback if browser blocks pointer lock in iframe
          this.dragLookActive = true;
          this.lastDragX = e.clientX;
          this.lastDragY = e.clientY;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rmbHeld = false;
      if (e.button === 0) {
        this.lmbHeld = false;
        this.dragLookActive = false;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.gameplayActive) return;
      if (this.pointerLocked) {
        // Guard against rare browser pointer-lock spike outliers
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.accumDX += e.movementX;
          this.accumDY += e.movementY;
        }
      } else if (this.dragLookActive) {
        this.accumDX += (e.clientX - this.lastDragX) * 1.4;
        this.accumDY += (e.clientY - this.lastDragY) * 1.4;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.pointerLockFailed = false;
        this.dragLookActive = false;
      } else if (wasLocked && this.gameplayActive && !this.touch.enabled) {
        // User pressed ESC to release pointer lock -> open pause menu cleanly
        this.clearInputs();
        this.callbacks.onPointerLockLost?.();
      }
    });

    document.addEventListener('pointerlockerror', () => {
      this.pointerLockFailed = true;
    });
  }

  requestLock(): void {
    if (this.touch.enabled) {
      this.pointerLockFailed = false;
      return;
    }
    try {
      const maybePromise = this.canvas.requestPointerLock?.() as unknown as
        | Promise<void>
        | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          this.pointerLockFailed = true;
        });
      }
    } catch {
      this.pointerLockFailed = true;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore
      }
    }
    this.pointerLocked = false;
  }

  clearInputs(): void {
    this.keys.clear();
    this.rmbHeld = false;
    this.lmbHeld = false;
    this.dragLookActive = false;
    this.accumDX = 0;
    this.accumDY = 0;
    this.state.forward = 0;
    this.state.right = 0;
    this.state.jumpHeld = false;
    this.state.jumpBufferTimer = 0;
    this.state.slideHeld = false;
    this.state.slideBufferTimer = 0;
    this.state.grappleHeld = false;
    this.state.grappleBufferTimer = 0;
  }

  consumeLookDelta(sensitivity: number, dt: number): [number, number] {
    const baseRadPerPx = 0.0021 * sensitivity;
    const [tdx, tdy] = this.touch.consumeLook();
    let dYaw = -(this.accumDX + tdx * 1.35) * baseRadPerPx;
    let dPitch = -(this.accumDY + tdy * 1.35) * baseRadPerPx;
    this.accumDX = 0;
    this.accumDY = 0;

    // Optional arrow-key look support (great for accessibility / fallback)
    if (this.gameplayActive) {
      const keyTurn = 2.15 * sensitivity * dt;
      if (this.keys.has('ArrowLeft')) dYaw += keyTurn;
      if (this.keys.has('ArrowRight')) dYaw -= keyTurn;
      if (this.keys.has('ArrowUp')) dPitch += keyTurn * 0.7;
      if (this.keys.has('ArrowDown')) dPitch -= keyTurn * 0.7;
    }

    return [dYaw, dPitch];
  }

  tickFixed(dt: number): void {
    const w = this.keys.has('KeyW') ? 1 : 0;
    const s = this.keys.has('KeyS') ? 1 : 0;
    const d = this.keys.has('KeyD') ? 1 : 0;
    const a = this.keys.has('KeyA') ? 1 : 0;

    const touch = this.touch.snapshot();
    this.state.forward = clampAxis((w - s) + touch.forward);
    this.state.right = clampAxis((d - a) + touch.right);
    this.state.jumpHeld = this.keys.has('Space') || touch.jumpHeld;
    this.state.slideHeld =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('KeyC') ||
      this.keys.has('ControlLeft') ||
      touch.slideHeld;
    this.state.grappleHeld =
      this.keys.has('KeyE') || this.rmbHeld || this.lmbHeld || touch.grappleHeld;

    if (this.touch.takeJumpPress()) this.state.jumpBufferTimer = JUMP_BUFFER;
    if (this.touch.takeSlidePress()) this.state.slideBufferTimer = SLIDE_BUFFER;
    if (this.touch.takeGrapplePress()) this.state.grappleBufferTimer = GRAPPLE_BUFFER;

    this.state.jumpBufferTimer = Math.max(0, this.state.jumpBufferTimer - dt);
    this.state.slideBufferTimer = Math.max(0, this.state.slideBufferTimer - dt);
    this.state.grappleBufferTimer = Math.max(0, this.state.grappleBufferTimer - dt);
  }
}

function clampAxis(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
