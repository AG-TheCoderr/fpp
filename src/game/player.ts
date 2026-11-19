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
  onFootstep?: (speed: number, isWall: boolean, foot: -1 | 1) => void;
  onPivot?: (intensity: number) => void;
  onJump?: (boosted: boolean) => void;
  onLand?: (impact: number, intoSlide: boolean) => void;
  onSlideStart?: (speed: number, slopeSlam: boolean) => void;
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
export const SLIDE_EYE = 0.74;

const GRAVITY = 24.0;
const BASE_RUN_SPEED = 11.2;
const FLOW_RUN_SPEED = 12.8;   // Smoothly earned while maintaining runner flow
const CROUCH_SPEED = 5.4;

// Ground traction, friction & corner-carve tuning
const GROUND_ACCEL = 68.0;     // Punchy forward drive off the line
const LATERAL_TRACTION = 98.0; // Kills icy sideways slip on diagonal direction cuts
const COUNTER_ACCEL = 122.0;   // Crisp rubber-on-concrete bite on 180° reversals
const STOP_FRICTION = 8.8;     // Quake/Titanfall proportional deceleration
const STOP_CONTROL = 6.8;      // Guarantees snappy final stop with zero float
const OVER_SPEED_DRAG = 3.0;   // Gentle bleed above FLOW_RUN_SPEED so chained momentum lasts!

// Air physics tuning
const AIR_ACCEL = 28.0;
const AIR_STRAFE_CAP = 3.8;
const AIR_BRAKE_ACCEL = 30.0;
const JUMP_VEL = 9.5;
const COYOTE_TIME = 0.14;
const JUMP_LURCH_WINDOW = 0.18;

// Slide physics tuning (pure momentum + progressive friction + 2D slope gravity)
const SLIDE_MIN_ENTRY_SPEED = 6.0;
const SLIDE_EXIT_SPEED = 5.8;
const SLIDE_BOOST_ADD = 3.5;
const SLIDE_BOOST_FLOOR = 16.0;
const SLIDE_RECHARGE_RATE = 1.25; // Full charge in 0.80s — matches one slide-hop arc!
const SLIDE_MAX_SPEED = 25.8;

// Wall-run & speed ceiling
const WALLRUN_GRAVITY = 5.2;
const WALLRUN_MAX_TIME = 1.75;
const WALLRUN_MIN_SPEED = 14.2;
const MAX_HORIZ_SPEED = 27.8;

/** Rotate 2D vector (dx, dz) toward unit target (tx, tz) by at most maxAngle radians. */
function rotateToward2D(
  dx: number,
  dz: number,
  tx: number,
  tz: number,
  maxAngle: number
): [number, number] {
  const dot = Math.max(-1, Math.min(1, dx * tx + dz * tz));
  const angle = Math.acos(dot);
  if (angle < 1e-5) return [tx, tz];
  const cross = dx * tz - dz * tx; // sign of rotation in XZ
  const step = Math.min(angle, maxAngle) * (cross >= 0 ? 1 : -1);
  const c = Math.cos(step);
  const s = Math.sin(step);
  const nx = dx * c - dz * s;
  const nz = dx * s + dz * c;
  const invL = 1 / (Math.hypot(nx, nz) || 1);
  return [nx * invL, nz * invL];
}

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

  // Core movement timers & momentum state
  coyoteTimer = 0;
  landingGraceTimer = 0;
  justJumpedTimer = 0;
  airTime = 0;
  flowBuild = 0;         // 0..1 sustained runner's flow
  slideTimer = 0;
  slideCharge = 1.0;     // 0..1 progressive slide-boost capacitor (replaces rigid cooldown!)
  slideSteer = 0;        // -1..+1 smoothed slide carving direction
  slideBraking = false;  // true while heel-braking a slide with S
  groundSlopePitch = 0;  // signed slope angle along facing direction (rad)
  pivotCooldown = 0;
  launchCooldown = 0;
  grappleCooldown = 0;

  // Real physical G-force / inertia telemetry for the head-bone camera rig
  localAccelFwd = 0;
  localAccelRight = 0;
  localAccelUp = 0;
  exertion = 0;          // 0..1 drives subtle post-sprint runner breathing

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

  // Biomechanical gait phase: 1 full left+right cycle = 2*PI, each footfall = PI
  stridePhase = 0;
  stepFoot: -1 | 1 = -1;
  lastStepPulse = 0;     // 1 on footstrike, decays rapidly for crisp skull-bone impact
  private lastStepIndex = 0;

  // Course / run progress
  runStarted = false;
  runFinished = false;
  runTime = 0;
  peakSpeed = 0;
  checkpointIndex = 0;
  splits: number[] = [];
  respawnX = 0;
  respawnY = 0;
  respawnZ = 0;
  respawnYaw = 0;

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
    this.justJumpedTimer = 0;
    this.airTime = 0;
    this.flowBuild = 0;
    this.slideTimer = 0;
    this.slideCharge = 1.0;
    this.slideSteer = 0;
    this.slideBraking = false;
    this.groundSlopePitch = 0;
    this.pivotCooldown = 0;
    this.launchCooldown = 0;
    this.grappleCooldown = 0;
    this.localAccelFwd = 0;
    this.localAccelRight = 0;
    this.localAccelUp = 0;
    this.exertion = 0;
    this.lastStepPulse = 0;
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

    const preVx = this.vx;
    const preVy = this.vy;
    const preVz = this.vz;

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

    // Tick timers & progressive slide boost recharge (faster while driving footsteps on concrete/walls)
    if (this.state !== 'slide') {
      const rechargeMul = this.grounded || this.state === 'wallrun' ? 1.0 : 0.42;
      this.slideCharge = Math.min(
        1,
        this.slideCharge + SLIDE_RECHARGE_RATE * rechargeMul * dt
      );
      this.slideSteer += (0 - this.slideSteer) * Math.min(1, 14 * dt);
      this.slideBraking = false;
    }
    this.pivotCooldown = Math.max(0, this.pivotCooldown - dt);
    this.launchCooldown = Math.max(0, this.launchCooldown - dt);
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.sameWallCooldown = Math.max(0, this.sameWallCooldown - dt);
    this.landingGraceTimer = Math.max(0, this.landingGraceTimer - dt);
    this.justJumpedTimer = Math.max(0, this.justJumpedTimer - dt);
    this.lastStepPulse = Math.max(0, this.lastStepPulse - dt * 9.5);

    if (this.sameWallCooldown <= 0 && this.state !== 'wallrun') {
      this.lastWallId = null;
    }

    const [lookX, lookY, lookZ] = this.getLookDir();
    const eyeY = this.y + this.eyeHeight;

    // Update best grapple lock candidate for HUD reticle
    const lockCandidate =
      this.state !== 'grapple' && this.grappleCooldown <= 0
        ? this.world.findAimSwing(
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

    // Cap extreme horizontal speed cleanly
    const hs = this.horizSpeed;
    if (hs > MAX_HORIZ_SPEED) {
      const s = MAX_HORIZ_SPEED / hs;
      this.vx *= s;
      this.vz *= s;
    }
    if (this.runStarted && this.horizSpeed > this.peakSpeed) {
      this.peakSpeed = this.horizSpeed;
    }

    // Track current ground slope angle along player's facing direction
    let targetSlope = 0;
    if (this.grounded && this.currentRamp) {
      const [fx, fz] = this.getHorizForward();
      const upAlign = fx * this.currentRamp.upX + fz * this.currentRamp.upZ;
      targetSlope = Math.atan(this.currentRamp.slope) * upAlign;
    }
    this.groundSlopePitch += (targetSlope - this.groundSlopePitch) * Math.min(1, 14 * dt);

    // Compute smoothed player-local G-force acceleration for physical body/head inertia
    const invDt = 1 / Math.max(1e-4, dt);
    const rawAx = (this.vx - preVx) * invDt;
    const rawAy = (this.vy - preVy) * invDt;
    const rawAz = (this.vz - preVz) * invDt;
    const [fx, fz] = this.getHorizForward();
    const [rx, rz] = this.getHorizRight();
    const clampA = (v: number) => Math.max(-42, Math.min(42, v));
    const aFwd = clampA(rawAx * fx + rawAz * fz);
    const aRight = clampA(rawAx * rx + rawAz * rz);
    const aUp = clampA(rawAy);
    const aBlend = Math.min(1, 12 * dt);
    this.localAccelFwd += (aFwd - this.localAccelFwd) * aBlend;
    this.localAccelRight += (aRight - this.localAccelRight) * aBlend;
    this.localAccelUp += (aUp - this.localAccelUp) * aBlend;

    // Update athletic exertion (builds during high-speed runs, settles slowly when resting)
    if (hs > 8.0) {
      this.exertion = Math.min(1, this.exertion + dt * 0.22);
    } else {
      this.exertion = Math.max(0, this.exertion - dt * 0.14);
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
        this.airTime = 0;
        this.slideCharge = 1.0;
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

    if (this.grounded) {
      this.coyoteTimer = COYOTE_TIME;
      this.airTime = 0;
      this.lastWallId = null;
      this.lastGrappleId = null;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
      this.airTime += dt;
    }

    // Handle low-speed crouch vs standing up cleanly
    const onDownhill = this.isOnDownhillRamp();
    if (this.grounded) {
      const hsNow = this.horizSpeed;
      const wantsSlide =
        (input.slideBufferTimer > 0 && hsNow >= SLIDE_MIN_ENTRY_SPEED) ||
        (input.slideHeld && onDownhill && hsNow >= 2.2);

      if (!this.crouched && wantsSlide) {
        input.slideBufferTimer = 0;
        this.startSlide(wishX, wishZ, wishMag, 0);
        this.stepSlide(input, dt);
        return;
      }

      // Allow clean tactical crouch at low speed; release immediately when standing up or sprinting out
      if (input.slideHeld && hsNow < SLIDE_MIN_ENTRY_SPEED && !onDownhill) {
        this.crouched = true;
      } else if (this.crouched && (!input.slideHeld || input.forward > 0.3) && this.canStandUp()) {
        this.crouched = false;
      }
    } else if (this.crouched && this.canStandUp()) {
      this.crouched = false;
    }

    // =======================================================================
    // GROUND TRACTION, COUNTER-STRAFE, FRICTION & MOMENTUM CARVING
    // =======================================================================
    let jumpedThisStep = false;
    if (this.grounded) {
      const hs = this.horizSpeed;

      if (wishMag > 0.05) {
        const align = hs > 0.4 ? (this.vx * wishX + this.vz * wishZ) / hs : 1.0;

        // Build sustained runner's flow while moving forward smoothly
        if (input.forward > 0.25 && align > 0.4 && hs > 8.0 && !this.crouched) {
          this.flowBuild = Math.min(1, this.flowBuild + dt * 0.72);
        } else if (align < -0.2) {
          // Retain partial kinetic tension through a sharp reversal so re-acceleration pops
          this.flowBuild *= Math.max(0, 1 - dt * 3.2);
        }

        const targetSpeed = this.crouched
          ? CROUCH_SPEED
          : BASE_RUN_SPEED + (FLOW_RUN_SPEED - BASE_RUN_SPEED) * this.flowBuild;

        if (align < -0.15 && hs > 1.2) {
          // 1) SHARP DIRECTION REVERSAL: High-grip sneaker counter-plant!
          if (hs > 8.0 && align < -0.45 && this.pivotCooldown <= 0) {
            this.pivotCooldown = 0.3;
            this.events.onPivot?.(Math.min(1, hs / 16));
          }
          // Decompose velocity along & perpendicular to wish direction
          const along = this.vx * wishX + this.vz * wishZ; // negative
          const perpX = this.vx - wishX * along;
          const perpZ = this.vz - wishZ * along;
          const perpLen = Math.hypot(perpX, perpZ);

          const nextAlong = Math.min(targetSpeed, along + COUNTER_ACCEL * dt);
          const nextPerp = Math.max(0, perpLen - LATERAL_TRACTION * dt);
          const scaleP = perpLen > 1e-4 ? nextPerp / perpLen : 0;

          this.vx = wishX * nextAlong + perpX * scaleP;
          this.vz = wishZ * nextAlong + perpZ * scaleP;
        } else if (hs > targetSpeed + 0.15 && !this.crouched) {
          // 2) OVER-SPEED MOMENTUM CARRY & CORNER CARVING:
          // Smooth arcs (< ~42°) conserve nearly 100% speed; tight 60–100° cuts bleed realistic edge friction!
          const graceScale = this.landingGraceTimer > 0 ? 0.2 : 1.0;
          const cutFriction = Math.max(0, 0.74 - align) * 10.5;
          const totalDrag = OVER_SPEED_DRAG * graceScale + cutFriction;
          const keptSpeed = Math.max(targetSpeed, hs - totalDrag * dt);

          // Exact arc-preserving rotation (feels weighty at 24 m/s, razor-sharp at 13–17 m/s!)
          const speedRatio = Math.max(0, Math.min(1, (hs - 12.0) / 13.0));
          const carveRate = 12.8 - speedRatio * 4.4;
          const [ndx, ndz] = rotateToward2D(
            this.vx / hs,
            this.vz / hs,
            wishX,
            wishZ,
            carveRate * dt
          );
          this.vx = ndx * keptSpeed;
          this.vz = ndz * keptSpeed;
        } else {
          // 3) RESPONSIVE ACCELERATION + HIGH LATERAL SHOE TRACTION (zero icy diagonal drift!)
          const along = this.vx * wishX + this.vz * wishZ;
          const perpX = this.vx - wishX * along;
          const perpZ = this.vz - wishZ * along;
          const perpLen = Math.hypot(perpX, perpZ);

          // Kill unwanted sideways skid rapidly while driving cleanly toward targetSpeed
          const nextPerp = Math.max(0, perpLen - LATERAL_TRACTION * dt);
          const pScale = perpLen > 1e-4 ? nextPerp / perpLen : 0;

          // Snappier low-end launch off a standstill, smooth athletic climb to top stride
          const launchBoost = along < 5.5 ? 1.22 : 1.0;
          const accel = GROUND_ACCEL * launchBoost * dt;
          let nextAlong = along;
          if (along < targetSpeed) {
            nextAlong = Math.min(targetSpeed, along + accel);
          } else {
            nextAlong = Math.max(targetSpeed, along - STOP_FRICTION * 4.5 * dt);
          }

          this.vx = wishX * nextAlong + perpX * pScale;
          this.vz = wishZ * nextAlong + perpZ * pScale;
        }
      } else {
        // 4) PROPORTIONAL KINETIC GROUND FRICTION (crisp athletic stop, zero ice creep!)
        this.flowBuild = Math.max(0, this.flowBuild - dt * 2.4);
        if (hs < 0.35) {
          this.vx = 0;
          this.vz = 0;
        } else {
          const graceScale = this.landingGraceTimer > 0 ? 0.38 : 1.0;
          const control = Math.max(hs, STOP_CONTROL);
          const drop = control * STOP_FRICTION * graceScale * dt;
          const nextHs = Math.max(0, hs - drop);
          const scale = nextHs / hs;
          this.vx *= scale;
          this.vz *= scale;
        }
      }

      // Organic slope stride coupling (natural gravity pull running down ramps)
      if (this.currentRamp) {
        const upVel = this.vx * this.currentRamp.upX + this.vz * this.currentRamp.upZ;
        if (upVel < -2.0) {
          const downAccel = this.currentRamp.slope * 9.2 * dt;
          this.vx -= this.currentRamp.upX * downAccel;
          this.vz -= this.currentRamp.upZ * downAccel;
        }
      }
    } else {
      // =====================================================================
      // AIR CONTROL: TAP-STRAFE LURCH + SMOOTH AIR-CARVE + SOURCE AIR-STRAFE
      // =====================================================================
      const hs = this.horizSpeed;

      if (wishMag > 0.05) {
        const align = hs > 0.5 ? (this.vx * wishX + this.vz * wishZ) / hs : 1.0;

        // 1) Post-jump directional lurch (lets you redirect cleanly right off a jump/slide-hop!)
        if (this.justJumpedTimer > 0 && hs > 5.0 && align > -0.25 && align < 0.995) {
          const lurchStrength = (this.justJumpedTimer / JUMP_LURCH_WINDOW) * 6.4;
          const [ndx, ndz] = rotateToward2D(
            this.vx / hs,
            this.vz / hs,
            wishX,
            wishZ,
            lurchStrength * dt
          );
          this.vx = ndx * hs;
          this.vz = ndz * hs;
        } else if (align > 0.32 && align < 0.998 && hs > 6.5) {
          // 2) Smooth mid-air momentum carve (curve into wall-runs & corners without losing speed!)
          const [ndx, ndz] = rotateToward2D(
            this.vx / hs,
            this.vz / hs,
            wishX,
            wishZ,
            2.35 * dt
          );
          this.vx = ndx * hs;
          this.vz = ndz * hs;
        }

        // 3) Crisp air-braking when pulling against flight direction (stick pinpoint landings!)
        if (align < -0.3) {
          this.vx += wishX * AIR_BRAKE_ACCEL * dt;
          this.vz += wishZ * AIR_BRAKE_ACCEL * dt;
        } else {
          // 4) True Source/Titanfall air-strafe acceleration (smooth strafing builds speed!)
          const curProj = this.vx * wishX + this.vz * wishZ;
          const maxWish = hs > BASE_RUN_SPEED ? AIR_STRAFE_CAP : BASE_RUN_SPEED;
          const addSpeed = maxWish - curProj;
          if (addSpeed > 0) {
            const accelSpeed = Math.min(addSpeed, AIR_ACCEL * dt);
            this.vx += wishX * accelSpeed;
            this.vz += wishZ * accelSpeed;
          }
          // Gentle precision air-steer at low speeds
          if (hs < BASE_RUN_SPEED * 0.95) {
            const blend = Math.min(1, 2.6 * dt);
            this.vx += (wishX * BASE_RUN_SPEED - this.vx) * blend;
            this.vz += (wishZ * BASE_RUN_SPEED - this.vz) * blend;
          }
        }
      } else if (hs > 0.2) {
        // Whisper-light aerodynamic air drag only when completely hands-off
        const keep = Math.max(0, 1 - 0.18 * dt);
        this.vx *= keep;
        this.vz *= keep;
      }

      this.vy -= GRAVITY * dt;
      if (this.vy < -38) this.vy = -38;
    }

    // Jump (with coyote time + input buffer!)
    if (input.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      if (!this.crouched || this.canStandUp()) {
        this.crouched = false;
        input.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.justJumpedTimer = JUMP_LURCH_WINDOW;

        let jumpVy = JUMP_VEL;
        let boosted = false;
        if (this.currentRamp) {
          const upSpd = this.vx * this.currentRamp.upX + this.vz * this.currentRamp.upZ;
          if (upSpd > 4.0) {
            jumpVy += Math.min(4.2, upSpd * this.currentRamp.slope * 0.65);
            if (this.currentRamp.style === 'rampRed') {
              this.vx += this.currentRamp.upX * 2.0;
              this.vz += this.currentRamp.upZ * 2.0;
              boosted = true;
              this.events.onFovPunch?.(4.2);
            }
          }
        }

        // Subtle forward jump impulse if jumping into wish direction at sprint
        if (wishMag > 0.5 && this.horizSpeed >= BASE_RUN_SPEED * 0.9 && this.horizSpeed < 13.5) {
          this.vx += wishX * 0.55;
          this.vz += wishZ * 0.55;
        }

        this.vy = jumpVy;
        this.grounded = false;
        this.currentRamp = null;
        jumpedThisStep = true;
        this.events.onJump?.(boosted || this.horizSpeed > 14.0);
      }
    }

    // Swept collision move
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
      this.justJumpedTimer = JUMP_LURCH_WINDOW * 0.7;
      this.events.onJump?.(true);
      this.events.onFovPunch?.(4.5);
    }

    // Handle touchdown + landing-slide + downhill slope-slam!
    if (!wasGrounded && this.grounded) {
      this.landingGraceTimer = 0.15;
      this.lastLandImpact = res.landedImpact;

      const wantsLandSlide =
        (input.slideHeld || input.slideBufferTimer > 0) &&
        (this.horizSpeed > 5.2 || this.isOnDownhillRamp());

      if (wantsLandSlide) {
        input.slideBufferTimer = 0;
        this.events.onLand?.(res.landedImpact, true);
        this.startSlide(wishX, wishZ, wishMag, res.landedImpact);
        return;
      }

      // Very heavy flat drops without sliding momentarily soak a touch of stride (rewards slide-landing!)
      if (res.landedImpact > 17.5 && this.horizSpeed > 8.0) {
        this.vx *= 0.88;
        this.vz *= 0.88;
      }

      if (res.landedImpact > 2.0) {
        this.events.onLand?.(res.landedImpact, false);
      }
    }

    // Check auto-vault & auto-mantle when moving forward
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

    // Check wall-run initiation when airborne
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

    // Update gait cycle & exact left/right footstrike events
    if (this.grounded) {
      const hs = this.horizSpeed;
      if (hs > 0.65) {
        this.state = 'run';
        const cadence = this.crouched ? 1.5 + hs * 0.14 : 1.85 + Math.min(hs, 22) * 0.112;
        this.stridePhase += dt * cadence * Math.PI;
        const stepIdx = Math.floor(this.stridePhase / Math.PI);
        if (stepIdx !== this.lastStepIndex) {
          this.lastStepIndex = stepIdx;
          this.stepFoot = stepIdx % 2 === 0 ? -1 : 1;
          this.lastStepPulse = 1.0;
          this.events.onFootstep?.(hs, false, this.stepFoot);
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
    return downDot > 0.4 && this.currentRamp.slope > 0.09;
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

  private startSlide(
    wishX: number,
    wishZ: number,
    wishMag: number,
    landImpact: number
  ): void {
    this.state = 'slide';
    this.crouched = true;
    this.slideTimer = 0;
    this.slideBraking = false;

    const hs = this.horizSpeed;
    const [fx, fz] = this.getHorizForward();

    // Blend current velocity with wish direction so you can whip-slide crisply into an angle!
    let dirX = hs > 1.5 ? this.vx / hs : fx;
    let dirZ = hs > 1.5 ? this.vz / hs : fz;
    if (wishMag > 0.25) {
      const dot = dirX * wishX + dirZ * wishZ;
      if (dot > -0.1) {
        [dirX, dirZ] = rotateToward2D(dirX, dirZ, wishX, wishZ, 0.46);
      }
    }

    // Progressive charge-scaled impulse (rewards rhythmic slide-hops, never rewards spam!)
    const charge = this.slideCharge;
    let newSpeed = hs;
    if (charge >= 0.22) {
      const boostFloor = 11.8 + (SLIDE_BOOST_FLOOR - 11.8) * charge;
      const boostAdd = SLIDE_BOOST_ADD * charge;
      newSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(boostFloor, hs + boostAdd));
      this.slideCharge = 0;
      this.events.onFovPunch?.(2.2 + 2.2 * charge);
    }

    // Downhill Slope-Slam & Impact Breakfall energy conversion!
    let slopeSlam = false;
    if (landImpact > 2.5) {
      if (this.currentRamp) {
        const downX = -this.currentRamp.upX;
        const downZ = -this.currentRamp.upZ;
        const downAlign = dirX * downX + dirZ * downZ;
        if (downAlign > 0.25) {
          // Convert vertical fall momentum straight into blistering downhill slide speed!
          const slamBonus = Math.min(
            6.8,
            landImpact * this.currentRamp.slope * 1.35 * downAlign
          );
          newSpeed = Math.min(SLIDE_MAX_SPEED, newSpeed + slamBonus);
          [dirX, dirZ] = rotateToward2D(dirX, dirZ, downX, downZ, 0.35);
          if (slamBonus > 1.8) {
            slopeSlam = true;
            this.events.onFovPunch?.(Math.min(5.0, slamBonus * 0.9));
          }
        }
      } else {
        // Parkour breakfall roll-slide cushions heavy flat landing into forward glide
        const rollBonus = Math.min(2.2, Math.max(0, (landImpact - 5.0) * 0.2));
        newSpeed = Math.min(SLIDE_MAX_SPEED, newSpeed + rollBonus);
      }
    }

    this.vx = dirX * newSpeed;
    this.vz = dirZ * newSpeed;
    this.flowBuild = 1;
    this.events.onSlideStart?.(newSpeed, slopeSlam);
  }

  private stepSlide(input: PlayerInputState, dt: number): void {
    this.slideTimer += dt;
    this.slideBraking = input.forward < -0.25;

    // Smoothly track A/D carve input for body/camera banking
    this.slideSteer += (input.right - this.slideSteer) * Math.min(1, 11 * dt);

    // 1. Carve steering: responsive A/D hip-carve + subtle look-direction follow
    let hs = this.horizSpeed;
    if (hs > 0.8) {
      let dx = this.vx / hs;
      let dz = this.vz / hs;

      if (Math.abs(input.right) > 0.04) {
        // Faster slides have wider, weightier carve arcs; mid-speed slides carve tightly
        const steerRate = Math.max(1.35, Math.min(2.25, 2.4 - hs * 0.035));
        const angle = -input.right * steerRate * dt;
        // Rotate horizontal vector right when input.right > 0: right = (-dz, dx)
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const ndx = dx * c + dz * s;
        const ndz = -dx * s + dz * c;
        dx = ndx;
        dz = ndz;
      }

      // Gentle camera-look alignment when holding W so steering down chutes feels intuitive
      if (input.forward > 0.2) {
        const [fx, fz] = this.getHorizForward();
        const fDot = dx * fx + dz * fz;
        if (fDot > 0.45) {
          [dx, dz] = rotateToward2D(dx, dz, fx, fz, 0.95 * dt);
        }
      }

      this.vx = dx * hs;
      this.vz = dz * hs;
    }

    // 2. True 2D slope gravity projection (curves diagonally & rockets straight downhill!)
    let downhillFactor = 0;
    if (this.currentRamp) {
      const r = this.currentRamp;
      const sinTheta = r.slope / Math.hypot(1, r.slope);
      const gravMag = GRAVITY * sinTheta * 0.92;
      const downX = -r.upX;
      const downZ = -r.upZ;

      this.vx += downX * gravMag * dt;
      this.vz += downZ * gravMag * dt;

      hs = this.horizSpeed;
      if (hs > 0.5) {
        downhillFactor = Math.max(0, (this.vx * downX + this.vz * downZ) / hs);
      }
      if (hs > SLIDE_MAX_SPEED) {
        this.vx = (this.vx / hs) * SLIDE_MAX_SPEED;
        this.vz = (this.vz / hs) * SLIDE_MAX_SPEED;
        hs = SLIDE_MAX_SPEED;
      }
    }

    // 3. Progressive 3-phase kinetic friction + carve edge drag + S heel-brake!
    hs = this.horizSpeed;
    if (hs > 0.01) {
      let fric: number;
      if (this.slideTimer < 0.18) {
        // Slick entry wax phase — burst pops immediately!
        fric = 1.5;
      } else if (hs > 10.5) {
        // Smooth kinetic + aerodynamic glide at high velocity
        fric = 4.0 + (hs - 10.5) * 0.16;
      } else {
        // Progressive shoe-sole bite as slide winds down
        fric = 4.0 + (10.5 - hs) * 0.72;
      }

      // Carving digs the shoe edge in slightly
      fric += Math.abs(input.right) * 1.4;

      // Downhill concrete chutes stay silky fast
      if (downhillFactor > 0.35 && !this.slideBraking) {
        fric *= 1 - downhillFactor * 0.62;
      }

      // Active heel-brake when pulling S
      if (this.slideBraking) {
        fric += 16.5;
      }

      const nextS = Math.max(0, hs - fric * dt);
      this.vx = (this.vx / hs) * nextS;
      this.vz = (this.vz / hs) * nextS;
    }

    // 4. Slide-Hop! Carries full momentum + sweet-spot toe-pop + clean directional lurch!
    let slideJumped = false;
    if (input.jumpBufferTimer > 0 && this.canStandUp()) {
      input.jumpBufferTimer = 0;
      this.vy = JUMP_VEL * 0.98;
      this.justJumpedTimer = JUMP_LURCH_WINDOW;

      const curS = this.horizSpeed;
      if (curS > 2.0) {
        let jdx = this.vx / curS;
        let jdz = this.vz / curS;
        const [wx, wz, wm] = this.getWishDir(input);
        if (wm > 0.25 && jdx * wx + jdz * wz > 0.1) {
          [jdx, jdz] = rotateToward2D(jdx, jdz, wx, wz, 0.34);
        }
        // Sweet-spot slide-hop pop in first 0.6s of slide
        const sweetBonus = this.slideTimer <= 0.6 && curS > 9.0 ? 1.05 : 0.45;
        const boosted = Math.min(SLIDE_MAX_SPEED, curS + sweetBonus);
        this.vx = jdx * boosted;
        this.vz = jdz * boosted;
      }

      this.grounded = false;
      this.crouched = false;
      this.currentRamp = null;
      this.coyoteTimer = 0;
      this.airTime = 0;
      this.state = 'air';
      slideJumped = true;
      this.events.onSlideEnd?.();
      this.events.onJump?.(true);
      this.events.onFovPunch?.(3.0);
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

    // Never trap player beneath a low slide gate even if they braked mid-tunnel
    if (!canStand && this.horizSpeed < 8.6) {
      const [fx, fz] = this.getHorizForward();
      const curS = this.horizSpeed;
      const dx = curS > 0.5 ? this.vx / curS : fx;
      const dz = curS > 0.5 ? this.vz / curS : fz;
      this.vx = dx * 8.6;
      this.vz = dz * 8.6;
    }

    // 5. Pure momentum-based slide exit + crisp slide-cancel (no arbitrary timer cutoff!)
    const slideCanceled = !input.slideHeld && this.slideTimer >= 0.17;
    const momentumSpent =
      downhillFactor < 0.3 && this.slideTimer >= 0.25 && this.horizSpeed < SLIDE_EXIT_SPEED;

    if (!this.grounded) {
      // Slid right off a rooftop ledge — extra forgiving coyote window for ledge slide-hops!
      this.coyoteTimer = COYOTE_TIME + 0.05;
      this.airTime = 0;
      this.crouched = !canStand;
      this.state = 'air';
      this.events.onSlideEnd?.();
    } else if ((slideCanceled || momentumSpent) && canStand) {
      // If player spent their slide while still holding crouch & NOT pushing W, settle into crouch
      const stayCrouched = momentumSpent && input.slideHeld && input.forward <= 0.2;
      this.crouched = stayCrouched;
      this.landingGraceTimer = 0.14; // Carry 100% of remaining slide speed into sprint!
      this.state = this.horizSpeed > 0.65 ? 'run' : 'idle';
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

    const baseBoost = spring ? 16.6 : 15.2;
    const addBoost = spring ? 3.3 : 2.3;
    this.vaultSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(baseBoost, this.horizSpeed + addBoost));
    this.vx = dirX * this.vaultSpeed;
    this.vz = dirZ * this.vaultSpeed;
    this.vy = 0;
    this.grounded = false;
    this.currentRamp = null;
    this.flowBuild = 1;
    this.slideCharge = Math.min(1, this.slideCharge + 0.5);

    this.events.onVault?.(spring);
    this.events.onFovPunch?.(spring ? 5.2 : 3.6);
  }

  private stepVault(input: PlayerInputState, dt: number): void {
    this.actionTimer += dt;
    const t = Math.min(1, this.actionTimer / this.actionDuration);

    if (!this.vaultSpringUsed && input.jumpBufferTimer > 0) {
      input.jumpBufferTimer = 0;
      this.vaultSpringUsed = true;
      this.vaultSpeed = Math.min(SLIDE_MAX_SPEED, this.vaultSpeed + 1.5);
      this.events.onFovPunch?.(2.5);
    }

    const ease = 1 - (1 - t) * (1 - t);
    const arcLift = Math.sin(t * Math.PI) * 0.22;
    this.y = this.actionStartY + (this.actionTargetY - this.actionStartY) * ease + arcLift;

    this.vx = this.vaultDirX * this.vaultSpeed;
    this.vz = this.vaultDirZ * this.vaultSpeed;

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
      // Dash/Kong vault shoots low and fast across the slab so you land in-stride before the next jump!
      this.vy = this.vaultSpringUsed ? 4.4 : 2.2;
      this.vx = this.vaultDirX * this.vaultSpeed;
      this.vz = this.vaultDirZ * this.vaultSpeed;
      this.grounded = false;
      this.airTime = 0;
      this.justJumpedTimer = JUMP_LURCH_WINDOW * 0.6;
      this.lastWallId = null;
      this.lastGrappleId = null;
      this.state = 'air';
    }
  }

  private startMantle(targetX: number, topY: number, targetZ: number): void {
    this.state = 'mantle';
    this.actionTimer = 0;
    this.actionDuration = 0.26;
    this.actionStartX = this.x;
    this.actionStartY = this.y;
    this.actionStartZ = this.z;
    this.actionTargetX = targetX;
    this.actionTargetY = topY + 0.02;
    this.actionTargetZ = targetZ;
    this.vaultSpeed = Math.max(9.8, this.horizSpeed * 0.8);
    this.vy = 0;
    this.grounded = false;
    this.currentRamp = null;
    this.events.onMantle?.();
  }

  private stepMantle(input: PlayerInputState, dt: number): void {
    this.actionTimer += dt;
    const t = Math.min(1, this.actionTimer / this.actionDuration);

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
      this.airTime = 0;
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
    this.airTime = 0;
    this.slideCharge = 1.0;
    this.lastGrappleId = null;

    const [fx, fz] = this.getHorizForward();
    let tx = -nz;
    let tz = nx;
    if (tx * fx + tz * fz < 0) {
      tx = -tx;
      tz = -tz;
    }

    const boostMin = isRunnerWall ? WALLRUN_MIN_SPEED + 0.8 : WALLRUN_MIN_SPEED;
    const newSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(boostMin, this.horizSpeed + 1.8));
    this.vx = tx * newSpeed;
    this.vz = tz * newSpeed;
    this.vy = Math.max(2.6, Math.min(4.8, this.vy * 0.45 + 2.8));
    this.flowBuild = 1;

    this.events.onWallRunStart?.(side);
    this.events.onFovPunch?.(3.2);
  }

  private stepWallRun(input: PlayerInputState, dt: number): void {
    this.wallTimer += dt;

    if (input.jumpBufferTimer > 0) {
      input.jumpBufferTimer = 0;
      const [fx, fz] = this.getHorizForward();
      const curSpd = this.horizSpeed;

      let tx = -this.wallNz;
      let tz = this.wallNx;
      if (tx * this.vx + tz * this.vz < 0) {
        tx = -tx;
        tz = -tz;
      }

      const forwardSpeed = Math.min(SLIDE_MAX_SPEED, Math.max(15.4, curSpd + 1.6));
      const kickAway = 7.4;
      let nvx = tx * forwardSpeed * 0.72 + fx * forwardSpeed * 0.34 + this.wallNx * kickAway;
      let nvz = tz * forwardSpeed * 0.72 + fz * forwardSpeed * 0.34 + this.wallNz * kickAway;

      const nl = Math.hypot(nvx, nvz) || 1;
      const targetKickHoriz = Math.min(SLIDE_MAX_SPEED, Math.max(16.2, curSpd + 1.9));
      nvx = (nvx / nl) * targetKickHoriz;
      nvz = (nvz / nl) * targetKickHoriz;

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
      this.justJumpedTimer = JUMP_LURCH_WINDOW * 0.75;
      this.state = 'air';

      this.events.onWallKick?.(kickedSide);
      this.events.onFovPunch?.(4.5);
      return;
    }

    const gravScale = this.wallTimer < 0.35 ? 0.55 : 1.0;
    this.vy -= WALLRUN_GRAVITY * gravScale * dt;

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

    // Rapid light wall-run steps driving head-bone rhythm
    const stepRate = 3.85;
    this.stridePhase += dt * stepRate * Math.PI;
    const stepIdx = Math.floor(this.stridePhase / Math.PI);
    if (stepIdx !== this.lastStepIndex) {
      this.lastStepIndex = stepIdx;
      this.stepFoot = stepIdx % 2 === 0 ? -1 : 1;
      this.lastStepPulse = 0.72;
      this.events.onFootstep?.(this.horizSpeed, true, this.stepFoot);
    }

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
        this.coyoteTimer = 0.12;
        this.vx += this.wallNx * 1.4;
        this.vz += this.wallNz * 1.4;
        this.vy = Math.max(this.vy, 1.8);
        this.state = 'air';
      } else {
        this.landingGraceTimer = 0.15;
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
    this.slideCharge = 1.0;

    const hitchY = this.y + 1.25;
    const dist =
      Math.hypot(anchor.x - this.x, anchor.y - hitchY, anchor.z - this.z) || 1;
    // True rope: length is the line you threw, not a scripted launch
    this.grappleRopeLen = Math.max(6.5, Math.min(46, dist));
    this.flowBuild = 1;

    this.events.onGrappleAttach?.(anchor);
    this.events.onFovPunch?.(3.4);
  }

  private constrainRope(ax: number, ay: number, az: number): void {
    const hitchY = this.y + 1.25;
    const dx = this.x - ax;
    const dy = hitchY - ay;
    const dz = this.z - az;
    const dist = Math.hypot(dx, dy, dz) || 1e-4;
    if (dist <= this.grappleRopeLen) return;

    const inv = 1 / dist;
    const nx = dx * inv;
    const ny = dy * inv;
    const nz = dz * inv;
    const s = this.grappleRopeLen * inv;
    this.x = ax + dx * s;
    this.y = ay + dy * s - 1.25;
    this.z = az + dz * s;

    // Kill stretch; keep (and thus convert) tangential speed — real pendulum
    const rad = this.vx * nx + this.vy * ny + this.vz * nz;
    if (rad > 0) {
      this.vx -= rad * nx;
      this.vy -= rad * ny;
      this.vz -= rad * nz;
    }
  }

  private stepGrapple(input: PlayerInputState, dt: number): void {
    const anchor = this.activeGrapple;
    if (!anchor) {
      this.state = 'air';
      return;
    }

    this.grappleTimer += dt;
    this.vy -= GRAVITY * dt;

    const [fx, fz] = this.getHorizForward();
    const [srx, srz] = this.getHorizRight();
    // Pump the arc: A/D is strong, W reels in, S pays rope out
    this.vx += (fx * 5.5 + srx * input.right * 16.0) * dt;
    this.vz += (fz * 5.5 + srz * input.right * 16.0) * dt;
    if (input.forward > 0.25) {
      this.grappleRopeLen = Math.max(6.0, this.grappleRopeLen - 11.0 * dt);
    } else if (input.forward < -0.25) {
      this.grappleRopeLen = Math.min(48, this.grappleRopeLen + 10.0 * dt);
    }

    this.constrainRope(anchor.x, anchor.y, anchor.z);

    const tot = this.totalSpeed;
    if (tot > 29.0) {
      const s = 29.0 / tot;
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
    this.constrainRope(anchor.x, anchor.y, anchor.z);

    const jumpedOut = input.jumpBufferTimer > 0 && this.grappleTimer > 0.07;
    const releasedOut = !input.grappleHeld && this.grappleTimer > 0.14;

    if (jumpedOut || releasedOut || res.grounded) {
      if (jumpedOut) input.jumpBufferTimer = 0;
      const slingshot = !res.grounded && (jumpedOut || releasedOut);
      if (slingshot) {
        const hs = this.horizSpeed;
        if (jumpedOut) {
          this.vy = Math.min(12.2, this.vy + 3.6);
          this.vx += fx * 2.4;
          this.vz += fz * 2.4;
        } else if (this.vy > 1.2) {
          // Let go on the way up — keep the arc, don't flatten into a scripted launch
          this.vy = Math.min(11.0, this.vy + 1.1);
        }
        if (hs < 11.0 && hs > 0.2) {
          const boost = 11.0 / hs;
          this.vx *= boost;
          this.vz *= boost;
        } else if (hs > 26.0) {
          const cap = 26.0 / hs;
          this.vx *= cap;
          this.vz *= cap;
        }
        this.justJumpedTimer = JUMP_LURCH_WINDOW;
        this.events.onFovPunch?.(jumpedOut ? 4.2 : 2.6);
      }

      this.lastGrappleId = anchor.id;
      this.activeGrapple = null;
      this.grappleCooldown = 0.1;
      this.grounded = res.grounded;
      this.currentRamp = res.onRamp;
      this.landingGraceTimer = res.grounded ? 0.15 : 0;
      this.state = res.grounded ? 'run' : 'air';
      this.events.onGrappleRelease?.(slingshot);
    }
  }
}
