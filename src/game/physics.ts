import {
  BoxDef,
  CheckpointDef,
  CourseDef,
  FinishDef,
  GrappleDef,
  LaunchPadDef,
  RampDef,
} from '../types';

export interface SolidBox {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  vaultable: boolean;
  wallRun: boolean;
  style: BoxDef['style'];
}

export interface SolidRamp {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  w: number;
  h: number;
  d: number;
  dir: RampDef['dir'];
  style: RampDef['style'];
  /** Unit surface normal (nx, ny, nz) */
  nx: number;
  ny: number;
  nz: number;
  /** Unit uphill direction in XZ */
  upX: number;
  upZ: number;
  /** Slope ratio h / horizontal_run */
  slope: number;
}

export interface WallCandidate {
  wallId: string;
  nx: number;
  nz: number;
  /** +1 if wall is on player's right, -1 if wall is on player's left */
  side: -1 | 1;
  dist: number;
  isRunnerWall: boolean;
  minY: number;
  maxY: number;
}

export interface LedgeHit {
  kind: 'vault' | 'mantle';
  topY: number;
  targetX: number;
  targetZ: number;
  boxId: string;
}

export interface StepResult {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  onRamp: SolidRamp | null;
  leftRedRamp: SolidRamp | null;
  landedImpact: number;
  hitCeiling: boolean;
}

const STEP_HEIGHT = 0.48;

interface SwingVolume {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export class PhysicsWorld {
  readonly boxes: SolidBox[] = [];
  readonly ramps: SolidRamp[] = [];
  readonly launchPads: LaunchPadDef[] = [];
  readonly grapples: GrappleDef[] = [];
  readonly checkpoints: CheckpointDef[] = [];
  readonly finish: FinishDef;
  readonly killY: number;
  private swingVolumes: SwingVolume[] = [];

  constructor(course: CourseDef) {
    this.killY = course.killY;
    this.finish = course.finish;
    this.launchPads = course.launchPads;
    this.grapples = course.grapples;
    this.checkpoints = course.checkpoints;

    course.boxes.forEach((b, idx) => {
      if (
        b.style !== 'vault' &&
        b.style !== 'slide' &&
        b.style !== 'wallrun'
      ) {
        this.swingVolumes.push({
          minX: b.x - b.w * 0.5,
          maxX: b.x + b.w * 0.5,
          minY: b.y,
          maxY: b.y + b.h,
          minZ: b.z - b.d * 0.5,
          maxZ: b.z + b.d * 0.5,
        });
      }
      if (b.noCollide) return;
      // For 'rooftop', collision extends well down so player collides cleanly with building upper walls too
      const extraDown = b.style === 'rooftop' ? 40 : 0;
      this.boxes.push({
        id: b.id ?? `box_${idx}`,
        minX: b.x - b.w * 0.5,
        maxX: b.x + b.w * 0.5,
        minY: b.y - extraDown,
        maxY: b.y + b.h,
        minZ: b.z - b.d * 0.5,
        maxZ: b.z + b.d * 0.5,
        vaultable: Boolean(b.vaultable || b.style === 'vault'),
        wallRun: Boolean(b.wallRun || b.style === 'wallrun'),
        style: b.style,
      });
    });

    course.ramps.forEach((r, idx) => {
      const run = r.dir === '+x' || r.dir === '-x' ? r.w : r.d;
      const hyp = Math.hypot(run, r.h);
      let upX = 0;
      let upZ = 0;
      if (r.dir === '+x') upX = 1;
      else if (r.dir === '-x') upX = -1;
      else if (r.dir === '+z') upZ = 1;
      else upZ = -1;

      // Surface normal points upward and toward the low end (-upDir)
      const ny = run / hyp;
      const nHoriz = r.h / hyp;
      const nx = -upX * nHoriz;
      const nz = -upZ * nHoriz;

      this.ramps.push({
        id: r.id ?? `ramp_${idx}`,
        minX: r.x - r.w * 0.5,
        maxX: r.x + r.w * 0.5,
        minY: r.y,
        maxY: r.y + r.h,
        minZ: r.z - r.d * 0.5,
        maxZ: r.z + r.d * 0.5,
        w: r.w,
        h: r.h,
        d: r.d,
        dir: r.dir,
        style: r.style,
        nx,
        ny,
        nz,
        upX,
        upZ,
        slope: r.h / Math.max(0.01, run),
      });
    });
  }

  rampSurfaceY(r: SolidRamp, x: number, z: number): number {
    let t = 0;
    if (r.dir === '+x') t = (x - r.minX) / r.w;
    else if (r.dir === '-x') t = (r.maxX - x) / r.w;
    else if (r.dir === '+z') t = (z - r.minZ) / r.d;
    else t = (r.maxZ - z) / r.d;
    t = Math.max(0, Math.min(1, t));
    return r.minY + t * r.h;
  }

  rampProgress(r: SolidRamp, x: number, z: number): number {
    if (r.dir === '+x') return (x - r.minX) / r.w;
    if (r.dir === '-x') return (r.maxX - x) / r.w;
    if (r.dir === '+z') return (z - r.minZ) / r.d;
    return (r.maxZ - z) / r.d;
  }

  /**
   * Sweep player cylinder (x, y=feet, z) with radius & height by velocity * dt.
   */
  moveAndSlide(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    radius: number,
    height: number,
    wasGrounded: boolean,
    prevRamp: SolidRamp | null,
    dt: number,
    allowGroundSnap = true
  ): StepResult {
    const totalDisp = Math.hypot(vx, vy, vz) * dt;
    const steps = Math.max(1, Math.min(8, Math.ceil(totalDisp / 0.15)));
    const subDt = dt / steps;

    let px = x;
    let py = y;
    let pz = z;
    let cvx = vx;
    let cvy = vy;
    let cvz = vz;
    let grounded = false;
    let activeRamp: SolidRamp | null = null;
    let rollingGrounded = wasGrounded;
    let rollingRamp = prevRamp;
    let leftRedRamp: SolidRamp | null = null;
    let landedImpact = 0;
    let hitCeiling = false;

    for (let s = 0; s < steps; s++) {
      const prevY = py;
      const preFallVy = cvy;

      // 1. Horizontal movement
      px += cvx * subDt;
      pz += cvz * subDt;

      // Resolve boxes horizontally (with auto step-up for low lips)
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (py + 0.03 >= b.maxY || py + height - 0.03 <= b.minY) continue;

        const cx = Math.max(b.minX, Math.min(px, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        const dx = px - cx;
        const dz = pz - cz;
        const distSq = dx * dx + dz * dz;
        if (distSq >= radius * radius) continue;

        // Try step-up if near top edge and moving horizontally
        const stepDelta = b.maxY - py;
        if (
          stepDelta > 0 &&
          stepDelta <= STEP_HEIGHT &&
          (rollingGrounded || cvy <= 2.2) &&
          this.hasHeadroom(px, b.maxY + 0.01, pz, radius * 0.9, height - 0.02)
        ) {
          py = b.maxY;
          if (cvy < 0) cvy = 0;
          grounded = true;
          rollingGrounded = true;
          continue;
        }

        // Push circle out of box along minimum penetration axis
        let nx = 0;
        let nz = 0;
        let pen = 0;
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          nx = dx / dist;
          nz = dz / dist;
          pen = radius - dist;
        } else {
          // Center is inside box XZ — push to nearest face
          const toMinX = px - b.minX;
          const toMaxX = b.maxX - px;
          const toMinZ = pz - b.minZ;
          const toMaxZ = b.maxZ - pz;
          const minEdge = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (minEdge === toMinX) {
            nx = -1;
            pen = toMinX + radius;
          } else if (minEdge === toMaxX) {
            nx = 1;
            pen = toMaxX + radius;
          } else if (minEdge === toMinZ) {
            nz = -1;
            pen = toMinZ + radius;
          } else {
            nz = 1;
            pen = toMaxZ + radius;
          }
        }

        px += nx * pen;
        pz += nz * pen;

        // Cancel velocity into the wall (slide cleanly along tangent)
        const vn = cvx * nx + cvz * nz;
        if (vn < 0) {
          cvx -= vn * nx;
          cvz -= vn * nz;
        }
      }

      // Resolve ramp side/back vertical faces if player is well below the slope surface
      for (let i = 0; i < this.ramps.length; i++) {
        const r = this.ramps[i];
        if (py + height <= r.minY + 0.03 || py >= r.maxY) continue;
        const cx = Math.max(r.minX, Math.min(px, r.maxX));
        const cz = Math.max(r.minZ, Math.min(pz, r.maxZ));
        const dx = px - cx;
        const dz = pz - cz;
        const distSq = dx * dx + dz * dz;
        if (distSq >= radius * radius) continue;

        const surfY = this.rampSurfaceY(r, cx, cz);
        // Only treat as solid wall if player feet are significantly below the slope surface
        if (py < surfY - STEP_HEIGHT - 0.12) {
          const toMinX = px - r.minX;
          const toMaxX = r.maxX - px;
          const toMinZ = pz - r.minZ;
          const toMaxZ = r.maxZ - pz;
          const minEdge = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          let nx = 0;
          let nz = 0;
          let pen = 0;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            nx = dx / dist;
            nz = dz / dist;
            pen = radius - dist;
          } else if (minEdge === toMinX) {
            nx = -1;
            pen = toMinX + radius;
          } else if (minEdge === toMaxX) {
            nx = 1;
            pen = toMaxX + radius;
          } else if (minEdge === toMinZ) {
            nz = -1;
            pen = toMinZ + radius;
          } else {
            nz = 1;
            pen = toMaxZ + radius;
          }
          px += nx * pen;
          pz += nz * pen;
          const vn = cvx * nx + cvz * nz;
          if (vn < 0) {
            cvx -= vn * nx;
            cvz -= vn * nz;
          }
        }
      }

      // 2. Vertical movement
      py += cvy * subDt;
      let stepGrounded = false;
      let stepRamp: SolidRamp | null = null;
      const footR = radius * 0.94;

      // Resolve boxes vertically
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        const cx = Math.max(b.minX, Math.min(px, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        const dx = px - cx;
        const dz = pz - cz;
        if (dx * dx + dz * dz >= footR * footR) continue;

        // Landing on top
        if (cvy <= 0 && prevY >= b.maxY - 0.14 && py <= b.maxY + 0.005) {
          if (!wasGrounded && !rollingGrounded && -preFallVy > landedImpact) {
            landedImpact = -preFallVy;
          }
          py = b.maxY;
          cvy = 0;
          stepGrounded = true;
        } else if (
          allowGroundSnap &&
          rollingGrounded &&
          cvy <= 0.2 &&
          prevY >= b.maxY - 0.05 &&
          py > b.maxY &&
          py - b.maxY <= 0.08
        ) {
          py = b.maxY;
          cvy = 0;
          stepGrounded = true;
        }

        // Hitting ceiling
        if (cvy > 0 && prevY + height <= b.minY + 0.18 && py + height >= b.minY) {
          py = b.minY - height;
          cvy = 0;
          hitCeiling = true;
        }
      }

      // Resolve ramps vertically (slope ride + downhill ground-snap)
      for (let i = 0; i < this.ramps.length; i++) {
        const r = this.ramps[i];
        // Slight lateral margin by footR * 0.6, exact along ramp run
        const latPad = footR * 0.55;
        const inX =
          r.dir === '+x' || r.dir === '-x'
            ? px >= r.minX && px <= r.maxX
            : px >= r.minX - latPad && px <= r.maxX + latPad;
        const inZ =
          r.dir === '+z' || r.dir === '-z'
            ? pz >= r.minZ && pz <= r.maxZ
            : pz >= r.minZ - latPad && pz <= r.maxZ + latPad;

        if (!inX || !inZ) continue;

        const surfY = this.rampSurfaceY(r, px, pz);
        const snapTolerance = allowGroundSnap && rollingGrounded ? 0.34 : 0.03;

        if (py >= surfY - STEP_HEIGHT - 0.12 && py <= surfY + snapTolerance) {
          if (allowGroundSnap || py <= surfY) {
            if (!wasGrounded && !rollingGrounded && preFallVy < -2) {
              landedImpact = Math.max(landedImpact, -preFallVy * r.ny);
            }
            py = surfY;
            if (cvy < 0) cvy = 0;
            stepGrounded = true;
            stepRamp = r;
          }
        }
      }

      // Detect flying off the high lip of a ramp while running uphill!
      if (rollingRamp && !stepRamp && allowGroundSnap) {
        const prog = this.rampProgress(rollingRamp, px, pz);
        const upSpeed = cvx * rollingRamp.upX + cvz * rollingRamp.upZ;
        if (prog > 0.98 && upSpeed > 4.0) {
          const rampVy = upSpeed * rollingRamp.slope;
          if (rollingRamp.style === 'rampRed') {
            // Crisp springboard launch off signal-red runner ramps (clears gap even without jump!)
            cvy = Math.max(cvy, Math.min(14.0, Math.max(9.8, rampVy * 1.25 + 4.8)));
            cvx += rollingRamp.upX * 2.2;
            cvz += rollingRamp.upZ * 2.2;
            leftRedRamp = rollingRamp;
          } else {
            cvy = Math.max(cvy, Math.min(11.0, rampVy));
          }
          stepGrounded = false;
          allowGroundSnap = false;
        }
      }

      grounded = stepGrounded;
      activeRamp = stepRamp;
      rollingGrounded = stepGrounded;
      rollingRamp = stepRamp;
    }

    return {
      x: px,
      y: py,
      z: pz,
      vx: cvx,
      vy: cvy,
      vz: cvz,
      grounded,
      onRamp: activeRamp,
      leftRedRamp,
      landedImpact,
      hitCeiling,
    };
  }

  hasHeadroom(x: number, y: number, z: number, radius: number, height: number): boolean {
    const topY = y + height;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (y >= b.maxY - 0.01 || topY <= b.minY + 0.01) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  }

  /**
   * Detect a vaultable waist-high obstacle or climbable rooftop ledge directly ahead.
   */
  findLedgeOrVault(
    px: number,
    py: number,
    pz: number,
    dirX: number,
    dirZ: number,
    radius: number,
    grounded: boolean,
    vy: number
  ): LedgeHit | null {
    const probeDist = radius + 0.44;
    const tx = px + dirX * probeDist;
    const tz = pz + dirZ * probeDist;
    const probeR = radius * 0.72;

    let bestVault: LedgeHit | null = null;
    let bestMantle: LedgeHit | null = null;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.style === 'slide' || b.style === 'wallrun') continue;

      const cx = Math.max(b.minX, Math.min(tx, b.maxX));
      const cz = Math.max(b.minZ, Math.min(tz, b.maxZ));
      const dx = tx - cx;
      const dz = tz - cz;
      if (dx * dx + dz * dz > probeR * probeR) continue;

      const relTop = b.maxY - py;
      // Ignore floors below step height or walls too tall to grab
      if (relTop <= STEP_HEIGHT || relTop > 2.2) continue;
      // Make sure box actually blocks torso/legs (not a floating overhead beam)
      if (b.minY > py + 1.15) continue;

      // Check vault first: marked vaultable, between 0.48m and 1.48m above feet
      if (b.vaultable && relTop <= 1.52 && vy > -8.5) {
        const midX = px + dirX * (radius + 0.55);
        const midZ = pz + dirZ * (radius + 0.55);
        if (this.hasHeadroom(midX, b.maxY + 0.04, midZ, radius * 0.8, 1.65)) {
          // Compute clear point past or onto obstacle
          const overX = px + dirX * 1.65;
          const overZ = pz + dirZ * 1.65;
          bestVault = {
            kind: 'vault',
            topY: b.maxY,
            targetX: overX,
            targetZ: overZ,
            boxId: b.id,
          };
          break;
        }
      }

      // Check mantle: airborne (or jumping/pushing into a roof lip) with clear standing room on top
      if (!grounded && relTop >= 0.5 && relTop <= 2.18 && vy < 5.5 && vy > -15.0) {
        const landX = cx + dirX * (radius + 0.22);
        const landZ = cz + dirZ * (radius + 0.22);
        // Ensure landX/landZ is still on top of the box
        const clampedX = Math.max(b.minX + radius, Math.min(landX, b.maxX - radius));
        const clampedZ = Math.max(b.minZ + radius, Math.min(landZ, b.maxZ - radius));
        if (
          b.maxX - b.minX >= radius * 2.1 &&
          b.maxZ - b.minZ >= radius * 2.1 &&
          this.hasHeadroom(clampedX, b.maxY + 0.03, clampedZ, radius * 0.85, 1.75)
        ) {
          if (!bestMantle || b.maxY < bestMantle.topY) {
            bestMantle = {
              kind: 'mantle',
              topY: b.maxY,
              targetX: clampedX,
              targetZ: clampedZ,
              boxId: b.id,
            };
          }
        }
      }
    }

    return bestVault ?? bestMantle;
  }

  /**
   * Detect a vertical wall suitable for wall-running on player's left or right.
   */
  findWallRunCandidate(
    px: number,
    py: number,
    pz: number,
    lookX: number,
    lookZ: number,
    radius: number,
    excludeWallId: string | null
  ): WallCandidate | null {
    // Player's right vector in XZ (since look=(0,-1) => right=(1,0): right = (-lookZ, lookX))
    const rightX = -lookZ;
    const rightZ = lookX;
    const maxReach = radius + 0.62;

    let best: WallCandidate | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.id === excludeWallId) continue;
      if (!b.wallRun) continue;

      // Wall must be tall enough (> 2.1m) and cover the player's torso vertically
      const wallHeight = b.maxY - b.minY;
      if (wallHeight < 2.1) continue;
      if (py + 1.35 > b.maxY + 0.25 || py + 0.45 < b.minY) continue;

      const cx = Math.max(b.minX, Math.min(px, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
      const dx = px - cx;
      const dz = pz - cz;
      const dist = Math.hypot(dx, dz);
      if (dist > maxReach || dist < 1e-4) continue;

      // Snap normal to axis-aligned box face so wall-runs never wobble on corners
      let nx = 0;
      let nz = 0;
      if (Math.abs(dx) >= Math.abs(dz)) {
        nx = dx >= 0 ? 1 : -1;
        // Require at least 3.5m wall span along Z so tiny pillars don't trigger accidental wallruns
        if (b.maxZ - b.minZ < 3.5) continue;
      } else {
        nz = dz >= 0 ? 1 : -1;
        if (b.maxX - b.minX < 3.5) continue;
      }

      // Check angle: player should be looking mostly along the wall, not straight into or away from it
      const lookDotNormal = lookX * nx + lookZ * nz;
      if (lookDotNormal > 0.35 || lookDotNormal < -0.82) continue;

      // Wall tangent aligned with player look
      const tanA_x = -nz;
      const tanA_z = nx;
      const forwardAlong = Math.abs(lookX * tanA_x + lookZ * tanA_z);
      if (forwardAlong < 0.48) continue;

      // Side: vector from player to wall is (-nx, -nz); dot with right
      const toWallDotRight = -nx * rightX + -nz * rightZ;
      if (Math.abs(toWallDotRight) < 0.25) continue;
      const side: -1 | 1 = toWallDotRight >= 0 ? 1 : -1;

      // Prefer dedicated red wallrun panels strongly
      const score = dist - (b.wallRun ? 0.35 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = {
          wallId: b.id,
          nx,
          nz,
          side,
          dist,
          isRunnerWall: b.wallRun,
          minY: b.minY,
          maxY: b.maxY,
        };
      }
    }

    return best;
  }

  /**
   * Check whether an active wall-run wall still exists beside the player.
   */
  isStillBesideWall(
    px: number,
    py: number,
    pz: number,
    wallId: string,
    nx: number,
    nz: number,
    radius: number
  ): boolean {
    const probeDist = radius + 0.72;
    const tx = px - nx * probeDist;
    const tz = pz - nz * probeDist;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.id !== wallId) continue;
      if (py + 1.1 > b.maxY + 0.35 || py + 0.35 < b.minY) return false;
      if (
        tx >= b.minX - 0.15 &&
        tx <= b.maxX + 0.15 &&
        tz >= b.minZ - 0.15 &&
        tz <= b.maxZ + 0.15
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if player is currently touching a launch pad.
   */
  checkLaunchPad(px: number, py: number, pz: number, radius: number): LaunchPadDef | null {
    for (let i = 0; i < this.launchPads.length; i++) {
      const pad = this.launchPads[i];
      const hw = (pad.w ?? 2.8) * 0.5 + radius * 0.5;
      const hd = (pad.d ?? 2.8) * 0.5 + radius * 0.5;
      if (
        Math.abs(px - pad.x) <= hw &&
        Math.abs(pz - pad.z) <= hd &&
        py >= pad.y - 0.35 &&
        py <= pad.y + 1.4
      ) {
        return pad;
      }
    }
    return null;
  }

  /**
   * Find best grapple anchor in view cone and range.
   */
  findBestGrapple(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    lookX: number,
    lookY: number,
    lookZ: number,
    excludeId: string | null = null
  ): { anchor: GrappleDef; dist: number } | null {
    let best: GrappleDef | null = null;
    let bestDist = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < this.grapples.length; i++) {
      const g = this.grapples[i];
      if (g.id === excludeId) continue;
      const maxR = g.radius ?? 26;
      const dx = g.x - eyeX;
      const dy = g.y - eyeY;
      const dz = g.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 3.6 || dist > maxR) continue;

      const invD = 1 / dist;
      const dot = (dx * lookX + dy * lookY + dz * lookZ) * invD;
      // Generous 42-degree cone so high-speed swinging feels fluid and natural
      if (dot < 0.74) continue;

      // Also check horizontal forward alignment so anchors behind you never grab
      const score = dot * 2.0 - dist / maxR * 0.45;
      if (score > bestScore) {
        bestScore = score;
        best = g;
        bestDist = dist;
      }
    }

    return best ? { anchor: best, dist: bestDist } : null;
  }

  /**
   * Spider-Man aim: ray against every rooftop (including noCollide scenery),
   * snapping side hits up to the roof lip so you can web any building you look at.
   */
  findAimSwing(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    lookX: number,
    lookY: number,
    lookZ: number,
    excludeId: string | null = null
  ): { anchor: GrappleDef; dist: number } | null {
    const minT = 5.0;
    const maxT = 48;
    let bestT = maxT + 1;
    let hitX = 0;
    let hitY = 0;
    let hitZ = 0;

    for (let i = 0; i < this.swingVolumes.length; i++) {
      const v = this.swingVolumes[i];
      // Never web a roof under your feet — pendulum needs a point *above* you
      if (v.maxY < eyeY + 1.4) continue;
      const t = rayAabb(eyeX, eyeY, eyeZ, lookX, lookY, lookZ, v, minT, maxT);
      if (t === null || t >= bestT) continue;

      // Aim the lip under the crosshair: intersect the roof plane, clamp to the deck
      let px: number;
      let pz: number;
      if (Math.abs(lookY) > 0.02) {
        const tTop = (v.maxY - eyeY) / lookY;
        if (tTop > 0.5 && tTop < maxT) {
          px = eyeX + lookX * tTop;
          pz = eyeZ + lookZ * tTop;
        } else {
          px = eyeX + lookX * t;
          pz = eyeZ + lookZ * t;
        }
      } else {
        px = eyeX + lookX * t;
        pz = eyeZ + lookZ * t;
      }

      bestT = t;
      hitX = Math.max(v.minX + 0.35, Math.min(v.maxX - 0.35, px));
      hitZ = Math.max(v.minZ + 0.35, Math.min(v.maxZ - 0.35, pz));
      hitY = v.maxY + 0.2;
    }

    if (bestT <= maxT) {
      const id = `web_${Math.round(hitX * 2)}_${Math.round(hitZ * 2)}`;
      return {
        anchor: { id, x: hitX, y: hitY, z: hitZ, radius: 56 },
        dist: bestT,
      };
    }

    return this.findBestGrapple(eyeX, eyeY, eyeZ, lookX, lookY, lookZ, excludeId);
  }

  /** Highest walkable deck under xz, or null. */
  roofAt(x: number, z: number): number | null {
    let best = -Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.style === 'vault' || b.style === 'slide' || b.style === 'wallrun') continue;
      if (x < b.minX + 0.2 || x > b.maxX - 0.2 || z < b.minZ + 0.2 || z > b.maxZ - 0.2) {
        continue;
      }
      if (b.maxY > best) best = b.maxY;
    }
    return best === -Infinity ? null : best;
  }

  /**
   * Check if player crossed a checkpoint volume (generous vertical height so air jumps count!).
   */
  checkCheckpoint(px: number, py: number, pz: number, passedCount: number): CheckpointDef | null {
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (cp.index < passedCount) continue;
      const hw = cp.w * 0.5 + 0.6;
      const hd = cp.d * 0.5 + 0.6;
      if (
        Math.abs(px - cp.x) <= hw &&
        Math.abs(pz - cp.z) <= hd &&
        py >= cp.y - 1.0 &&
        py <= cp.y + 8.5
      ) {
        return cp;
      }
    }
    return null;
  }

  /**
   * Check if player crossed the finish gate.
   */
  checkFinish(px: number, py: number, pz: number): boolean {
    const f = this.finish;
    const hw = f.w * 0.5 + 0.7;
    const hd = f.d * 0.5 + 0.7;
    return (
      Math.abs(px - f.x) <= hw &&
      Math.abs(pz - f.z) <= hd &&
      py >= f.y - 1.2 &&
      py <= f.y + 9.5
    );
  }
}

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: SwingVolume,
  minT: number,
  maxT: number
): number | null {
  const invX = dx !== 0 ? 1 / dx : 1e15;
  const invY = dy !== 0 ? 1 / dy : 1e15;
  const invZ = dz !== 0 ? 1 / dz : 1e15;
  let t1 = (b.minX - ox) * invX;
  let t2 = (b.maxX - ox) * invX;
  let tmin = Math.min(t1, t2);
  let tmax = Math.max(t1, t2);
  t1 = (b.minY - oy) * invY;
  t2 = (b.maxY - oy) * invY;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (b.minZ - oz) * invZ;
  t2 = (b.maxZ - oz) * invZ;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < tmin) return null;
  const t = tmin >= minT ? tmin : tmax;
  if (t < minT || t > maxT) return null;
  return t;
}
