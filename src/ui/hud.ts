import * as THREE from 'three';
import {
  clearAllRecords,
  formatSplit,
  formatTime,
  loadAllRecords,
} from '../storage';
import { Player } from '../game/player';
import { requestAppFullscreen } from './display';
import {
  CourseDef,
  GameScreen,
  KeyPromptDef,
  MoveState,
  Rank,
  Settings,
} from '../types';

export interface FinishSummary {
  course: CourseDef;
  time: number;
  rank: Rank;
  isNewBest: boolean;
  prevBest: number | null;
  peakSpeed: number;
  hasNext: boolean;
}

export interface UICallbacks {
  onPlayCourse: (index: number) => void;
  onPreviewCourse: (index: number) => void;
  onResume: () => void;
  onRestart: () => void;
  onCheckpoint: () => void;
  onNextCourse: () => void;
  onGoTitle: () => void;
  onGoCourses: () => void;
  onSettingsChange: (settings: Settings) => void;
  onRecordsCleared: () => void;
  onUiSound: (accent?: boolean) => void;
}

type SubPanel = 'none' | 'controls' | 'settings';

const STATE_BADGE: Partial<Record<MoveState, string>> = {
  slide: 'SLIDE',
  wallrun: 'WALL',
  vault: 'VAULT',
  mantle: 'CLIMB',
  grapple: 'SWING',
};

export class GameUI {
  private screen: GameScreen = 'title';
  private subPanel: SubPanel = 'none';
  private selectedCourseIdx = 0;

  // Live HUD DOM references for zero-allocation 60/120fps updates
  private hudTimerEl: HTMLElement | null = null;
  private hudSplitEl: HTMLElement | null = null;
  private hudSpeedValEl: HTMLElement | null = null;
  private hudSpeedFillEl: HTMLElement | null = null;
  private hudStateEl: HTMLElement | null = null;
  private hudCrosshairEl: HTMLElement | null = null;
  private hudGrappleEl: HTMLElement | null = null;
  private hudPromptEl: HTMLElement | null = null;
  private hudPromptKeyEl: HTMLElement | null = null;
  private hudPromptActEl: HTMLElement | null = null;
  private hudCpEl: HTMLElement | null = null;
  private hudLockEl: HTMLElement | null = null;
  private hudFpsEl: HTMLElement | null = null;

  private splitHideTimer = 0;
  private projVec = new THREE.Vector3();
  private lastTimer = '';
  private lastSpd = -1;
  private lastState = '';
  private lastCp = '';
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsShown = 0;

  constructor(
    private root: HTMLElement,
    private courses: CourseDef[],
    private settings: Settings,
    private cb: UICallbacks
  ) {}

  showTitle(courseIndex: number): void {
    this.screen = 'title';
    this.subPanel = 'none';
    this.selectedCourseIdx = courseIndex;
    this.clearHudRefs();
    this.renderTitle();
  }

  showCourses(courseIndex: number): void {
    this.screen = 'courses';
    this.subPanel = 'none';
    this.selectedCourseIdx = courseIndex;
    this.clearHudRefs();
    this.renderCourses();
  }

  showPlaying(course: CourseDef, courseIndex: number): void {
    this.screen = 'playing';
    this.subPanel = 'none';
    this.selectedCourseIdx = courseIndex;
    this.splitHideTimer = 0;
    this.renderHud(course);
  }

  showPaused(course: CourseDef): void {
    this.screen = 'paused';
    this.subPanel = 'none';
    this.clearHudRefs();
    this.renderPause(course);
  }

  showFinished(summary: FinishSummary): void {
    this.screen = 'finished';
    this.subPanel = 'none';
    this.clearHudRefs();
    this.renderFinish(summary);
  }

  flashSplit(delta: number | null, cpNumber: number): void {
    if (!this.hudSplitEl) return;
    this.hudSplitEl.classList.remove('is-ahead', 'is-behind', 'is-neutral');
    if (delta === null) {
      this.hudSplitEl.textContent = `CP ${cpNumber}`;
      this.hudSplitEl.classList.add('is-neutral');
    } else if (delta <= 0) {
      this.hudSplitEl.textContent = formatSplit(delta);
      this.hudSplitEl.classList.add('is-ahead');
    } else {
      this.hudSplitEl.textContent = formatSplit(delta);
      this.hudSplitEl.classList.add('is-behind');
    }
    this.hudSplitEl.classList.add('is-visible');
    this.splitHideTimer = 1.9;
  }

  updateHud(
    player: Player,
    course: CourseDef,
    camera: THREE.Camera,
    pointerLocked: boolean,
    pointerLockFailed: boolean,
    dt: number
  ): void {
    if (this.screen !== 'playing' || !this.hudTimerEl) return;

    const timer = formatTime(player.runTime);
    if (timer !== this.lastTimer) {
      this.lastTimer = timer;
      this.hudTimerEl.textContent = timer;
    }

    if (this.hudFpsEl) {
      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.35) {
        const fps = Math.round(this.fpsFrames / this.fpsAccum);
        this.fpsAccum = 0;
        this.fpsFrames = 0;
        if (this.settings.showFps) {
          if (fps !== this.fpsShown) {
            this.fpsShown = fps;
            this.hudFpsEl.textContent = `${fps} FPS`;
          }
          this.hudFpsEl.style.display = 'block';
        } else {
          this.hudFpsEl.style.display = 'none';
        }
      }
    }

    // Split toast fade
    if (this.splitHideTimer > 0) {
      this.splitHideTimer -= dt;
      if (this.splitHideTimer <= 0 && this.hudSplitEl) {
        this.hudSplitEl.classList.remove('is-visible');
      }
    }

    // Speedometer
    const spd = player.horizSpeed;
    if (this.hudSpeedValEl && Math.abs(spd - this.lastSpd) > 0.05) {
      this.lastSpd = spd;
      this.hudSpeedValEl.textContent = spd.toFixed(1);
    }
    if (this.hudSpeedFillEl) {
      const pct = Math.max(0, Math.min(100, (spd / 24) * 100));
      this.hudSpeedFillEl.style.width = `${pct.toFixed(1)}%`;
      this.hudSpeedFillEl.style.background =
        spd >= 18.5 ? '#e52b1e' : spd >= 14.0 ? '#ff9f0a' : '#ffffff';
    }

    // Movement state chip (SLIDE / WALL / VAULT / CLIMB / SWING)
    if (this.hudStateEl) {
      const badge = STATE_BADGE[player.state] ?? '';
      if (badge !== this.lastState) {
        this.lastState = badge;
        if (badge) {
          this.hudStateEl.textContent = badge;
          this.hudStateEl.classList.add('is-visible');
        } else {
          this.hudStateEl.classList.remove('is-visible');
        }
      }
    }

    // Checkpoint counter
    if (this.hudCpEl && course.checkpoints.length > 0) {
      this.hudCpEl.textContent = `${player.checkpointIndex}/${course.checkpoints.length}`;
    }

    // Minimal click-to-lock cue only if unlocked
    if (this.hudLockEl) {
      if (pointerLocked || document.documentElement.classList.contains('is-touch')) {
        this.hudLockEl.style.display = 'none';
      } else {
        this.hudLockEl.style.display = 'block';
        this.hudLockEl.textContent = pointerLockFailed ? 'DRAG / ARROWS' : 'CLICK TO LOCK';
      }
    }

    // 3D-projected amber grapple lock-on diamond
    const target = player.lockedGrapple ?? player.activeGrapple;
    if (this.hudGrappleEl && this.hudCrosshairEl) {
      if (target) {
        const screen = this.projectToScreen(target.x, target.y, target.z, camera);
        if (screen) {
          this.hudGrappleEl.style.transform = `translate3d(${screen[0].toFixed(1)}px, ${screen[1].toFixed(1)}px, 0) rotate(45deg)`;
          this.hudGrappleEl.classList.add('is-visible');
          this.hudCrosshairEl.classList.add('has-lock');
        } else {
          this.hudGrappleEl.classList.remove('is-visible');
          this.hudCrosshairEl.classList.remove('has-lock');
        }
      } else {
        this.hudGrappleEl.classList.remove('is-visible');
        this.hudCrosshairEl.classList.remove('has-lock');
      }
    }

    // 3D-projected minimal first-obstacle key glyph (Course 1–3 only)
    if (
      this.hudPromptEl &&
      this.hudPromptKeyEl &&
      this.hudPromptActEl &&
      course.prompts.length > 0
    ) {
      let activePrompt: KeyPromptDef | null = null;
      let bestD = Infinity;
      for (const p of course.prompts) {
        // Hide grapple prompt once grapple diamond is already displaying its own badge
        if (p.action === 'GRAPPLE' && target) continue;
        const d = Math.hypot(p.x - player.x, p.y - player.y, p.z - player.z);
        const r = p.radius ?? 15;
        if (d <= r && d < bestD) {
          bestD = d;
          activePrompt = p;
        }
      }

      if (activePrompt) {
        const sc = this.projectToScreen(
          activePrompt.x,
          activePrompt.y,
          activePrompt.z,
          camera
        );
        if (sc) {
          this.hudPromptKeyEl.textContent = activePrompt.key;
          this.hudPromptActEl.textContent = activePrompt.action ?? '';
          this.hudPromptEl.style.transform = `translate3d(${sc[0].toFixed(1)}px, ${sc[1].toFixed(1)}px, 0) translate(-50%, -50%)`;
          this.hudPromptEl.classList.add('is-visible');
        } else {
          this.hudPromptEl.classList.remove('is-visible');
        }
      } else {
        this.hudPromptEl.classList.remove('is-visible');
      }
    }
  }

  private projectToScreen(
    x: number,
    y: number,
    z: number,
    camera: THREE.Camera
  ): [number, number] | null {
    this.projVec.set(x, y, z).project(camera);
    if (this.projVec.z > 1.0 || this.projVec.z < -1.0) return null;
    const sx = (this.projVec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this.projVec.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -40 || sx > window.innerWidth + 40 || sy < -40 || sy > window.innerHeight + 40) {
      return null;
    }
    return [sx, sy];
  }

  private clearHudRefs(): void {
    this.hudTimerEl = null;
    this.hudSplitEl = null;
    this.hudSpeedValEl = null;
    this.hudSpeedFillEl = null;
    this.hudStateEl = null;
    this.hudCrosshairEl = null;
    this.hudGrappleEl = null;
    this.hudPromptEl = null;
    this.hudPromptKeyEl = null;
    this.hudPromptActEl = null;
    this.hudCpEl = null;
    this.hudLockEl = null;
    this.hudFpsEl = null;
  }

  private renderTitle(): void {
    if (this.subPanel === 'controls') {
      this.renderControls(() => {
        this.subPanel = 'none';
        this.renderTitle();
      });
      return;
    }
    if (this.subPanel === 'settings') {
      this.renderSettings(false, () => {
        this.subPanel = 'none';
        this.renderTitle();
      });
      return;
    }

    this.root.innerHTML = `
      <div class="menu-screen">
        <div class="brand">
          <span class="brand-slash"></span>
          <h1 class="brand-title">STRIDE</h1>
          <p class="brand-track">${this.courses[this.selectedCourseIdx]?.code ?? ''} ${this.courses[this.selectedCourseIdx]?.name ?? ''}</p>
          <p class="brand-local">times stay on this device</p>
        </div>
        <nav class="menu-nav">
          <button class="menu-btn is-primary" data-act="play">PLAY</button>
          <button class="menu-btn" data-act="courses">COURSES</button>
          <button class="menu-btn" data-act="controls">CONTROLS</button>
          <button class="menu-btn" data-act="settings">SETTINGS</button>
        </nav>
      </div>
    `;

    this.bindMenuButtons({
      play: () => {
        requestAppFullscreen();
        this.cb.onUiSound(true);
        this.cb.onPlayCourse(this.selectedCourseIdx);
      },
      courses: () => {
        this.cb.onUiSound();
        this.showCourses(this.selectedCourseIdx);
      },
      controls: () => {
        this.cb.onUiSound();
        this.subPanel = 'controls';
        this.renderTitle();
      },
      settings: () => {
        this.cb.onUiSound();
        this.subPanel = 'settings';
        this.renderTitle();
      },
    });
  }

  private renderCourses(): void {
    const records = loadAllRecords();
    const rowsHtml = this.courses
      .map((c, idx) => {
        const rec = records[c.id];
        const pb = rec ? formatTime(rec.bestTime) : '--:--.--';
        const rank = rec ? rec.rank : '-';
        const rankClass = rec ? `rank-${rec.rank}` : '';
        const activeClass = idx === this.selectedCourseIdx ? 'is-active' : '';
        return `
          <button class="course-row ${activeClass}" data-idx="${idx}">
            <span class="course-code">${c.code}</span>
            <span class="course-name">${c.name}</span>
            <span class="course-target">S ${formatTime(c.ranks.S)}</span>
            <span class="course-pb">${pb}</span>
            <span class="rank-chip ${rankClass}">${rank}</span>
          </button>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="menu-screen">
        <div class="section-header">
          <span class="section-bar"></span>
          <h2 class="section-title">COURSES</h2>
          <span class="section-sub">${this.courses.length} TRACKS</span>
        </div>
        <div class="course-tools">
          <button class="menu-btn is-primary" data-act="random">RANDOM</button>
        </div>
        <div class="course-list" id="course-list" tabindex="0">${rowsHtml}</div>
        <button class="menu-btn is-back" data-act="back">BACK</button>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('.course-row').forEach((btn) => {
      const idx = Number(btn.dataset.idx);
      btn.addEventListener('mouseenter', () => {
        if (this.selectedCourseIdx !== idx) {
          this.selectedCourseIdx = idx;
          this.root
            .querySelectorAll('.course-row')
            .forEach((el, i) => el.classList.toggle('is-active', i === idx));
          this.cb.onPreviewCourse(idx);
        }
      });
      btn.addEventListener('click', () => {
        this.cb.onUiSound(true);
        this.cb.onPlayCourse(idx);
      });
    });
    this.root.querySelector('.course-row.is-active')?.scrollIntoView({ block: 'center' });

    const list = this.root.querySelector<HTMLElement>('#course-list');
    list?.focus();
    list?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(
          0,
          Math.min(this.courses.length - 1, this.selectedCourseIdx + dir)
        );
        if (next !== this.selectedCourseIdx) {
          this.selectedCourseIdx = next;
          this.root.querySelectorAll('.course-row').forEach((el, i) => {
            el.classList.toggle('is-active', i === next);
            if (i === next) el.scrollIntoView({ block: 'nearest' });
          });
          this.cb.onPreviewCourse(next);
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.cb.onUiSound(true);
        this.cb.onPlayCourse(this.selectedCourseIdx);
      }
    });

    this.bindMenuButtons({
      random: () => {
        const idx = Math.floor(Math.random() * this.courses.length);
        this.cb.onUiSound(true);
        this.cb.onPlayCourse(idx);
      },
      back: () => {
        this.cb.onUiSound();
        this.cb.onGoTitle();
      },
    });
  }

  private renderControls(onBack: () => void, isPause = false): void {
    const pairs: [string, string][] = [
      ['MOVE', 'W A S D / STICK'],
      ['LOOK', 'MOUSE / SWIPE'],
      ['JUMP / WALL KICK', 'SPACE / JUMP'],
      ['SLIDE / BOOST', 'SHIFT / SLIDE'],
      ['VAULT / CLIMB', 'AUTO'],
      ['GRAPPLE', 'RMB / HOOK'],
      ['RESTART', 'R'],
      ['CHECKPOINT', 'F'],
      ['PAUSE', 'ESC / II'],
    ];

    this.root.innerHTML = `
      <div class="menu-screen ${isPause ? 'is-pause' : ''}">
        <div class="section-header">
          <span class="section-bar"></span>
          <h2 class="section-title">CONTROLS</h2>
        </div>
        <div class="keybind-grid">
          ${pairs
            .map(
              ([act, key]) => `
            <div class="keybind-row">
              <span class="keybind-action">${act}</span>
              <span class="keycap">${key}</span>
            </div>
          `
            )
            .join('')}
        </div>
        <button class="menu-btn is-back" data-act="back">BACK</button>
      </div>
    `;

    this.bindMenuButtons({
      back: () => {
        this.cb.onUiSound();
        onBack();
      },
    });
  }

  private renderSettings(isPause: boolean, onBack: () => void): void {
    const s = this.settings;
    this.root.innerHTML = `
      <div class="menu-screen ${isPause ? 'is-pause' : ''}">
        <div class="section-header">
          <span class="section-bar"></span>
          <h2 class="section-title">SETTINGS</h2>
        </div>
        <div class="settings-list">
          <div class="setting-row">
            <span class="setting-label">SENSITIVITY</span>
            <input class="setting-slider" id="s-sens" type="range" min="0.2" max="2.5" step="0.05" value="${s.sensitivity}" />
            <span class="setting-val" id="v-sens">${s.sensitivity.toFixed(2)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">FOV</span>
            <input class="setting-slider" id="s-fov" type="range" min="80" max="115" step="1" value="${s.fov}" />
            <span class="setting-val" id="v-fov">${Math.round(s.fov)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">MOTION BLUR</span>
            <input class="setting-slider" id="s-blur" type="range" min="0" max="150" step="5" value="${Math.round(s.motionBlur * 100)}" />
            <span class="setting-val" id="v-blur">${Math.round(s.motionBlur * 100)}%</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">HEAD BOB</span>
            <input class="setting-slider" id="s-bob" type="range" min="0" max="150" step="5" value="${Math.round(s.headBob * 100)}" />
            <span class="setting-val" id="v-bob">${Math.round(s.headBob * 100)}%</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">AUDIO</span>
            <input class="setting-slider" id="s-vol" type="range" min="0" max="100" step="1" value="${Math.round(s.volume * 100)}" />
            <span class="setting-val" id="v-vol">${Math.round(s.volume * 100)}%</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">GRAPHICS</span>
            <button class="toggle-btn is-on" id="s-gfx">${s.graphics.toUpperCase()}</button>
          </div>
          <div class="setting-row">
            <span class="setting-label">FOLIAGE</span>
            <button class="toggle-btn is-on" id="s-fol">${s.foliage.toUpperCase()}</button>
          </div>
          <div class="setting-row">
            <span class="setting-label">PB GHOST</span>
            <button class="toggle-btn ${s.showGhost ? 'is-on' : ''}" id="s-ghost">${s.showGhost ? 'ON' : 'OFF'}</button>
          </div>
          <div class="setting-row">
            <span class="setting-label">FPS</span>
            <button class="toggle-btn ${s.showFps ? 'is-on' : ''}" id="s-fps">${s.showFps ? 'ON' : 'OFF'}</button>
          </div>
          <div class="setting-row">
            <span class="setting-label">PAD SIZE</span>
            <input class="setting-slider" id="s-tsize" type="range" min="70" max="150" step="5" value="${Math.round(s.touchSize * 100)}" />
            <span class="setting-val" id="v-tsize">${Math.round(s.touchSize * 100)}%</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">PAD FADE</span>
            <input class="setting-slider" id="s-topac" type="range" min="20" max="100" step="5" value="${Math.round(s.touchOpacity * 100)}" />
            <span class="setting-val" id="v-topac">${Math.round(s.touchOpacity * 100)}%</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">STICK LEFT</span>
            <input class="setting-slider" id="s-sx" type="range" min="0" max="28" step="1" value="${s.stickX}" />
            <span class="setting-val" id="v-sx">${Math.round(s.stickX)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">STICK UP</span>
            <input class="setting-slider" id="s-sy" type="range" min="0" max="40" step="1" value="${s.stickY}" />
            <span class="setting-val" id="v-sy">${Math.round(s.stickY)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">JUMP IN</span>
            <input class="setting-slider" id="s-ax" type="range" min="0" max="28" step="1" value="${s.actionsX}" />
            <span class="setting-val" id="v-ax">${Math.round(s.actionsX)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">JUMP UP</span>
            <input class="setting-slider" id="s-ay" type="range" min="0" max="40" step="1" value="${s.actionsY}" />
            <span class="setting-val" id="v-ay">${Math.round(s.actionsY)}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">PAUSE DOWN</span>
            <input class="setting-slider" id="s-sys" type="range" min="0" max="80" step="1" value="${s.sysY}" />
            <span class="setting-val" id="v-sys">${Math.round(s.sysY)}</span>
          </div>
          <button class="danger-btn" id="s-clear">RESET TIMES</button>
        </div>
        <button class="menu-btn is-back" data-act="back">BACK</button>
      </div>
    `;

    const sensIn = this.root.querySelector<HTMLInputElement>('#s-sens')!;
    const sensVal = this.root.querySelector<HTMLElement>('#v-sens')!;
    sensIn.addEventListener('input', () => {
      s.sensitivity = Number(sensIn.value);
      sensVal.textContent = s.sensitivity.toFixed(2);
      this.cb.onSettingsChange(s);
    });

    const fovIn = this.root.querySelector<HTMLInputElement>('#s-fov')!;
    const fovVal = this.root.querySelector<HTMLElement>('#v-fov')!;
    fovIn.addEventListener('input', () => {
      s.fov = Number(fovIn.value);
      fovVal.textContent = `${Math.round(s.fov)}`;
      this.cb.onSettingsChange(s);
    });

    const blurIn = this.root.querySelector<HTMLInputElement>('#s-blur')!;
    const blurVal = this.root.querySelector<HTMLElement>('#v-blur')!;
    blurIn.addEventListener('input', () => {
      s.motionBlur = Number(blurIn.value) / 100;
      blurVal.textContent = `${Math.round(s.motionBlur * 100)}%`;
      this.cb.onSettingsChange(s);
    });

    const bobIn = this.root.querySelector<HTMLInputElement>('#s-bob')!;
    const bobVal = this.root.querySelector<HTMLElement>('#v-bob')!;
    bobIn.addEventListener('input', () => {
      s.headBob = Number(bobIn.value) / 100;
      bobVal.textContent = `${Math.round(s.headBob * 100)}%`;
      this.cb.onSettingsChange(s);
    });

    const volIn = this.root.querySelector<HTMLInputElement>('#s-vol')!;
    const volVal = this.root.querySelector<HTMLElement>('#v-vol')!;
    volIn.addEventListener('input', () => {
      s.volume = Number(volIn.value) / 100;
      volVal.textContent = `${Math.round(s.volume * 100)}%`;
      this.cb.onSettingsChange(s);
    });

    const gfxBtn = this.root.querySelector<HTMLButtonElement>('#s-gfx')!;
    gfxBtn.addEventListener('click', () => {
      s.graphics = s.graphics === 'high' ? 'medium' : s.graphics === 'medium' ? 'low' : 'high';
      gfxBtn.textContent = s.graphics.toUpperCase();
      this.cb.onUiSound();
      this.cb.onSettingsChange(s);
    });

    const folBtn = this.root.querySelector<HTMLButtonElement>('#s-fol')!;
    folBtn.addEventListener('click', () => {
      s.foliage = s.foliage === 'high' ? 'low' : s.foliage === 'low' ? 'off' : 'high';
      folBtn.textContent = s.foliage.toUpperCase();
      this.cb.onUiSound();
      this.cb.onSettingsChange(s);
    });

    const ghostBtn = this.root.querySelector<HTMLButtonElement>('#s-ghost')!;
    ghostBtn.addEventListener('click', () => {
      s.showGhost = !s.showGhost;
      ghostBtn.textContent = s.showGhost ? 'ON' : 'OFF';
      ghostBtn.classList.toggle('is-on', s.showGhost);
      this.cb.onUiSound();
      this.cb.onSettingsChange(s);
    });

    const bindPct = (
      id: string,
      apply: (n: number) => void,
      label: (n: number) => string
    ) => {
      const el = this.root.querySelector<HTMLInputElement>(id)!;
      const val = this.root.querySelector<HTMLElement>(id.replace('#s-', '#v-'))!;
      el.addEventListener('input', () => {
        const n = Number(el.value);
        apply(n);
        val.textContent = label(n);
        this.cb.onSettingsChange(s);
      });
    };
    bindPct('#s-tsize', (n) => { s.touchSize = n / 100; }, (n) => `${n}%`);
    bindPct('#s-topac', (n) => { s.touchOpacity = n / 100; }, (n) => `${n}%`);
    bindPct('#s-sx', (n) => { s.stickX = n; }, (n) => `${n}`);
    bindPct('#s-sy', (n) => { s.stickY = n; }, (n) => `${n}`);
    bindPct('#s-ax', (n) => { s.actionsX = n; }, (n) => `${n}`);
    bindPct('#s-ay', (n) => { s.actionsY = n; }, (n) => `${n}`);
    bindPct('#s-sys', (n) => { s.sysY = n; }, (n) => `${n}`);

    const fpsBtn = this.root.querySelector<HTMLButtonElement>('#s-fps')!;
    fpsBtn.addEventListener('click', () => {
      s.showFps = !s.showFps;
      fpsBtn.textContent = s.showFps ? 'ON' : 'OFF';
      fpsBtn.classList.toggle('is-on', s.showFps);
      this.cb.onUiSound();
      this.cb.onSettingsChange(s);
    });

    const clearBtn = this.root.querySelector<HTMLButtonElement>('#s-clear')!;
    clearBtn.addEventListener('click', () => {
      clearAllRecords();
      clearBtn.textContent = 'CLEARED';
      this.cb.onUiSound();
      this.cb.onRecordsCleared();
    });

    this.bindMenuButtons({
      back: () => {
        this.cb.onUiSound();
        onBack();
      },
    });
  }

  private renderPause(course: CourseDef): void {
    if (this.subPanel === 'controls') {
      this.renderControls(() => {
        this.subPanel = 'none';
        this.renderPause(course);
      }, true);
      return;
    }
    if (this.subPanel === 'settings') {
      this.renderSettings(true, () => {
        this.subPanel = 'none';
        this.renderPause(course);
      });
      return;
    }

    this.root.innerHTML = `
      <div class="menu-screen is-pause">
        <div class="section-header">
          <span class="section-bar"></span>
          <h2 class="section-title">PAUSED</h2>
          <span class="section-sub">${course.code} ${course.name}</span>
        </div>
        <nav class="menu-nav">
          <button class="menu-btn is-primary" data-act="resume">RESUME</button>
          <button class="menu-btn" data-act="restart">RESTART</button>
          <button class="menu-btn" data-act="checkpoint">CHECKPOINT</button>
          <button class="menu-btn" data-act="controls">CONTROLS</button>
          <button class="menu-btn" data-act="settings">SETTINGS</button>
          <button class="menu-btn" data-act="next">NEXT TRACK</button>
          <button class="menu-btn" data-act="courses">COURSES</button>
          <button class="menu-btn is-back" data-act="title">QUIT</button>
        </nav>
      </div>
    `;

    this.bindMenuButtons({
      resume: () => {
        this.cb.onUiSound(true);
        this.cb.onResume();
      },
      restart: () => {
        this.cb.onUiSound(true);
        this.cb.onRestart();
      },
      checkpoint: () => {
        this.cb.onUiSound();
        this.cb.onCheckpoint();
      },
      controls: () => {
        this.cb.onUiSound();
        this.subPanel = 'controls';
        this.renderPause(course);
      },
      settings: () => {
        this.cb.onUiSound();
        this.subPanel = 'settings';
        this.renderPause(course);
      },
      next: () => {
        this.cb.onUiSound(true);
        this.cb.onNextCourse();
      },
      courses: () => {
        this.cb.onUiSound();
        this.cb.onGoCourses();
      },
      title: () => {
        this.cb.onUiSound();
        this.cb.onGoTitle();
      },
    });
  }

  private renderHud(course: CourseDef): void {
    this.root.innerHTML = `
      <div class="hud-layer">
        <div class="hud-top">
          <div class="hud-course-tag">${course.code} ${course.name}</div>
          <div class="hud-timer" id="hud-timer">00:00.00</div>
          <div class="hud-fps" id="hud-fps" style="display:none">0 FPS</div>
          <div class="hud-split" id="hud-split"></div>
        </div>
        <div class="hud-cp" id="hud-cp">0/${course.checkpoints.length}</div>
        <div class="hud-crosshair" id="hud-cross"></div>
        <div class="hud-grapple-reticle" id="hud-grapple">
          <span class="hud-grapple-key">E / RMB</span>
        </div>
        <div class="hud-world-prompt" id="hud-prompt">
          <span class="wp-key" id="hud-pkey"></span>
          <span class="wp-act" id="hud-pact"></span>
        </div>
        <div class="hud-lock-pill" id="hud-lock" style="display:none">CLICK TO LOCK</div>
        <div class="hud-speed">
          <div class="hud-state" id="hud-state"></div>
          <div class="hud-speed-row">
            <span class="hud-speed-val" id="hud-spd">0.0</span>
            <span class="hud-speed-unit">M/S</span>
          </div>
          <div class="hud-speed-bar">
            <div class="hud-speed-fill" id="hud-spd-fill"></div>
          </div>
        </div>
      </div>
    `;

    this.hudTimerEl = this.root.querySelector('#hud-timer');
    this.hudSplitEl = this.root.querySelector('#hud-split');
    this.hudSpeedValEl = this.root.querySelector('#hud-spd');
    this.hudSpeedFillEl = this.root.querySelector('#hud-spd-fill');
    this.hudStateEl = this.root.querySelector('#hud-state');
    this.hudCrosshairEl = this.root.querySelector('#hud-cross');
    this.hudGrappleEl = this.root.querySelector('#hud-grapple');
    this.hudPromptEl = this.root.querySelector('#hud-prompt');
    this.hudPromptKeyEl = this.root.querySelector('#hud-pkey');
    this.hudPromptActEl = this.root.querySelector('#hud-pact');
    this.hudCpEl = this.root.querySelector('#hud-cp');
    this.hudLockEl = this.root.querySelector('#hud-lock');
    this.hudFpsEl = this.root.querySelector('#hud-fps');
    this.lastTimer = '';
    this.lastSpd = -1;
    this.lastState = '';
  }

  private renderFinish(sum: FinishSummary): void {
    const ranks: Rank[] = ['S', 'A', 'B', 'C'];
    const pbText = sum.isNewBest
      ? `<span class="pb-badge">NEW BEST</span>`
      : sum.prevBest !== null
        ? `<span>PB ${formatTime(sum.prevBest)}</span>`
        : '';

    this.root.innerHTML = `
      <div class="finish-screen">
        <div class="finish-main">
          <div class="finish-rank rank-${sum.rank}">${sum.rank}</div>
          <div class="finish-stats">
            <span class="finish-course">${sum.course.code} ${sum.course.name}</span>
            <span class="finish-time">${formatTime(sum.time)}</span>
            <div class="finish-meta">
              ${pbText}
              <span>PEAK ${sum.peakSpeed.toFixed(1)} M/S</span>
            </div>
          </div>
        </div>
        <div class="finish-targets">
          ${ranks
            .map(
              (r) => `
            <div class="target-pill ${r === sum.rank ? 'is-earned' : ''}">
              <span class="rank-chip rank-${r}">${r}</span>
              <span>${formatTime(sum.course.ranks[r])}</span>
            </div>
          `
            )
            .join('')}
        </div>
        <div class="finish-actions">
          ${
            sum.hasNext
              ? `<button class="action-btn is-primary" data-act="next">NEXT <span class="action-key">[SPACE]</span></button>`
              : ''
          }
          <button class="action-btn ${sum.hasNext ? '' : 'is-primary'}" data-act="retry">RETRY <span class="action-key">[R]</span></button>
          <button class="action-btn" data-act="courses">COURSES</button>
        </div>
      </div>
    `;

    this.bindMenuButtons({
      next: () => {
        this.cb.onUiSound(true);
        this.cb.onNextCourse();
      },
      retry: () => {
        this.cb.onUiSound(true);
        this.cb.onRestart();
      },
      courses: () => {
        this.cb.onUiSound();
        this.cb.onGoCourses();
      },
    });
  }

  private bindMenuButtons(handlers: Record<string, () => void>): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      const act = btn.dataset.act;
      if (act && handlers[act]) {
        btn.addEventListener('click', () => {
          requestAppFullscreen();
          handlers[act]();
        });
      }
    });
  }
}
