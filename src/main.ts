import * as THREE from 'three';
import './style.css';
import { AudioEngine } from './game/audio';
import { CameraRig } from './game/camera';
import { EffectsSystem } from './game/fx';
import { GhostSystem } from './game/ghost';
import { InputManager } from './game/input';
import { PhysicsWorld } from './game/physics';
import { Player } from './game/player';
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
import { CourseRecord, GameScreen } from './types';
import { GameUI } from './ui/hud';
import { BuiltCourse } from './world/builder';
import { COURSES } from './world/courses';
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

    // 2. Scene & Mirror's Edge City of Glass atmospheric haze
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c9e0f5');
    this.scene.fog = new THREE.FogExp2('#d2e5f7', 0.0029);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      900
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

    // 4. World & game systems
    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy());
    this.sky = new SkySystem();
    this.scene.add(this.sky.group);

    this.audio = new AudioEngine();
    this.audio.setVolume(this.settings.volume);

    this.fx = new EffectsSystem(fxCanvas);
    this.scene.add(this.fx.group);

    this.ghost = new GhostSystem();
    this.scene.add(this.ghost.group);

    this.viewModel = new ViewModel();
    this.camera.add(this.viewModel.handRig);
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
      },
      onRecordsCleared: () => {
        this.currentRecord = null;
        this.ghost.setPlaybackGhost([]);
      },
      onUiSound: (accent) => this.audio.playUiClick(accent),
    });

    // Build initial course (01 ROOFTOP) for the live skyline background
    this.loadCourse(0);
    this.ui.showTitle(0);

    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((now) => this.loop(now));
  }

  private createPlayerEvents() {
    return {
      onFootstep: (speed: number, isWall: boolean) => this.audio.playFootstep(speed, isWall),
      onJump: (boosted: boolean) => this.audio.playJump(boosted),
      onLand: (impact: number, intoSlide: boolean) => {
        this.audio.playLand(impact, intoSlide);
        this.cameraRig.addLandingImpact(impact, intoSlide);
      },
      onSlideStart: () => {
        this.audio.playSlideStart();
        this.fx.spawnBurst(this.player.x, this.player.y + 0.1, this.player.z, '#e8edf2', 7);
      },
      onVault: (spring: boolean) => this.audio.playVault(spring),
      onMantle: () => this.audio.playMantle(),
      onWallRunStart: () => this.audio.playWallRunStart(),
      onWallKick: () => this.audio.playWallKick(),
      onGrappleAttach: () => this.audio.playGrappleAttach(),
      onGrappleRelease: (slingshot: boolean) => this.audio.playGrappleRelease(slingshot),
      onLaunchPad: () => {
        this.audio.playLaunchPad();
        this.fx.triggerFlash('160, 238, 255', 0.14);
      },
      onFovPunch: (deg: number) => this.cameraRig.addFovPunch(deg),
      onCheckpoint: (cp: { index: number; x: number; y: number; z: number }, elapsed: number) => {
        this.builtCourse?.markCheckpointReached(cp.index);
        const pbSplit = this.currentRecord?.splits?.[cp.index];
        const delta = typeof pbSplit === 'number' ? elapsed - pbSplit : null;
        const ahead = delta === null || delta <= 0;
        this.audio.playCheckpoint(ahead);
        this.ui.flashSplit(delta, cp.index + 1);
        this.fx.spawnBurst(cp.x, cp.y + 1.2, cp.z, '#15e680', 16);
        this.fx.triggerFlash('80, 255, 165', 0.1);
      },
      onFinish: (elapsed: number, peakSpeed: number, splits: number[]) => {
        this.handleFinish(elapsed, peakSpeed, splits);
      },
      onRespawn: (fullReset: boolean) => {
        this.audio.playReset();
        if (fullReset) {
          this.builtCourse?.resetCheckpoints();
          this.ghost.resetRun();
          this.cameraRig.reset(this.settings.fov);
        }
        this.fx.triggerFlash('255, 255, 255', 0.15);
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

    // Orient sun for course's signature architectural light & shadows
    const ce = Math.cos(course.sunElevation);
    this.sunDir
      .set(
        Math.sin(course.sunAzimuth) * ce,
        Math.sin(course.sunElevation),
        Math.cos(course.sunAzimuth) * ce
      )
      .normalize();
    this.sky.setSunDirection(this.sunDir);

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
    this.viewModel.setVisible(true);
    this.input.clearInputs();
    this.input.gameplayActive = true;
    this.input.finishedActive = false;
    this.screen = 'playing';
    this.ui.showPlaying(course, this.courseIndex);
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
    this.viewModel.setVisible(true);
    this.input.clearInputs();
    this.input.gameplayActive = true;
    this.input.finishedActive = false;
    this.screen = 'playing';
    this.ui.showPlaying(course, this.courseIndex);
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
    this.audio.updateContinuous(0, false, false);
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
    this.fx.triggerFlash('255, 255, 255', 0.28);
    this.fx.spawnBurst(course.finish.x, course.finish.y + 2, course.finish.z, '#15e680', 26);

    this.screen = 'finished';
    this.input.gameplayActive = false;
    this.input.finishedActive = true;
    this.input.clearInputs();
    this.input.exitLock();
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
    this.ghost.resetRun();
    this.ui.showCourses(this.courseIndex);
  }

  private updateShadowFrustum(): void {
    // Snap shadow target to 1m grid around camera so shadows remain razor-sharp with zero shimmer
    const sx = Math.round(this.camera.position.x);
    const sy = Math.round(this.camera.position.y);
    const sz = Math.round(this.camera.position.z);
    this.sunLight.target.position.set(sx, sy, sz);
    this.sunLight.position.set(
      sx + this.sunDir.x * 78,
      sy + this.sunDir.y * 78,
      sz + this.sunDir.z * 78
    );
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.fx.resize();
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = (now - this.lastFrameTime) * 0.001;
    this.lastFrameTime = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));
    const course = COURSES[this.courseIndex];

    if (this.screen === 'playing') {
      // Apply mouse/key look immediately per render frame for zero input latency
      const [dYaw, dPitch] = this.input.consumeLookDelta(this.settings.sensitivity, dt);
      this.player.yaw += dYaw;
      this.player.pitch = Math.max(-1.46, Math.min(1.46, this.player.pitch + dPitch));

      // Fixed 120 Hz swept parkour simulation
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
        const alpha = this.accumulator / FIXED_DT;
        this.cameraRig.updateGameplay(
          this.player,
          alpha,
          dt,
          this.settings.fov,
          this.input.state.right
        );
        this.viewModel.update(this.player, dt, this.camera);
        this.ghost.updatePlayback(this.player, this.settings.showGhost);
        this.builtCourse?.update(
          dt,
          this.player.lockedGrapple?.id ?? null,
          this.player.activeGrapple?.id ?? null
        );
        this.audio.updateContinuous(
          this.player.totalSpeed,
          this.player.state === 'slide' && this.player.grounded,
          true
        );
        this.fx.update(dt, this.player.horizSpeed, this.camera.position, true);
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
      // Smooth dramatic slow-motion coast past the finish arch
      this.player.step(this.input.state, dt);
      this.cameraRig.updateGameplay(this.player, 1, dt, this.settings.fov, 0);
      this.builtCourse?.update(dt * 0.25, null, null);
      this.audio.updateContinuous(0, false, false);
      this.fx.update(dt * 0.35, 0, this.camera.position, false);
    } else if (this.screen === 'paused') {
      // Freeze gameplay cleanly on pause
      this.audio.updateContinuous(0, false, false);
    } else {
      // Live 3D sunlit skyline camera sweep behind Title & Course Select!
      this.cameraRig.updateFlyover(course, dt);
      this.builtCourse?.update(dt, null, null);
      this.audio.updateContinuous(0, false, false);
      this.fx.update(dt, 0, this.camera.position, false);
    }

    this.sky.update(dt, this.camera.position);
    this.updateShadowFrustum();
    this.renderer.render(this.scene, this.camera);
  }
}

new StrideGame();
