import * as THREE from 'three';
import './style.css';
import { AudioEngine } from './game/audio';
import { CameraRig } from './game/camera';
import { EffectsSystem } from './game/fx';
import { GhostSystem } from './game/ghost';
import { InputManager } from './game/input';
import { PhysicsWorld } from './game/physics';
import { Player } from './game/player';
import { VelocityMotionBlur } from './game/postfx';
import { ViewModel } from './game/viewmodel';
import {
  computeRank,
  decodeGhost,
  encodeGhost,
  loadCourseRecord,
  loadSettings,
  saveCourseRecord,
  saveSettings,
} from './storage';
import { CourseRecord, GameScreen, GraphicsQuality } from './types';
import { registerServiceWorker, requestAppFullscreen } from './ui/display';
import { GameUI } from './ui/hud';
import { BuiltCourse } from './world/builder';
import { COURSES } from './world/courses';
import { FrustumCuller } from './world/culler';
import { createMaterials } from './world/materials';
import { SkySystem } from './world/sky';

const FIXED_DT = 1 / 120;

class StrideGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3();
  private sky: SkySystem;
  private mats;
  private motionBlur: VelocityMotionBlur;
  private culler = new FrustumCuller();
  private shadowSnapX = Number.NaN;
  private shadowSnapY = 0;
  private shadowSnapZ = 0;
  private shadowAge = 1;
  private gfxDist = 1;
  private autoDpr = 1;
  private fpsEma = 60;

  private audio: AudioEngine;
  private fx: EffectsSystem;
  private ghost: GhostSystem;
  private viewModel: ViewModel;
  private cameraRig: CameraRig;
  private input: InputManager;
  private ui: GameUI;

  private settings = loadSettings();
  private screen: GameScreen = 'title';
  private courseIndex = 0;
  private currentRecord: CourseRecord | null = null;

  private builtCourse: BuiltCourse | null = null;
  private physicsWorld!: PhysicsWorld;
  private player!: Player;

  private accumulator = 0;
  private lastFrameTime = performance.now();

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const fxCanvas = document.getElementById('fx-canvas') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui-root') as HTMLElement;

    // 1. Renderer — crisp daylight ACES tone mapping + soft architectural shadows
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 2. Scene & sunlit metropolitan haze
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c9e0f5');
    this.scene.fog = new THREE.FogExp2('#d2e5f7', 0.00155);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      3200
    );
    this.scene.add(this.camera);

    // 3. Three-point architectural daylight: warm sun + cerulean sky/concrete bounce + cool shadow fill
    const hemi = new THREE.HemisphereLight('#8dc4ff', '#cfc6ba', 1.05);
    this.scene.add(hemi);

    const fill = new THREE.DirectionalLight('#93c2f5', 0.48);
    fill.position.set(-40, 35, 50);
    this.scene.add(fill);

    this.sunLight = new THREE.DirectionalLight('#fff7ea', 2.45);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 190;
    const sBound = 54;
    this.sunLight.shadow.camera.left = -sBound;
    this.sunLight.shadow.camera.right = sBound;
    this.sunLight.shadow.camera.top = sBound;
    this.sunLight.shadow.camera.bottom = -sBound;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.035;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 4. World, post-FX & game systems
    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy());
    this.sky = new SkySystem();
    this.scene.add(this.sky.group);

    this.motionBlur = new VelocityMotionBlur(this.renderer);

    this.audio = new AudioEngine();
    this.audio.setVolume(this.settings.volume);

    this.fx = new EffectsSystem(fxCanvas);
    this.scene.add(this.fx.group);

    this.ghost = new GhostSystem();
    this.scene.add(this.ghost.group);

    this.viewModel = new ViewModel();
    this.scene.add(this.viewModel.ropeMesh);
    this.viewModel.setVisible(false);

    this.cameraRig = new CameraRig(this.camera);

    this.input = new InputManager(canvas, {
      onRestart: () => this.restartRun(),
      onCheckpointReset: () => this.respawnCheckpoint(),
      onPauseToggle: () => this.togglePause(),
      onNextCourse: () => this.nextCourse(),
      onPointerLockLost: () => {
        if (this.screen === 'playing') {
          this.pauseGame();
        }
      },
    });

    this.ui = new GameUI(uiRoot, COURSES, this.settings, {
      onPlayCourse: (idx) => this.startCourse(idx),
      onPreviewCourse: (idx) => this.loadCourse(idx),
      onResume: () => this.resumeGame(),
      onRestart: () => this.restartRun(),
      onCheckpoint: () => this.respawnCheckpoint(),
      onNextCourse: () => this.nextCourse(),
      onGoTitle: () => this.goTitle(),
      onGoCourses: () => this.goCourses(),
      onSettingsChange: (next) => {
        this.settings = { ...next };
        saveSettings(this.settings);
        this.audio.setVolume(this.settings.volume);
        this.applyGraphics(this.settings.graphics);
      },
      onRecordsCleared: () => {
        this.currentRecord = null;
        this.ghost.setPlaybackGhost([]);
      },
      onUiSound: (accent) => this.audio.playUiClick(accent),
    });

    this.applyGraphics(this.settings.graphics);
    this.loadCourse(0);
    this.ui.showTitle(0);
    registerServiceWorker();

    const enterFullscreen = () => requestAppFullscreen();
    window.addEventListener('pointerdown', enterFullscreen, { capture: true });
    window.addEventListener('keydown', enterFullscreen, { capture: true });

    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((now) => this.loop(now));
  }

  private createPlayerEvents() {
    return {
      onFootstep: (speed: number, isWall: boolean, foot: -1 | 1) => {
        this.audio.playFootstep(speed, isWall, foot);
        this.cameraRig.onFootstrike(speed, isWall, foot, this.settings.headBob);
      },
      onPivot: (intensity: number) => {
        this.audio.playPivot(intensity);
        this.cameraRig.onPivotImpulse(
          this.input.state.right,
          intensity,
          this.settings.headBob
        );
        this.fx.spawnBurst(this.player.x, this.player.y + 0.05, this.player.z, '#e8edf2', 4);
      },
      onJump: (boosted: boolean) => {
        this.audio.playJump(boosted);
        this.cameraRig.onJumpImpulse(boosted, this.settings.headBob);
      },
      onLand: (impact: number, intoSlide: boolean) => {
        this.audio.playLand(impact, intoSlide);
        this.cameraRig.addLandingImpact(impact, intoSlide, this.settings.headBob);
      },
      onSlideStart: (_speed: number, slopeSlam: boolean) => {
        this.audio.playSlideStart(slopeSlam);
        this.fx.spawnBurst(
          this.player.x,
          this.player.y + 0.08,
          this.player.z,
          '#e8edf2',
          slopeSlam ? 11 : 6
        );
      },
      onVault: (spring: boolean) => {
        this.audio.playVault(spring);
        this.cameraRig.onVaultImpulse(spring, this.settings.headBob);
      },
      onMantle: () => this.audio.playMantle(),
      onWallRunStart: () => this.audio.playWallRunStart(),
      onWallKick: (side: -1 | 1) => {
        this.audio.playWallKick();
        this.cameraRig.onWallKickImpulse(side, this.settings.headBob);
      },
      onGrappleAttach: () => this.audio.playGrappleAttach(),
      onGrappleRelease: (slingshot: boolean) => this.audio.playGrappleRelease(slingshot),
      onLaunchPad: () => {
        this.audio.playLaunchPad();
        this.fx.triggerFlash('160, 238, 255', 0.12);
      },
      onFovPunch: (deg: number) => this.cameraRig.addFovPunch(deg),
      onCheckpoint: (cp: { index: number; x: number; y: number; z: number }, elapsed: number) => {
        this.builtCourse?.markCheckpointReached(cp.index);
        const pbSplit = this.currentRecord?.splits?.[cp.index];
        const delta = typeof pbSplit === 'number' ? elapsed - pbSplit : null;
        const ahead = delta === null || delta <= 0;
        this.audio.playCheckpoint(ahead);
        this.ui.flashSplit(delta, cp.index + 1);
        this.fx.spawnBurst(cp.x, cp.y + 1.2, cp.z, '#15e680', 14);
        this.fx.triggerFlash('80, 255, 165', 0.08);
      },
      onFinish: (elapsed: number, peakSpeed: number, splits: number[]) => {
        this.handleFinish(elapsed, peakSpeed, splits);
      },
      onRespawn: (fullReset: boolean) => {
        this.audio.playReset();
        this.motionBlur.resetVelocity();
        if (fullReset) {
          this.builtCourse?.resetCheckpoints();
          this.ghost.resetRun();
          this.cameraRig.reset(this.settings.fov);
        }
        this.fx.triggerFlash('255, 255, 255', 0.14);
      },
    };
  }

  private loadCourse(index: number): void {
    const clamped = Math.max(0, Math.min(COURSES.length - 1, index));
    if (this.builtCourse && this.courseIndex === clamped) {
      return;
    }

    if (this.builtCourse) {
      this.scene.remove(this.builtCourse.group);
      this.builtCourse.dispose();
      this.builtCourse = null;
    }

    this.courseIndex = clamped;
    const course = COURSES[clamped];

    const ce = Math.cos(course.sunElevation);
    this.sunDir
      .set(
        Math.sin(course.sunAzimuth) * ce,
        Math.sin(course.sunElevation),
        Math.cos(course.sunAzimuth) * ce
      )
      .normalize();
    this.sky.setSunDirection(this.sunDir);
    this.viewModel.setSunDirection(this.sunDir);

    this.builtCourse = new BuiltCourse(course, this.mats);
    this.scene.add(this.builtCourse.group);

    this.physicsWorld = new PhysicsWorld(course);
    if (!this.player) {
      this.player = new Player(this.physicsWorld, course, this.createPlayerEvents());
    } else {
      this.player.setCourse(this.physicsWorld, course);
    }

    this.currentRecord = loadCourseRecord(course.id);
    this.ghost.setPlaybackGhost(
      this.currentRecord ? decodeGhost(this.currentRecord.ghost) : []
    );
  }

  private startCourse(index: number): void {
    this.audio.unlock();
    this.loadCourse(index);
    const course = COURSES[this.courseIndex];

    this.player.resetCourse(false);
    this.builtCourse?.resetCheckpoints();
    this.currentRecord = loadCourseRecord(course.id);
    this.ghost.setPlaybackGhost(
      this.currentRecord ? decodeGhost(this.currentRecord.ghost) : []
    );

    this.cameraRig.reset(this.settings.fov);
    this.motionBlur.resetVelocity();
    this.viewModel.setVisible(true);
    this.input.clearInputs();
    this.input.gameplayActive = true;
    this.input.finishedActive = false;
    this.screen = 'playing';
    this.ui.showPlaying(course, this.courseIndex);
    this.input.touch.setActive(true);
    this.input.requestLock();
  }

  private restartRun(): void {
    this.audio.unlock();
    const course = COURSES[this.courseIndex];
    this.currentRecord = loadCourseRecord(course.id);
    this.ghost.setPlaybackGhost(
      this.currentRecord ? decodeGhost(this.currentRecord.ghost) : []
    );
    this.player.resetCourse(true);
    this.motionBlur.resetVelocity();
    this.viewModel.setVisible(true);
    this.input.clearInputs();
    this.input.gameplayActive = true;
    this.input.finishedActive = false;
    this.screen = 'playing';
    this.ui.showPlaying(course, this.courseIndex);
    this.input.touch.setActive(true);
    if (!this.input.pointerLocked) {
      this.input.requestLock();
    }
  }

  private respawnCheckpoint(): void {
    this.player.respawnAtCheckpoint(true);
    if (this.screen === 'paused') {
      this.resumeGame();
    }
  }

  private pauseGame(): void {
    if (this.screen !== 'playing') return;
    this.screen = 'paused';
    this.input.gameplayActive = false;
    this.input.clearInputs();
    this.input.exitLock();
    this.input.touch.setActive(false);
    this.audio.updateContinuous(0, false, 0, false, false);
    this.ui.showPaused(COURSES[this.courseIndex]);
  }

  private resumeGame(): void {
    if (this.screen !== 'paused') return;
    this.audio.unlock();
    this.screen = 'playing';
    this.input.clearInputs();
    this.input.gameplayActive = true;
    this.input.finishedActive = false;
    this.ui.showPlaying(COURSES[this.courseIndex], this.courseIndex);
    this.input.touch.setActive(true);
    this.input.requestLock();
  }

  private togglePause(): void {
    if (this.screen === 'playing') {
      this.pauseGame();
    } else if (this.screen === 'paused') {
      this.resumeGame();
    } else if (this.screen === 'finished') {
      this.goCourses();
    }
  }

  private handleFinish(elapsed: number, peakSpeed: number, splits: number[]): void {
    const course = COURSES[this.courseIndex];
    this.ghost.captureFinalFrame(this.player);

    const prevBest = this.currentRecord ? this.currentRecord.bestTime : null;
    const isNewBest = prevBest === null || elapsed < prevBest;
    const rank = computeRank(elapsed, course.ranks);

    if (isNewBest) {
      const updated: CourseRecord = {
        bestTime: elapsed,
        rank,
        peakSpeed,
        splits,
        ghost: encodeGhost(this.ghost.getRecordedFrames()),
      };
      saveCourseRecord(course.id, updated);
      this.currentRecord = updated;
    }

    this.audio.playFinish(isNewBest);
    this.fx.triggerFlash('255, 255, 255', 0.24);
    this.fx.spawnBurst(course.finish.x, course.finish.y + 2, course.finish.z, '#15e680', 24);

    this.screen = 'finished';
    this.input.gameplayActive = false;
    this.input.finishedActive = true;
    this.input.clearInputs();
    this.input.exitLock();
    this.input.touch.setActive(false);
    this.viewModel.setVisible(false);

    this.ui.showFinished({
      course,
      time: elapsed,
      rank,
      isNewBest,
      prevBest,
      peakSpeed,
      hasNext: this.courseIndex < COURSES.length - 1,
    });
  }

  private nextCourse(): void {
    if (this.courseIndex < COURSES.length - 1) {
      this.startCourse(this.courseIndex + 1);
    } else {
      this.goCourses();
    }
  }

  private goTitle(): void {
    this.screen = 'title';
    this.input.gameplayActive = false;
    this.input.finishedActive = false;
    this.input.clearInputs();
    this.input.exitLock();
    this.viewModel.setVisible(false);
    this.input.touch.setActive(false);
    this.ghost.resetRun();
    this.ui.showTitle(this.courseIndex);
  }

  private goCourses(): void {
    this.screen = 'courses';
    this.input.gameplayActive = false;
    this.input.finishedActive = false;
    this.input.clearInputs();
    this.input.exitLock();
    this.viewModel.setVisible(false);
    this.input.touch.setActive(false);
    this.ghost.resetRun();
    this.ui.showCourses(this.courseIndex);
  }

  private applyGraphics(q: GraphicsQuality): void {
    const low = q === 'low';
    const med = q === 'medium';
    this.gfxDist = low ? 0.72 : med ? 0.88 : 1;
    this.sunLight.castShadow = !low;
    const mapRes = low ? 512 : med ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(mapRes, mapRes);
    const sBound = low ? 36 : med ? 46 : 48;
    this.sunLight.shadow.camera.left = -sBound;
    this.sunLight.shadow.camera.right = sBound;
    this.sunLight.shadow.camera.top = sBound;
    this.sunLight.shadow.camera.bottom = -sBound;
    this.sunLight.shadow.camera.updateProjectionMatrix();
    this.builtCourse?.foliage?.setCanopyShadows(!low);
    this.motionBlur.setQuality(q);
    const cap = low ? 1 : med ? 1.5 : 2;
    this.autoDpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(this.autoDpr);
    this.onResize();
  }

  private updateShadowFrustum(): void {
    const texel = this.settings.graphics === 'high' ? 1 : 2;
    const sx = Math.round(this.camera.position.x / texel) * texel;
    const sy = Math.round(this.camera.position.y / texel) * texel;
    const sz = Math.round(this.camera.position.z / texel) * texel;
    this.shadowAge += 1;
    const moved =
      sx !== this.shadowSnapX || sy !== this.shadowSnapY || sz !== this.shadowSnapZ;
    if (!moved && this.shadowAge < 4) {
      this.sunLight.shadow.needsUpdate = false;
      return;
    }
    this.shadowSnapX = sx;
    this.shadowSnapY = sy;
    this.shadowSnapZ = sz;
    this.shadowAge = 0;
    this.sunLight.target.position.set(sx, sy, sz);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position.set(
      sx + this.sunDir.x * 70,
      sy + this.sunDir.y * 70,
      sz + this.sunDir.z * 70
    );
    this.sunLight.shadow.needsUpdate = true;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    const cap =
      this.settings.graphics === 'low' ? 1 : this.settings.graphics === 'medium' ? 1.5 : 2;
    this.autoDpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(this.autoDpr);
    this.renderer.setSize(w, h);
    this.motionBlur.resize();
    this.fx.resize();
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = (now - this.lastFrameTime) * 0.001;
    this.lastFrameTime = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));
    const course = COURSES[this.courseIndex];

    let activeMotionBlur = false;

    if (this.screen === 'playing') {
      const [dYaw, dPitch] = this.input.consumeLookDelta(this.settings.sensitivity, dt);
      this.player.yaw += dYaw;
      this.player.pitch = Math.max(-1.46, Math.min(1.46, this.player.pitch + dPitch));

      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this.input.tickFixed(FIXED_DT);
        this.player.step(this.input.state, FIXED_DT);
        this.ghost.recordStep(this.player, FIXED_DT);
        this.accumulator -= FIXED_DT;
        if ((this.screen as GameScreen) !== 'playing') {
          this.accumulator = 0;
          break;
        }
      }

      if ((this.screen as GameScreen) === 'playing') {
        activeMotionBlur = true;
        const alpha = this.accumulator / FIXED_DT;

        this.cameraRig.updateGameplay(
          this.player,
          alpha,
          dt,
          this.settings.fov,
          this.settings.headBob,
          this.input.state.right
        );
        this.viewModel.update(this.player, dt, this.camera);
        this.ghost.updatePlayback(this.player, this.settings.showGhost);
        this.culler.update(this.camera);
        this.builtCourse?.update(
          dt,
          this.player.lockedGrapple?.id ?? null,
          this.player.activeGrapple?.id ?? null,
          this.culler,
          this.settings.foliage,
          this.gfxDist,
          this.settings.graphics === 'low'
        );

        const isGroundSliding =
          this.player.state === 'slide' && this.player.grounded;
        if (
          isGroundSliding &&
          (this.player.horizSpeed > 13.5 ||
            Math.abs(this.player.slideSteer) > 0.35 ||
            this.player.slideBraking)
        ) {
          const extra =
            Math.abs(this.player.slideSteer) + (this.player.slideBraking ? 1.0 : 0);
          this.fx.emitSlideGrit(
            this.player.x,
            this.player.y,
            this.player.z,
            this.player.vx,
            this.player.vz,
            extra,
            dt
          );
        }

        this.audio.updateContinuous(
          this.player.totalSpeed,
          isGroundSliding,
          this.player.slideSteer,
          this.player.slideBraking,
          true
        );
        this.fx.update(dt, this.player.totalSpeed, this.camera.position, true);
        this.ui.updateHud(
          this.player,
          course,
          this.camera,
          this.input.pointerLocked,
          this.input.pointerLockFailed,
          dt
        );
      }
    } else if (this.screen === 'finished') {
      this.player.step(this.input.state, dt);
      this.cameraRig.updateGameplay(
        this.player,
        1,
        dt,
        this.settings.fov,
        this.settings.headBob * 0.5,
        0
      );
      this.culler.update(this.camera);
      this.builtCourse?.update(
        dt * 0.25,
        null,
        null,
        this.culler,
        this.settings.foliage,
        this.gfxDist,
        this.settings.graphics === 'low'
      );
      this.audio.updateContinuous(0, false, 0, false, false);
      this.fx.update(dt * 0.35, 0, this.camera.position, false);
    } else if (this.screen === 'paused') {
      this.audio.updateContinuous(0, false, 0, false, false);
    } else {
      this.cameraRig.updateFlyover(course, dt);
      this.culler.update(this.camera);
      this.builtCourse?.update(
        dt,
        null,
        null,
        this.culler,
        this.settings.foliage,
        this.gfxDist,
        this.settings.graphics === 'low'
      );
      this.audio.updateContinuous(0, false, 0, false, false);
      this.fx.update(dt, 0, this.camera.position, false);
    }

    this.sky.update(dt, this.camera.position, this.settings.graphics !== 'low');
    this.updateShadowFrustum();

    this.fpsEma = this.fpsEma * 0.92 + (1 / Math.max(0.001, dt)) * 0.08;
    if (this.settings.graphics === 'high' && this.fpsEma < 40) {
      this.autoDpr = Math.max(1, this.autoDpr * 0.96);
      this.renderer.setPixelRatio(this.autoDpr);
    }

    // Render world with per-pixel depth-reconstructed velocity motion blur
    this.motionBlur.render(
      this.scene,
      this.camera,
      this.player.vx,
      this.player.vy,
      this.player.vz,
      this.cameraRig.angVelYaw,
      this.cameraRig.angVelPitch,
      this.cameraRig.angVelRoll,
      this.settings.motionBlur,
      dt,
      activeMotionBlur
    );

    // Composite crisp first-person hands & power-slide runner leg on top
    if (activeMotionBlur) {
      this.viewModel.renderOverlay(this.renderer, this.camera);
    }
  }
}

new StrideGame();
