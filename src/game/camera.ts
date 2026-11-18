import * as THREE from 'three';
import { CourseDef } from '../types';
import { Player, STAND_EYE } from './player';

export class CameraRig {
  private smoothEye = STAND_EYE;
  private smoothRoll = 0;
  private smoothFov = 96;
  private fovPunch = 0;
  private landOffset = 0;
  private landVel = 0;
  private bobAmount = 0;

  // Flyover state for title & course-select screens
  private flyTime = 0;
  private flyPos = new THREE.Vector3();
  private flyLook = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {
    this.camera.rotation.order = 'YXZ';
  }

  reset(baseFov: number): void {
    this.smoothEye = STAND_EYE;
    this.smoothRoll = 0;
    this.smoothFov = baseFov;
    this.fovPunch = 0;
    this.landOffset = 0;
    this.landVel = 0;
    this.bobAmount = 0;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();
  }

  addFovPunch(deg: number): void {
    this.fovPunch = Math.min(11, this.fovPunch + deg);
  }

  addLandingImpact(impactSpeed: number, intoSlide: boolean): void {
    const strength = intoSlide ? 0.35 : 0.72;
    const impulse = Math.min(4.8, impactSpeed * 0.24 * strength);
    this.landVel -= impulse;
  }

  updateGameplay(
    player: Player,
    alpha: number,
    dt: number,
    baseFov: number,
    rightInput: number
  ): void {
    // Sub-step interpolated foot position
    const ix = player.prevX + (player.x - player.prevX) * alpha;
    const iy = player.prevY + (player.y - player.prevY) * alpha;
    const iz = player.prevZ + (player.z - player.prevZ) * alpha;

    // Smooth eye height (crisp drop on slide, smooth rise on stand)
    const eyeRate = player.state === 'slide' ? 18 : 13;
    this.smoothEye += (player.eyeHeight - this.smoothEye) * Math.min(1, eyeRate * dt);

    // Damped spring for landing compression dip
    const stiffness = 135;
    const damping = 16;
    const springAcc = -stiffness * this.landOffset - damping * this.landVel;
    this.landVel += springAcc * dt;
    this.landOffset += this.landVel * dt;
    this.landOffset = Math.max(-0.34, Math.min(0.12, this.landOffset));

    // Athletic stride bob (subtle, crisp, zero nausea)
    const isRunning = player.state === 'run' || player.state === 'wallrun';
    const targetBob = isRunning ? Math.min(1, player.horizSpeed / 12) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, 10 * dt);
    const bobScale = player.state === 'wallrun' ? 0.022 : 0.036;
    const bobY = Math.abs(Math.sin(player.stridePhase)) * bobScale * this.bobAmount;
    const bobSide = Math.cos(player.stridePhase) * 0.02 * this.bobAmount;

    // Target camera roll (signature Mirror's Edge horizon tilt!)
    let targetRoll = 0;
    if (player.state === 'wallrun') {
      // Wall on right (+1) -> tilt camera LEFT (+roll around Z in Three.js YXZ!)
      targetRoll = player.wallSide * 0.235; // ~13.5 deg
    } else if (player.state === 'slide') {
      targetRoll = -0.068 - rightInput * 0.04;
    } else if (player.state === 'vault') {
      const vt = player.actionTimer / Math.max(0.01, player.actionDuration);
      targetRoll = Math.sin(vt * Math.PI) * 0.11;
    } else if (player.state === 'mantle') {
      const mt = player.actionTimer / Math.max(0.01, player.actionDuration);
      targetRoll = -Math.sin(mt * Math.PI) * 0.05;
    } else if (player.state === 'grapple') {
      targetRoll = -rightInput * 0.08 + Math.sin(player.grappleTimer * 3.2) * 0.035;
    } else {
      targetRoll = -rightInput * 0.024;
    }

    this.smoothRoll += (targetRoll - this.smoothRoll) * Math.min(1, 11.5 * dt);

    // Speed-scaled dynamic FOV + boost punch
    this.fovPunch += (0 - this.fovPunch) * Math.min(1, 5.5 * dt);
    const speedFactor = Math.max(0, Math.min(1, (player.horizSpeed - 10.0) / 14.0));
    const targetFov = Math.min(126, baseFov + speedFactor * 13.5 + this.fovPunch);
    this.smoothFov += (targetFov - this.smoothFov) * Math.min(1, 9.0 * dt);

    if (Math.abs(this.camera.fov - this.smoothFov) > 0.02) {
      this.camera.fov = this.smoothFov;
      this.camera.updateProjectionMatrix();
    }

    const [rx, rz] = player.getHorizRight();
    this.camera.position.set(
      ix + rx * bobSide,
      iy + this.smoothEye + this.landOffset + bobY,
      iz + rz * bobSide
    );

    // Subtle pitch dip on mantle pull-up for physical weight
    let extraPitch = 0;
    if (player.state === 'mantle') {
      const mt = player.actionTimer / Math.max(0.01, player.actionDuration);
      extraPitch = -Math.sin(mt * Math.PI) * 0.12;
    }

    this.camera.rotation.y = player.yaw;
    this.camera.rotation.x = Math.max(-1.48, Math.min(1.48, player.pitch + extraPitch));
    this.camera.rotation.z = this.smoothRoll;
  }

  updateFlyover(course: CourseDef, dt: number): void {
    const shots = course.flyover;
    if (shots.length === 0) return;

    this.flyTime += dt;
    const totalDur = shots.reduce((acc, s) => acc + s.duration, 0);
    let rem = this.flyTime % totalDur;
    let shot = shots[0];
    for (const s of shots) {
      if (rem <= s.duration) {
        shot = s;
        break;
      }
      rem -= s.duration;
    }

    const rawT = Math.max(0, Math.min(1, rem / shot.duration));
    // Smooth cinematic ease
    const t = rawT * rawT * (3 - 2 * rawT);

    this.flyPos.set(
      shot.from[0] + (shot.to[0] - shot.from[0]) * t,
      shot.from[1] + (shot.to[1] - shot.from[1]) * t,
      shot.from[2] + (shot.to[2] - shot.from[2]) * t
    );
    this.flyLook.set(
      shot.lookFrom[0] + (shot.lookTo[0] - shot.lookFrom[0]) * t,
      shot.lookFrom[1] + (shot.lookTo[1] - shot.lookFrom[1]) * t,
      shot.lookFrom[2] + (shot.lookTo[2] - shot.lookFrom[2]) * t
    );

    if (Math.abs(this.camera.fov - 68) > 0.1) {
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.flyPos);
    this.camera.lookAt(this.flyLook);
  }
}
