import { CheckpointDef, CourseDef, GrappleDef, MoveState } from '../types';
import { PhysicsWorld, SolidRamp } from './physics';

export interface PlayerInputState {
  forward: number; // -1 .. +1 (+1 = W)
  right: number;   // -1 .. +1 (+1 = D)
  jumpHeld: boolean;
  jumpBufferTimer: number;
  slideHeld: boolean;
  slideBufferTimer: number;
  grappleHeld: boolean;
  grappleBufferTimer: number;
}

export interface PlayerEvents {
  onFootstep?: (speed: number, isWall: boolean) => void;
  onJump?: (boosted: boolean) => void;
  onLand?: (impact: number, intoSlide: boolean) => void;
  onSlideStart?: (speed: number) => void;
  onSlideEnd?: () => void;
  onVault?: (spring: boolean) => void;
  onMantle?: () => void;
  onWallRunStart?: (side: -1 | 1) => void;
  onWallKick?: (side: -1 | 1) => void;
  onGrappleAttach?: (anchor: GrappleDef) => void;
  onGrappleRelease?: (slingshot: boolean) => void;
  onLaunchPad?: () => void;
  onCheckpoint?: (cp: CheckpointDef, elapsed: number) => void;
  onFinish?: (elapsed: number, peakSpeed: number, splits: number[]) => void;
  onRespawn?: (fullReset: boolean) => void;
  onFovPunch?: (amount: number) => void;
}

export const PLAYER_RADIUS = 0.38;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.88;
export const STAND_EYE = 1.64;
export const SLIDE_EYE = 0.76;

const GRAVITY = 24.0;
const BASE_RUN_SPEED = 11.2;
const FLOW_RUN_SPEED = 12.6; // Reached after 1.5s of clean uninterrupted sprint
const GROUND_ACCEL = 62.0;
const GROUND_FRICTION = 52.0;
const OVER_SPEED_DRAG = 5.2; // Gentle bleed when running faster than FLOW_RUN_SPEED so boosts carry!
const AIR_ACCEL = 22.0;
const AIR_STRAFE_WISH_CAP = 3.2;
const JUMP_VEL = 9.5;
const COYOTE_TIME = 0.14;
const SLIDE_BOOST_MIN = 15.2;
const SLIDE_BOOST_ADD = 3.1;
const SLIDE_MAX_SPEED = 24.5;
const SLIDE_FLAT_FRICTION = 6.2;
const SLIDE_MIN_SPEED = 5.4;
const WALLRUN_GRAVITY = 5.2;
const WALLRUN_MAX_TIME = 1.75;
const WALLRUN_MIN_SPEED = 14.0;
const MAX_HORIZ_SPEED = 27.5;

export class Player {
  // Interpolated previous & current position (feet)
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  x = 0;
  y = 0;
  z = 0;

  vx = 0;
  vy = 0;
  vz = 0;

  yaw = 0;
  pitch = 0;

  state: MoveState = 'idle';
  grounded = false;
  crouched = false;
  currentRamp: SolidRamp | null = null;

  // Timers
  coyoteTimer = 0;
  landingGraceTimer = 0; // Preserves speed for slide-hops / b-hops
  flowBuild = 0;         // 0..1 gradual runner's momentum
  slideTimer = 0;
  slideBoostCooldown = 0;
  launchCooldown = 0;
  grappleCooldown = 0;

  // Wall-run tracking
  wallSide: -1 | 1 = 1;
  wallNx = 0;
  wallNz = 0;
  wallId: string | null = null;
  lastWallId: string | null = null;
  sameWallCooldown = 0;
  wallTimer = 0;

  // Vault / Mantle tracking
  actionTimer = 0;
  actionDuration = 0.22;
  actionStartX = 0;
  actionStartY = 0;
  actionStartZ = 0;
  actionTargetX = 0;
  actionTargetY = 0;
  actionTargetZ = 0;
  vaultDirX = 0;
  vaultDirZ = 0;
  vaultSpeed = 0;
  vaultSpringUsed = false;

  // Grapple tracking
  activeGrapple: GrappleDef | null = null;
  lockedGrapple: GrappleDef | null = null;
  lastGrappleId: string | null = null;
  grappleRopeLen = 0;
  grappleTimer = 0;

  // Footstep phase (also drives camera bob + hand swing)
  stridePhase = 0;
  private lastStepIndex = 0;

  // Course / run progress
  runStarted = false;
  runFinished = false;
  runTime = 0;
  peakSpeed = 0;
  checkpointIndex = 0; // Number of checkpoints reached
  splits: number[] = [];
  respawnX = 0;
  respawnY = 0;
  respawnZ = 0;
  respawnYaw = 0;

  // Last landing impact for camera dip
  lastLandImpact = 0;

  events: PlayerEvents = {};

  constructor(
    public world: PhysicsWorld,
    public course: CourseDef,
    events: PlayerEvents = {}
  ) {
    this.events = events;
    this.resetCourse(false);
  }

  setCourse(world: PhysicsWorld, course: CourseDef): void {
    this.world = world;
    this.course = course;
    this.resetCourse(false);
  }

  resetCourse(emitEvent = true): void {
    this.respawnX = this.course.spawn[0];
    this.respawnY = this.course.spawn[1];
    this.respawnZ = this.course.spawn[2];
    this.respawnYaw = this.course.spawnYaw;
    this.checkpointIndex = 0;
    this.splits = [];
    this.runStarted = false;
    this.runFinished = false;
    this.runTime = 0;
    this.peakSpeed = 0;
    this.teleportToRespawn();
    if (emitEvent) this.events.onRespawn?.(true);
  }

  respawnAtCheckpoint(emitEvent = true): void {
    if (this.runFinished) {
      this.resetCourse(emitEvent);
      return;
    }
    if (this.checkpointIndex === 0) {
      // On start segment, checkpoint respawn cleanly restarts timer at 00:00
      this.resetCourse(emitEvent);
      return;
    }
    this.teleportToRespawn();
    if (emitEvent) this.events.onRespawn?.(false);
  }

  private teleportToRespawn(): void {
    if (this.state === 'slide') this.events.onSlideEnd?.();
    if (this.state === 'grapple') this.events.onGrappleRelease?.(false);

    this.x = this.respawnX;
    this.y = this.respawnY;
    this.z = this.respawnZ;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = this.respawnYaw;
    this.pitch = -0.03;

    this.state = 'idle';
    this.grounded = true;
    this.crouched = false;
    this.currentRamp = null;
    this.coyoteTimer = COYOTE_TIME;
    this.landingGraceTimer = 0;
    this.flowBuild = 0;
    this.slideTimer = 0;
    this.slideBoostCooldown = 0;
    this.launchCooldown = 0;
    this.grappleCooldown = 0;
    this.wallId = null;
    this.lastWallId = null;
    this.sameWallCooldown = 0;
    this.wallTimer = 0;
    this.activeGrapple = null;
    this.lastGrappleId = null;
    this.grappleTimer = 0;
    this.vaultSpringUsed = false;
  }

  get horizSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get totalSpeed(): number {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  get eyeHeight(): number {
    return this.crouched || this.state === 'slide' ? SLIDE_EYE : STAND_EYE;
  }

  getLookDir(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  getHorizForward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  getHorizRight(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  step(input: PlayerInputState, dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.lastLandImpact = 0;

    // Post-finish slow-mo coast
    if (this.runFinished) {
      this.stepFinishCoast(dt);
      return;
    }

    // Start run clock on first player action
    const hasAction =
      Math.abs(input.forward) > 0.01 ||
      Math.abs(input.right) > 0.01 ||
      input.jumpBufferTimer > 0 ||
      input.slideBufferTimer > 0 ||
      input.grappleBufferTimer > 0;

    if (!this.runStarted && hasAction) {
      this.runStarted = true;
    }
    if (this.runStarted) {
      this.runTime += dt;
    }

    // Tick cooldowns & buffers
    this.slideBoostCooldown = Math.max(0, this.slideBoostCooldown - dt);
    this.launchCooldown = Math.max(0, this.launchCooldown - dt);
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.sameWallCooldown = Math.max(0, this.sameWallCooldown - dt);
    this.landingGraceTimer = Math.max(0, this.landingGraceTimer - dt);
    if (this.sameWallCooldown <= 0 && this.state !== 'wallrun') {
      this.lastWallId = null;
    }

    const [lookX, lookY, lookZ] = this.getLookDir();
    const eyeY = this.y + this.eyeHeight;

    // Continuously update best grapple lock candidate for HUD reticle
    const lockCandidate =
      this.state !== 'grapple' && this.grappleCooldown <= 0
        ? this.world.findBestGrapple(
            this.x,
            eyeY,
            this.z,
            lookX,
            lookY,
            lookZ,
            this.lastGrappleId
          )
        : null;
    this.lockedGrapple = lockCandidate ? lockCandidate.anchor : null;

    // Trigger grapple if requested and lock available
    if (
      input.grappleBufferTimer > 0 &&
      this.lockedGrapple &&
      this.state !== 'grapple' &&
      this.state !== 'mantle'
    ) {
      input.grappleBufferTimer = 0;
      this.startGrapple(this.lockedGrapple);
    }

    // Dispatch movement state machine
    switch (this.state) {
      case 'vault':
        this.stepVault(input, dt);
        break;
      case 'mantle':
        this.stepMantle(input, dt);
        break;
      case 'grapple':
        this.stepGrapple(input, dt);
        break;
      case 'wallrun':
        this.stepWallRun(input, dt);
        break;
      case 'slide':
        this.stepSlide(input, dt);
        break;
      default:
        this.stepStandard(input, dt);
        break;
    }

    // Cap extreme horizontal speed for stability
    const hs = this.horizSpeed;
    if (hs > MAX_HORIZ_SPEED) {
      const s = MAX_HORIZ_SPEED / hs;
      this.vx *= s;
      this.vz *= s;
    }
    if (this.runStarted && this.horizSpeed > this.peakSpeed) {
      this.peakSpeed = this.horizSpeed;
    }

    // Check launch pads
    if (this.launchCooldown <= 0 && this.state !== 'mantle') {
      const pad = this.world.checkLaunchPad(this.x, this.y, this.z, PLAYER_RADIUS);
      if (pad) {
        if (this.state === 'slide') this.events.onSlideEnd?.();
        if (this.state === 'grapple') {
          this.activeGrapple = null;
          this.events.onGrappleRelease?.(false);
        }
        // Carry forward momentum if already faster along pad direction
        const padHoriz = Math.hypot(pad.vx, pad.vz);
        if (padHoriz > 0.1) {
          const pdx = pad.vx / padHoriz;
          const pdz = pad.vz / padHoriz;
          const curAlong = this.vx * pdx + this.vz * pdz;
          const boostHoriz = Math.max(padHoriz, curAlong + 2.5);
          this.vx = pdx * boostHoriz;
          this.vz = pdz * boostHoriz;
        }
        this.vy = pad.vy;
        this.grounded = false;
        this.crouched = false;
        this.currentRamp = null;
        this.coyoteTimer = 0;
        this.lastWallId = null;
        this.lastGrappleId = null;
        this.launchCooldown = 0.28;
        this.state = 'air';
        this.events.onLaunchPad?.();
        this.events.onFovPunch?.(6.5);
      }
    }

    // Check checkpoints
    const cp = this.world.checkCheckpoint(this.x, this.y, this.z, this.checkpointIndex);
    if (cp) {
      // Fill any skipped intermediate checkpoints (if player took a huge shortcut!)
      while (this.checkpointIndex <= cp.index) {
        this.splits[this.checkpointIndex] = this.runTime;
        this.checkpointIndex++;
      }
      this.respawnX = cp.x;
      this.respawnY = cp.y + 0.05;
      this.respawnZ = cp.z;
      this.respawnYaw = cp.spawnYaw;
      this.events.onCheckpoint?.(cp, this.runTime);
    }

    // Check finish gate
    if (this.world.checkFinish(this.x, this.y, this.z)) {
      if (!this.runStarted) this.runStarted = true;
      if (this.state === 'slide') this.events.onSlideEnd?.();
      if (this.state === 'grapple') {
        this.activeGrapple = null;
        this.events.onGrappleRelease?.(false);
      }
      this.runFinished = true;
      this.events.onFinish?.(this.runTime, this.peakSpeed, [...this.splits]);
      return;
    }

    // Out-of-bounds abyss respawn
    if (this.y < this.world.killY) {
      this.respawnAtCheckpoint(true);
    }
  }

  private stepFinishCoast(dt: number): void {
    const slowDt = dt * 0.22;
    this.vx *= Math.max(0, 1 - 1.8 * slowDt);
    this.vz *= Math.max(0, 1 - 1.8 * slowDt);
    if (!this.grounded) {
      this.vy -= GRAVITY * slowDt;
    }
    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      this.vx,
      this.vy,
      this.vz,
      PLAYER_RADIUS,
      STAND_HEIGHT,
      this.grounded,
      this.currentRamp,
      slowDt,
      true
    );
    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    this.vx = res.vx;
    this.vy = res.vy;
    this.vz = res.vz;
    this.grounded = res.grounded;
    this.currentRamp = res.onRamp;
  }

  private getWishDir(input: PlayerInputState): [number, number, number] {
    const [fx, fz] = this.getHorizForward();
    const [rx, rz] = this.getHorizRight();
    let wx = fx * input.forward + rx * input.right;
    let wz = fz * input.forward + rz * input.right;
    const len = Math.hypot(wx, wz);
    if (len > 1e-4) {
      wx /= len;
      wz /= len;
      return [wx, wz, Math.min(1, len)];
    }
    return [0, 0, 0];
  }

  private stepStandard(input: PlayerInputState, dt: number): void {
    const [wishX, wishZ, wishMag] = this.getWishDir(input);
    const [fwdX, fwdZ] = this.getHorizForward();

    // Update coyote timer
    if (this.grounded) {
      this.coyoteTimer = COYOTE_TIME;
      this.lastWallId = null;
      this.lastGrappleId = null;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // Check if stuck crouched under low obstacle
    if (this.crouched && this.canStandUp()) {
      this.crouched = false;
    }

    // Initiate slide on ground if requested
    if (
      this.grounded &&
      !this.crouched &&
      (input.slideBufferTimer > 0 || (input.slideHeld && this.isOnDownhillRamp())) &&
      this.horizSpeed > 6.2
    ) {
      input.slideBufferTimer = 0;
      this.startSlide();
      this.stepSlide(input, dt);
      return;
    }

    // Ground vs Air acceleration
    let jumpedThisStep = false;
    if (this.grounded) {
      const hs = this.horizSpeed;

      if (wishMag > 0.05) {
        // Build runner flow while sprinting forward
        if (input.forward > 0.3 && hs > 8.5) {
          this.flowBuild = Math.min(1, this.flowBuild + dt * 0.65);
        }
        const targetSpeed = this.crouched
          ? 6.0
          : BASE_RUN_SPEED + (FLOW_RUN_SPEED - BASE_RUN_SPEED) * this.flowBuild;

        // If carrying momentum above targetSpeed, bleed gently instead of hard-clamping!
        if (hs > targetSpeed + 0.2) {
          const drag = this.landingGraceTimer > 0 ? OVER_SPEED_DRAG * 0.25 : OVER_SPEED_DRAG;
          const kept = Math.max(targetSpeed, hs - drag * dt);
          // Smoothly steer velocity toward wishDir while preserving high speed
          const curDx = this.vx / hs;
          const curDz = this.vz / hs;
          const turnRate = Math.min(1, 7.5 * dt);
          let ndx = curDx + (wishX - curDx) * turnRate;
          let ndz = curDz + (wishZ - curDz) * turnRate;
          const nl = Math.hypot(ndx, ndz) || 1;
          ndx /= nl;
          ndz /= nl;
          this.vx = ndx * kept;
          this.vz = ndz * kept;
        } else {
          // Crisp acceleration toward targetSpeed * wishDir
          const goalVx = wishX * targetSpeed;
          const goalVz = wishZ * targetSpeed;
          const dvx = goalVx - this.vx;
          const dvz = goalVz - this.vz;
          const dLen = Math.hypot(dvx, dvz);
          const maxDelta = GROUND_ACCEL * dt;
          if (dLen <= maxDelta) {
            this.vx = goalVx;
            this.vz = goalVz;
          } else {
            this.vx += (dvx / dLen) * maxDelta;
            this.vz += (dvz / dLen) * maxDelta;
          }
        }
      } else {
        // Snappy stop
        this.flowBuild = Math.max(0, this.flowBuild - dt * 2.5);
        if (hs <= GROUND_FRICTION * dt) {
          this.vx = 0;
          this.vz = 0;
        } else {
          const drop = (hs - GROUND_FRICTION * dt) / hs;
          this.vx *= drop;
          this.vz *= drop;
        }
      }

      // Subtle natural downhill boost even while running
      if (this.currentRamp) {
        const downDot = -(this.vx * this.currentRamp.upX + this.vz * this.currentRamp.upZ);
        if (downDot > 3.0) {
          const add = this.currentRamp.slope * 7.5 * dt;
          this.vx -= this.currentRamp.upX * add;
          this.vz -= this.currentRamp.upZ * add;
        }
      }
    } else {
      // Air movement: responsive forward/air control + Quake-style air-strafe preserves all speed
      if (wishMag > 0.05) {
        const curProj = this.vx * wishX + this.vz * wishZ;
        const maxWish =
          this.horizSpeed > BASE_RUN_SPEED ? AIR_STRAFE_WISH_CAP + 4.5 : BASE_RUN_SPEED;
        const addSpeed = maxWish - curProj;
        if (addSpeed > 0) {
          const accelSpeed = Math.min(addSpeed, AIR_ACCEL * dt);
          this.vx += wishX * accelSpeed;
          this.vz += wishZ * accelSpeed;
        }
        // Slight gentle air redirect when moving slower so ledge adjustments feel crisp
        if (this.horizSpeed < BASE_RUN_SPEED * 1.05) {
          this.vx += (wishX * BASE_RUN_SPEED - this.vx) * Math.min(1, 2.2 * dt);
          this.vz += (wishZ * BASE_RUN_SPEED - this.vz) * Math.min(1, 2.2 * dt);
        }
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -38) this.vy = -38;
    }

    // Jump (with coyote time + jump buffer!)
    if (input.jumpBufferTimer > 0 && this.coyoteTimer > 0 && !this.crouched) {
      input.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      let jumpVy = JUMP_VEL;
      // Jumping off a red upward ramp stacks ramp lift cleanly!
      let boosted = false;
      if (this.currentRamp) {
        const upSpd = this.vx * this.currentRamp.upX + this.vz * this.currentRamp.upZ;
        if (upSpd > 4.0) {
          jumpVy += Math.min(4.2, upSpd * this.currentRamp.slope * 0.65);
          if (this.currentRamp.style === 'rampRed') {
            this.vx += this.currentRamp.upX * 1.8;
            this.vz += this.currentRamp.upZ * 1.8;
            boosted = true;
            this.events.onFovPunch?.(4.0);
          }
        }
      }
      this.vy = jumpVy;
      this.grounded = false;
      this.currentRamp = null;
      jumpedThisStep = true;
      this.events.onJump?.(boosted || this.horizSpeed > 14.0);
    }

    // Move & collide
    const wasGrounded = this.grounded;
    const prevRamp = this.currentRamp;
    const h = this.crouched ? SLIDE_HEIGHT : STAND_HEIGHT;
    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      this.vx,
      this.vy,
      this.vz,
      PLAYER_RADIUS,
      h,
      wasGrounded,
      prevRamp,
      dt,
      !jumpedThisStep
    );

    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    this.vx = res.vx;
    this.vy = res.vy;
    this.vz = res.vz;
    this.grounded = res.grounded;
    this.currentRamp = res.onRamp;

    if (res.leftRedRamp) {
      this.events.onJump?.(true);
      this.events.onFovPunch?.(4.5);
    }

    // Handle landing!
    if (!wasGrounded && this.grounded) {
      this.landingGraceTimer = 0.14;
      this.lastLandImpact = res.landedImpact;

      // Landing-slide! If holding Shift/C (or buffered slide) on landing with speed -> instant smooth slide!
      const wantsSlide =
        (input.slideHeld || input.slideBufferTimer > 0) &&
        (this.horizSpeed > 6.0 || this.isOnDownhillRamp());
      if (wantsSlide) {
        input.slideBufferTimer = 0;
        this.events.onLand?.(res.landedImpact, true);
        this.startSlide();
        return;
      }
      if (res.landedImpact > 2.2) {
        this.events.onLand?.(res.landedImpact, false);
      }
    }

    // Check auto-vault & auto-mantle when pressing forward
    if (input.forward > 0.2 && !this.crouched) {
      const probeDirX = wishMag > 0.2 ? wishX : fwdX;
      const probeDirZ = wishMag > 0.2 ? wishZ : fwdZ;
      const ledge = this.world.findLedgeOrVault(
        this.x,
        this.y,
        this.z,
        probeDirX,
        probeDirZ,
        PLAYER_RADIUS,
        this.grounded,
        this.vy
      );
      if (ledge) {
        if (ledge.kind === 'vault' && this.horizSpeed > 2.5) {
          this.startVault(ledge.topY, probeDirX, probeDirZ, input);
          return;
        }
        if (ledge.kind === 'mantle') {
          this.startMantle(ledge.targetX, ledge.topY, ledge.targetZ);
          return;
        }
      }
    }

    // Check wall-run initiation when airborne!
    if (!this.grounded && input.forward > 0.1 && this.horizSpeed > 6.2 && this.vy < 8.8) {
      const exclude = this.sameWallCooldown > 0 ? this.lastWallId : null;
      const wall = this.world.findWallRunCandidate(
        this.x,
        this.y,
        this.z,
        fwdX,
        fwdZ,
        PLAYER_RADIUS,
        exclude
      );
      if (wall) {
        this.startWallRun(wall.wallId, wall.nx, wall.nz, wall.side, wall.isRunnerWall);
        return;
      }
    }

    // Update state & footstep rhythm
    if (this.grounded) {
      const hs = this.horizSpeed;
      if (hs > 0.8) {
        this.state = 'run';
        // ~2.85 steps/sec at 11 m/s, faster at higher speeds
        const stepRate = 1.9 + hs * 0.115;
        this.stridePhase += dt * stepRate * Math.PI;
        const stepIdx = Math.floor(this.stridePhase / Math.PI);
        if (stepIdx !== this.lastStepIndex) {
          this.lastStepIndex = stepIdx;
          this.events.onFootstep?.(hs, false);
        }
      } else {
        this.state = 'idle';
      }
    } else {
      this.state = 'air';
    }
  }

  private isOnDownhillRamp(): boolean {
    if (!this.currentRamp) return false;
    const [fx, fz] = this.getHorizForward();
    const downDot = -(fx * this.currentRamp.upX + fz * this.currentRamp.upZ);
    return downDot > 0.45 && this.currentRamp.slope > 0.1;
  }

  private canStandUp(): boolean {
    return this.world.hasHeadroom(
      this.x,
      this.y + 0.02,
      this.z,
      PLAYER_RADIUS * 0.9,
      STAND_HEIGHT - 0.03
    );
  }

  private startSlide(): void {
    this.state = 'slide';
    this.crouched = true;
    this.slideTimer = 0;

    const hs = this.horizSpeed;
    const [fx, fz] = this.getHorizForward();
    const dirX = hs > 2.0 ? this.vx / hs : fx;
    const dirZ = hs > 2.0 ? this.vz / hs : fz;

    let newSpeed = hs;
    if (this.slideBoostCooldown <= 0) {
      newSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(SLIDE_BOOST_MIN, hs + SLIDE_BOOST_ADD));
      this.slideBoostCooldown = 0.52;
      this.events.onFovPunch?.(3.8);
    } else {
      newSpeed = Math.max(hs, 11.5);
    }

    this.vx = dirX * newSpeed;
    this.vz = dirZ * newSpeed;
    this.events.onSlideStart?.(newSpeed);
  }

  private stepSlide(input: PlayerInputState, dt: number): void {
    this.slideTimer += dt;
    const hs = this.horizSpeed;

    // Gentle lateral steering during slide
    if (hs > 1.0 && Math.abs(input.right) > 0.05) {
      const [rx, rz] = this.getHorizRight();
      const steer = input.right * 7.5 * dt;
      let ndx = this.vx + rx * steer;
      let ndz = this.vz + rz * steer;
      const nl = Math.hypot(ndx, ndz) || 1;
      this.vx = (ndx / nl) * hs;
      this.vz = (ndz / nl) * hs;
    }

    // Slope physics: accelerate downhill, decelerate uphill, smooth friction on flat!
    let onDownSlope = false;
    if (this.currentRamp) {
      const upDot = this.vx * this.currentRamp.upX + this.vz * this.currentRamp.upZ;
      const slopeAccel = GRAVITY * this.currentRamp.slope * 0.72;
      if (upDot < -1.0) {
        // Sliding DOWNHILL — build thrilling speed!
        onDownSlope = true;
        this.vx -= this.currentRamp.upX * slopeAccel * dt;
        this.vz -= this.currentRamp.upZ * slopeAccel * dt;
        const curS = this.horizSpeed;
        if (curS > SLIDE_MAX_SPEED) {
          this.vx = (this.vx / curS) * SLIDE_MAX_SPEED;
          this.vz = (this.vz / curS) * SLIDE_MAX_SPEED;
        }
      } else {
        // Sliding uphill decelerates faster
        const decel = (SLIDE_FLAT_FRICTION + slopeAccel * 0.7) * dt;
        const nextS = Math.max(0, hs - decel);
        if (hs > 0.01) {
          this.vx = (this.vx / hs) * nextS;
          this.vz = (this.vz / hs) * nextS;
        }
      }
    } else {
      // Flat slide: first 0.22s holds boost nearly frictionless so ducking barriers feels slick!
      const fric = this.slideTimer < 0.22 ? SLIDE_FLAT_FRICTION * 0.3 : SLIDE_FLAT_FRICTION;
      const nextS = Math.max(0, hs - fric * dt);
      if (hs > 0.01) {
        this.vx = (this.vx / hs) * nextS;
        this.vz = (this.vz / hs) * nextS;
      }
    }

    // Slide-Hop! Pressing Space during slide with headroom pops you out carrying full momentum!
    let slideJumped = false;
    if (input.jumpBufferTimer > 0 && this.canStandUp()) {
      input.jumpBufferTimer = 0;
      this.vy = JUMP_VEL * 0.97;
      const curS = this.horizSpeed;
      if (curS > 8.0 && curS < SLIDE_MAX_SPEED) {
        const boosted = Math.min(SLIDE_MAX_SPEED, curS + 0.8);
        this.vx = (this.vx / curS) * boosted;
        this.vz = (this.vz / curS) * boosted;
      }
      this.grounded = false;
      this.crouched = false;
      this.currentRamp = null;
      this.coyoteTimer = 0;
      this.state = 'air';
      slideJumped = true;
      this.events.onSlideEnd?.();
      this.events.onJump?.(true);
      this.events.onFovPunch?.(2.8);
    }

    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
    }

    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      this.vx,
      this.vy,
      this.vz,
      PLAYER_RADIUS,
      slideJumped ? STAND_HEIGHT : SLIDE_HEIGHT,
      !slideJumped,
      this.currentRamp,
      dt,
      !slideJumped
    );

    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    this.vx = res.vx;
    this.vy = res.vy;
    this.vz = res.vz;
    this.grounded = res.grounded;
    this.currentRamp = res.onRamp;

    if (slideJumped) return;

    const canStand = this.canStandUp();

    // If trapped under a low barrier and slowed down, keep a minimum crawl-slide push so player never gets stuck!
    if (!canStand && this.horizSpeed < 8.5) {
      const [fx, fz] = this.getHorizForward();
      const dx = this.horizSpeed > 0.5 ? this.vx / this.horizSpeed : fx;
      const dz = this.horizSpeed > 0.5 ? this.vz / this.horizSpeed : fz;
      this.vx = dx * 8.5;
      this.vz = dz * 8.5;
    }

    // End slide conditions: slid off a ledge, released key (after min 0.28s), or slowed down on flat
    const releasedSlide = !input.slideHeld && this.slideTimer >= 0.30;
    const expiredFlat = !onDownSlope && this.slideTimer >= 1.15 && canStand;
    const tooSlow = this.horizSpeed < SLIDE_MIN_SPEED && canStand;

    if (!this.grounded) {
      // Slid right off a rooftop lip — give generous coyote time so slide-off jumps feel amazing!
      this.coyoteTimer = COYOTE_TIME + 0.04;
      this.crouched = !canStand;
      this.state = 'air';
      this.events.onSlideEnd?.();
    } else if ((releasedSlide || expiredFlat || tooSlow) && canStand) {
      this.crouched = false;
      this.landingGraceTimer = 0.1;
      this.state = 'run';
      this.events.onSlideEnd?.();
    }
  }

  private startVault(
    topY: number,
    dirX: number,
    dirZ: number,
    input: PlayerInputState
  ): void {
    const spring = input.jumpBufferTimer > 0;
    if (spring) input.jumpBufferTimer = 0;

    this.state = 'vault';
    this.actionTimer = 0;
    this.actionDuration = 0.21;
    this.actionStartY = this.y;
    this.actionTargetY = topY + 0.1;
    this.vaultDirX = dirX;
    this.vaultDirZ = dirZ;
    this.vaultSpringUsed = spring;

    const baseBoost = spring ? 16.4 : 15.0;
    const addBoost = spring ? 3.2 : 2.2;
    this.vaultSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(baseBoost, this.horizSpeed + addBoost));
    this.vx = dirX * this.vaultSpeed;
    this.vz = dirZ * this.vaultSpeed;
    this.vy = 0;
    this.grounded = false;
    this.currentRamp = null;
    this.flowBuild = 1;

    this.events.onVault?.(spring);
    this.events.onFovPunch?.(spring ? 5.2 : 3.6);
  }

  private stepVault(input: PlayerInputState, dt: number): void {
    this.actionTimer += dt;
    const t = Math.min(1, this.actionTimer / this.actionDuration);

    // Allow late spring-vault timing during vault animation!
    if (!this.vaultSpringUsed && input.jumpBufferTimer > 0) {
      input.jumpBufferTimer = 0;
      this.vaultSpringUsed = true;
      this.vaultSpeed = Math.min(SLIDE_MAX_SPEED, this.vaultSpeed + 1.5);
      this.events.onFovPunch?.(2.5);
    }

    // Smoothly lift feet over obstacle crest
    const ease = 1 - (1 - t) * (1 - t);
    const arcLift = Math.sin(t * Math.PI) * 0.22;
    this.y = this.actionStartY + (this.actionTargetY - this.actionStartY) * ease + arcLift;

    this.vx = this.vaultDirX * this.vaultSpeed;
    this.vz = this.vaultDirZ * this.vaultSpeed;

    // Move horizontally with collision above the obstacle crest
    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      this.vx,
      0,
      this.vz,
      PLAYER_RADIUS,
      STAND_HEIGHT - 0.15,
      false,
      null,
      dt,
      false
    );
    this.x = res.x;
    this.z = res.z;

    if (t >= 1) {
      this.vy = this.vaultSpringUsed ? 6.4 : 2.4;
      this.vx = this.vaultDirX * this.vaultSpeed;
      this.vz = this.vaultDirZ * this.vaultSpeed;
      this.grounded = false;
      this.lastWallId = null;
      this.lastGrappleId = null;
      this.state = 'air';
    }
  }

  private startMantle(targetX: number, topY: number, targetZ: number): void {
    this.state = 'mantle';
    this.actionTimer = 0;
    this.actionDuration = 0.27;
    this.actionStartX = this.x;
    this.actionStartY = this.y;
    this.actionStartZ = this.z;
    this.actionTargetX = targetX;
    this.actionTargetY = topY + 0.02;
    this.actionTargetZ = targetZ;
    this.vaultSpeed = Math.max(9.6, this.horizSpeed * 0.78);
    this.vy = 0;
    this.grounded = false;
    this.currentRamp = null;
    this.events.onMantle?.();
  }

  private stepMantle(input: PlayerInputState, dt: number): void {
    this.actionTimer += dt;
    const t = Math.min(1, this.actionTimer / this.actionDuration);

    // Rise up quickly first, then surge forward over the lip
    const yT = Math.min(1, t / 0.68);
    const yEase = 1 - (1 - yT) * (1 - yT);
    const xzT = Math.max(0, (t - 0.22) / 0.78);
    const xzEase = 1 - (1 - xzT) * (1 - xzT);

    this.y = this.actionStartY + (this.actionTargetY - this.actionStartY) * yEase;
    this.x = this.actionStartX + (this.actionTargetX - this.actionStartX) * xzEase;
    this.z = this.actionStartZ + (this.actionTargetZ - this.actionStartZ) * xzEase;

    if (t >= 1) {
      const [fx, fz] = this.getHorizForward();
      const speed = input.forward > 0.1 ? this.vaultSpeed : 4.5;
      this.vx = fx * speed;
      this.vz = fz * speed;
      this.vy = 0;
      this.grounded = true;
      this.coyoteTimer = COYOTE_TIME;
      this.lastWallId = null;
      this.lastGrappleId = null;
      this.state = 'run';
    }
  }

  private startWallRun(
    wallId: string,
    nx: number,
    nz: number,
    side: -1 | 1,
    isRunnerWall: boolean
  ): void {
    this.state = 'wallrun';
    this.wallId = wallId;
    this.wallNx = nx;
    this.wallNz = nz;
    this.wallSide = side;
    this.wallTimer = 0;
    this.lastGrappleId = null;

    // Align velocity along wall tangent matching forward look
    const [fx, fz] = this.getHorizForward();
    let tx = -nz;
    let tz = nx;
    if (tx * fx + tz * fz < 0) {
      tx = -tx;
      tz = -tz;
    }

    const boostMin = isRunnerWall ? WALLRUN_MIN_SPEED + 0.8 : WALLRUN_MIN_SPEED;
    const newSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(boostMin, this.horizSpeed + 1.6));
    this.vx = tx * newSpeed;
    this.vz = tz * newSpeed;
    // Crisp upward arc entry (kills fall and curves slightly upward first!)
    this.vy = Math.max(2.6, Math.min(4.8, this.vy * 0.45 + 2.8));
    this.flowBuild = 1;

    this.events.onWallRunStart?.(side);
    this.events.onFovPunch?.(3.2);
  }

  private stepWallRun(input: PlayerInputState, dt: number): void {
    this.wallTimer += dt;

    // Wall-kick jump!
    if (input.jumpBufferTimer > 0) {
      input.jumpBufferTimer = 0;
      const [fx, fz] = this.getHorizForward();
      const curSpd = this.horizSpeed;

      // Blend wall tangent, look direction, and crisp push away from wall!
      let tx = -this.wallNz;
      let tz = this.wallNx;
      if (tx * this.vx + tz * this.vz < 0) {
        tx = -tx;
        tz = -tz;
      }

      const forwardSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(15.2, curSpd + 1.5));
      // Allow player's camera angle to aim the wall-kick while guaranteeing clean wall separation
      const kickAway = 7.4;
      let nvx = tx * forwardSpeed * 0.72 + fx * forwardSpeed * 0.34 + this.wallNx * kickAway;
      let nvz = tz * forwardSpeed * 0.72 + fz * forwardSpeed * 0.34 + this.wallNz * kickAway;

      // Normalize to crisp predictable speed so wall-to-wall chains feel awesome
      const nl = Math.hypot(nvx, nvz) || 1;
      const targetKickHoriz = Math.min(SLIDE_MAX_SPEED, Math.max(16.0, curSpd + 1.8));
      nvx = (nvx / nl) * targetKickHoriz;
      nvz = (nvz / nl) * targetKickHoriz;

      // Guarantee minimum normal separation
      const normComp = nvx * this.wallNx + nvz * this.wallNz;
      if (normComp < 6.2) {
        nvx += this.wallNx * (6.2 - normComp);
        nvz += this.wallNz * (6.2 - normComp);
      }

      this.vx = nvx;
      this.vz = nvz;
      this.vy = JUMP_VEL * 1.02;

      const kickedSide = this.wallSide;
      this.lastWallId = this.wallId;
      this.sameWallCooldown = 0.55;
      this.wallId = null;
      this.state = 'air';

      this.events.onWallKick?.(kickedSide);
      this.events.onFovPunch?.(4.5);
      return;
    }

    // Gentle wall-run gravity curve (nearly weightless for first 0.35s, then smooth arc)
    const gravScale = this.wallTimer < 0.35 ? 0.55 : 1.0;
    this.vy -= WALLRUN_GRAVITY * gravScale * dt;

    // Slight magnetic hold toward wall so player never drifts off mid-run
    const holdVx = this.vx - this.wallNx * 1.5;
    const holdVz = this.vz - this.wallNz * 1.5;

    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      holdVx,
      this.vy,
      holdVz,
      PLAYER_RADIUS,
      STAND_HEIGHT,
      false,
      null,
      dt,
      false
    );

    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    // Restore pure tangential velocity
    let tx = -this.wallNz;
    let tz = this.wallNx;
    if (tx * this.vx + tz * this.vz < 0) {
      tx = -tx;
      tz = -tz;
    }
    const tanSpd = res.vx * tx + res.vz * tz;
    this.vx = tx * tanSpd;
    this.vz = tz * tanSpd;
    this.vy = res.vy;

    // Rapid wall-run footsteps
    const stepRate = 3.8;
    this.stridePhase += dt * stepRate * Math.PI;
    const stepIdx = Math.floor(this.stridePhase / Math.PI);
    if (stepIdx !== this.lastStepIndex) {
      this.lastStepIndex = stepIdx;
      this.events.onFootstep?.(this.horizSpeed, true);
    }

    // Check wall-run exit conditions
    const stillOnWall =
      this.wallId !== null &&
      this.world.isStillBesideWall(
        this.x,
        this.y,
        this.z,
        this.wallId,
        this.wallNx,
        this.wallNz,
        PLAYER_RADIUS
      );

    // Letting player pull strongly away from wall also detaches cleanly
    const [rx, rz] = this.getHorizRight();
    const pullAway = input.right * (rx * this.wallNx + rz * this.wallNz);

    if (
      res.grounded ||
      !stillOnWall ||
      this.wallTimer >= WALLRUN_MAX_TIME ||
      tanSpd < 4.5 ||
      input.forward < -0.2 ||
      pullAway > 0.85
    ) {
      this.grounded = res.grounded;
      this.currentRamp = res.onRamp;
      this.lastWallId = this.wallId;
      this.sameWallCooldown = 0.48;
      this.wallId = null;

      if (!this.grounded) {
        // Give brief coyote-like hop off end of a wall-run panel + small forward carry!
        this.coyoteTimer = 0.12;
        this.vx += this.wallNx * 1.4;
        this.vz += this.wallNz * 1.4;
        this.vy = Math.max(this.vy, 1.8);
        this.state = 'air';
      } else {
        this.state = 'run';
      }
    }
  }

  private startGrapple(anchor: GrappleDef): void {
    if (this.state === 'slide') this.events.onSlideEnd?.();
    this.state = 'grapple';
    this.activeGrapple = anchor;
    this.lockedGrapple = null;
    this.grappleTimer = 0;
    this.crouched = false;
    this.grounded = false;
    this.currentRamp = null;
    this.wallId = null;
    this.lastWallId = null;

    const eyeY = this.y + STAND_EYE * 0.75;
    const dx = anchor.x - this.x;
    const dy = anchor.y - eyeY;
    const dz = anchor.z - this.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    this.grappleRopeLen = Math.max(5.0, dist * 0.96);

    // Crisp initial grapple tug forward + slightly up so swinging feels super responsive!
    const dirX = dx / dist;
    const dirY = dy / dist;
    const dirZ = dz / dist;
    const curSpd = this.horizSpeed;
    const minSwingSpd = Math.max(15.8, curSpd + 2.4);

    // Blend current direction with anchor direction horizontally
    const hDist = Math.hypot(dx, dz) || 1;
    const ahx = dx / hDist;
    const ahz = dz / hDist;
    this.vx = this.vx * 0.45 + ahx * minSwingSpd * 0.65;
    this.vz = this.vz * 0.45 + ahz * minSwingSpd * 0.65;
    const newHs = this.horizSpeed;
    if (newHs < minSwingSpd) {
      this.vx = (this.vx / (newHs || 1)) * minSwingSpd;
      this.vz = (this.vz / (newHs || 1)) * minSwingSpd;
    }
    this.vy = Math.max(this.vy * 0.35 + dirY * 6.5, 2.2);
    this.flowBuild = 1;

    this.events.onGrappleAttach?.(anchor);
    this.events.onFovPunch?.(5.5);
  }

  private stepGrapple(input: PlayerInputState, dt: number): void {
    const anchor = this.activeGrapple;
    if (!anchor) {
      this.state = 'air';
      return;
    }

    this.grappleTimer += dt;
    const attachY = this.y + 1.25;
    const toAx = anchor.x - this.x;
    const toAy = anchor.y - attachY;
    const toAz = anchor.z - this.z;
    const dist = Math.hypot(toAx, toAy, toAz) || 1;
    // Unit vector from anchor to player (radial outward)
    const rx = -toAx / dist;
    const ry = -toAy / dist;
    const rz = -toAz / dist;

    // Gravity during swing
    this.vy -= GRAVITY * 0.88 * dt;

    // Gentle reel-in + look-direction swing drive (Titanfall-style intuitive grapple!)
    this.grappleRopeLen = Math.max(4.8, this.grappleRopeLen - 3.6 * dt);
    const [fx, fz] = this.getHorizForward();
    this.vx += fx * 15.5 * dt;
    this.vz += fz * 15.5 * dt;

    // Also subtle upward reel if player is far below anchor
    if (toAy > 2.0) {
      this.vy += (-ry) * 9.5 * dt;
    }

    // Pendulum rope constraint: cancel outward velocity along rope so fall converts into forward arc!
    if (dist >= this.grappleRopeLen * 0.94) {
      const radialOutVel = this.vx * rx + this.vy * ry + this.vz * rz;
      if (radialOutVel > 0) {
        this.vx -= radialOutVel * rx;
        this.vy -= radialOutVel * ry;
        this.vz -= radialOutVel * rz;
      }
    }

    // Clamp swing speed cleanly so arcs feel weighty and controllable
    const tot = this.totalSpeed;
    if (tot > 22.5) {
      const s = 22.5 / tot;
      this.vx *= s;
      this.vy *= s;
      this.vz *= s;
    }

    const res = this.world.moveAndSlide(
      this.x,
      this.y,
      this.z,
      this.vx,
      this.vy,
      this.vz,
      PLAYER_RADIUS,
      STAND_HEIGHT,
      false,
      null,
      dt,
      false
    );

    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    this.vx = res.vx;
    this.vy = res.vy;
    this.vz = res.vz;

    // Check release conditions:
    // 1. Player jumped during swing -> big slingshot release!
    // 2. Player released RMB/E after brief min latch -> slingshot release!
    // 3. Player swung well past anchor upward apex -> clean auto-slingshot so you never swing backward!
    const hToA = toAx * fx + toAz * fz; // positive while anchor is still ahead, negative once past!
    const jumpedOut = input.jumpBufferTimer > 0 && this.grappleTimer > 0.08;
    const releasedOut = !input.grappleHeld && this.grappleTimer > 0.22;
    const passedApex =
      this.grappleTimer > 0.25 &&
      ((hToA < -5.8 && this.vy > 1.5) || dist < 4.2 || attachY > anchor.y + 1.2);
    const timedOut = this.grappleTimer > 1.9;

    if (jumpedOut || releasedOut || passedApex || timedOut || res.grounded) {
      if (jumpedOut) input.jumpBufferTimer = 0;
      const slingshot = !res.grounded && (jumpedOut || releasedOut || passedApex);
      if (slingshot) {
        // Reward clean release with exhilarating upward & forward slingshot!
        this.vy = Math.max(this.vy + (jumpedOut ? 4.2 : 2.6), jumpedOut ? 9.4 : 7.2);
        this.vy = Math.min(this.vy, 13.2);
        const hs = this.horizSpeed;
        const targetHs = Math.min(SLIDE_MAX_SPEED, Math.max(16.8, hs + 1.6));
        if (hs > 1.0) {
          this.vx = (this.vx / hs) * targetHs;
          this.vz = (this.vz / hs) * targetHs;
        }
        this.events.onFovPunch?.(4.5);
      }

      this.lastGrappleId = anchor.id;
      this.activeGrapple = null;
      this.grappleCooldown = 0.32;
      this.grounded = res.grounded;
      this.currentRamp = res.onRamp;
      this.state = res.grounded ? 'run' : 'air';
      this.events.onGrappleRelease?.(slingshot);
    }
  }
}
