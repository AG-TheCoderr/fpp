import * as THREE from 'three';
import { CourseDef } from '../types';
import { Player } from './player';

/**
 * Biomechanical first-person skeleton & face-boned camera rig:
 *   rootBone (world feet + yaw)
 *     -> pelvisBone (stride weight shift, double-freq gait bounce, knee-bend landing spring, slide drop)
 *       -> spineBone (sprint drive lean, G-force inertia, corner-carve bank, breathing, wall-run lean)
 *         -> neckBone (cervical shock delay)
 *           -> headBone (player look pitch, damped footstrike nod, stride skull roll/yaw, VOR stabilization)
 *             -> eyeSocket (mounted physically 7.5cm forward on the runner's face!)
 */
export class CameraRig {
  // Real hierarchical 3D skeleton chain
  readonly rootBone = new THREE.Group();
  readonly pelvisBone = new THREE.Group();
  readonly spineBone = new THREE.Group();
  readonly neckBone = new THREE.Group();
  readonly headBone = new THREE.Group();
  readonly eyeSocket = new THREE.Object3D();

  // Base bone heights (standing rest: 0.94 + 0.42 + 0.17 + 0.10 + 0.01 = 1.64m eye height)
  private smoothPelvisY = 0.94;
  private smoothSpineY = 0.42;

  // Stage 1 spring: Knee/pelvis vertical landing compression
  private kneeOffset = 0;
  private kneeVel = 0;

  // Stage 2 spring: Cervical head-nod pitch shock absorber (lags naturally behind knees!)
  private headPitchOffset = 0;
  private headPitchVel = 0;

  // Stage 3 spring: Skull roll impulse (wall-kicks, vaults, asymmetric landings, footfalls)
  private headRollOffset = 0;
  private headRollVel = 0;

  // Smoothed biomechanical channels
  private gaitWeight = 0;
  private smoothSpinePitch = 0;
  private smoothSpineRoll = 0;
  private smoothHeadYaw = 0;
  private smoothPelvisX = 0;
  private smoothPelvisZ = 0;
  private breathPhase = 0;
  private slideChatterPhase = 0;

  // Dynamic FOV
  private smoothFov = 96;
  private fovPunch = 0;

  // Exposed instantaneous camera angular velocity (for velocity motion blur pass)
  prevYaw = 0;
  prevPitch = 0;
  prevRoll = 0;
  angVelYaw = 0;
  angVelPitch = 0;
  angVelRoll = 0;
  private hasPrevAngles = false;

  // Exposed smoothed body state for synced first-person arms & legs
  currentSlideBlend = 0;
  currentKneeDrop = 0;

  // Title / course-select flyover state
  private flyTime = 0;
  private flyPos = new THREE.Vector3();
  private flyLook = new THREE.Vector3();
  private worldEye = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {
    this.camera.rotation.order = 'YXZ';

    // Assemble anatomical hierarchy
    this.rootBone.add(this.pelvisBone);
    this.pelvisBone.add(this.spineBone);
    this.spineBone.add(this.neckBone);
    this.neckBone.add(this.headBone);
    this.headBone.add(this.eyeSocket);

    this.pelvisBone.position.set(0, 0.94, 0);
    this.spineBone.position.set(0, 0.42, 0);
    this.neckBone.position.set(0, 0.17, 0);
    this.headBone.position.set(0, 0.1, -0.02);
    // Physically positioned at the bridge of the eyes on the front of the skull
    this.eyeSocket.position.set(0, 0.01, -0.075);
  }

  reset(baseFov: number): void {
    this.smoothPelvisY = 0.94;
    this.smoothSpineY = 0.42;
    this.kneeOffset = 0;
    this.kneeVel = 0;
    this.headPitchOffset = 0;
    this.headPitchVel = 0;
    this.headRollOffset = 0;
    this.headRollVel = 0;
    this.gaitWeight = 0;
    this.smoothSpinePitch = 0;
    this.smoothSpineRoll = 0;
    this.smoothHeadYaw = 0;
    this.smoothPelvisX = 0;
    this.smoothPelvisZ = 0;
    this.currentSlideBlend = 0;
    this.currentKneeDrop = 0;
    this.smoothFov = baseFov;
    this.fovPunch = 0;
    this.hasPrevAngles = false;
    this.angVelYaw = 0;
    this.angVelPitch = 0;
    this.angVelRoll = 0;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();
  }

  addFovPunch(deg: number): void {
    this.fovPunch = Math.min(11, this.fovPunch + deg);
  }

  onFootstrike(speed: number, isWall: boolean, foot: -1 | 1, bobScale: number): void {
    if (bobScale <= 0.01) return;
    const s = Math.min(1.35, speed / 12.5) * bobScale;
    const wallMul = isWall ? 0.65 : 1.0;
    // Crisp downward micro-impulse into knees & delayed subtle nod into skull!
    this.kneeVel -= 0.42 * s * wallMul;
    this.headPitchVel -= 0.28 * s * wallMul;
    // Alternating skull roll toward stance leg
    this.headRollVel += -foot * 0.34 * s * wallMul;
  }

  onJumpImpulse(boosted: boolean, bobScale: number): void {
    const k = Math.max(0.3, bobScale);
    // Athletic upward chin lift on takeoff
    this.headPitchVel += (boosted ? 0.95 : 0.68) * k;
    this.kneeVel += 0.55 * k;
  }

  onWallKickImpulse(kickedSide: -1 | 1, bobScale: number): void {
    const k = Math.max(0.35, bobScale);
    this.headRollVel -= kickedSide * 1.45 * k;
    this.headPitchVel += 0.72 * k;
  }

  onVaultImpulse(spring: boolean, bobScale: number): void {
    const k = Math.max(0.35, bobScale);
    this.headRollVel += (spring ? 1.5 : 1.15) * k;
    this.headPitchVel -= 0.55 * k;
  }

  onPivotImpulse(rightInput: number, intensity: number, bobScale: number): void {
    const k = Math.max(0.3, bobScale);
    this.kneeVel -= 0.75 * intensity * k;
    this.headRollVel -= rightInput * 0.85 * intensity * k;
  }

  addLandingImpact(impactSpeed: number, intoSlide: boolean, bobScale = 1.0): void {
    const k = Math.max(0.35, bobScale);
    // Breakfall slide absorbs most vertical shock cleanly into horizontal momentum
    const absorb = intoSlide ? 0.34 : 1.0;
    const norm = Math.min(1.5, impactSpeed / 16.0);

    // Stage 1: Deep athletic knee/pelvis compression
    this.kneeVel -= Math.min(5.6, impactSpeed * 0.28 * absorb) * k;
    // Stage 2: Cervical head-nod shockwave (chin dips then recovers cleanly!)
    this.headPitchVel -= Math.min(3.4, norm * 2.1 * absorb) * k;
    // Slight organic asymmetric roll on heavy drops
    if (!intoSlide && impactSpeed > 9.0) {
      this.headRollVel += (Math.random() > 0.5 ? 1 : -1) * norm * 0.55 * k;
    }
  }

  updateGameplay(
    player: Player,
    alpha: number,
    dt: number,
    baseFov: number,
    bobScale: number,
    rightInput: number
  ): void {
    const safeDt = Math.min(0.05, Math.max(1e-4, dt));

    // 1. Interpolated world foot position -> rootBone
    const ix = player.prevX + (player.x - player.prevX) * alpha;
    const iy = player.prevY + (player.y - player.prevY) * alpha;
    const iz = player.prevZ + (player.z - player.prevZ) * alpha;
    this.rootBone.position.set(ix, iy, iz);
    this.rootBone.rotation.set(0, player.yaw, 0);

    // 2. Slide / crouch posture transition on pelvis & spine height
    const isLow = player.state === 'slide' || player.crouched;
    const targetPelvisY = isLow ? 0.38 : 0.94;
    const targetSpineY = isLow ? 0.22 : 0.42;
    const postureRate = isLow ? 19.0 : 13.5;
    const pBlend = Math.min(1, postureRate * safeDt);
    this.smoothPelvisY += (targetPelvisY - this.smoothPelvisY) * pBlend;
    this.smoothSpineY += (targetSpineY - this.smoothSpineY) * pBlend;

    const targetSlide = player.state === 'slide' ? 1 : 0;
    this.currentSlideBlend +=
      (targetSlide - this.currentSlideBlend) * Math.min(1, 15 * safeDt);

    // 3. Critically-damped biomechanical springs (knees, cervical pitch, skull roll)
    // Knee compression spring
    this.kneeVel += (-145 * this.kneeOffset - 17.5 * this.kneeVel) * safeDt;
    this.kneeOffset += this.kneeVel * safeDt;
    this.kneeOffset = Math.max(-0.34, Math.min(0.11, this.kneeOffset));
    this.currentKneeDrop = this.kneeOffset;

    // Cervical head-nod spring (slightly softer frequency so head visibly lags behind pelvis!)
    this.headPitchVel += (-110 * this.headPitchOffset - 14.5 * this.headPitchVel) * safeDt;
    this.headPitchOffset += this.headPitchVel * safeDt;
    this.headPitchOffset = Math.max(-0.22, Math.min(0.14, this.headPitchOffset));

    // Skull roll impulse spring
    this.headRollVel += (-120 * this.headRollOffset - 15.0 * this.headRollVel) * safeDt;
    this.headRollOffset += this.headRollVel * safeDt;
    this.headRollOffset = Math.max(-0.18, Math.min(0.18, this.headRollOffset));

    // 4. Full-body sprint gait cycle (Pelvis bounce + lateral stance shift + fore/aft push)
    const isStriding = player.state === 'run' || player.state === 'wallrun';
    const rawGait = isStriding ? Math.min(1.25, player.horizSpeed / 12.0) : 0;
    this.gaitWeight += (rawGait - this.gaitWeight) * Math.min(1, 11 * safeDt);

    const phi = player.stridePhase;
    const gAmp = this.gaitWeight * bobScale * (player.crouched ? 0.5 : 1.0);
    const wallFactor = player.state === 'wallrun' ? 0.62 : 1.0;

    // Double-frequency vertical bounce with natural asymmetric second harmonic (crisp plant, airy float)
    const pelvisBobY =
      (-Math.cos(phi * 2) * 0.038 + Math.sin(phi * 4) * 0.007) * gAmp * wallFactor;
    // Lateral hip shift over each alternating stance leg
    const gaitShiftX = Math.sin(phi) * 0.036 * gAmp * wallFactor;
    // Subtle explosive forward surge on every toe-off
    const gaitSurgeZ = -Math.sin(phi * 2) * 0.015 * gAmp * wallFactor;

    // Coupled G-force lateral hip shift when cutting direction sharply!
    const inertiaX =
      Math.max(-0.055, Math.min(0.055, -player.localAccelRight * 0.0014)) * bobScale;
    const targetPelvisX = gaitShiftX + inertiaX;
    const targetPelvisZ =
      gaitSurgeZ +
      this.currentSlideBlend * 0.08 + // Hips slide slightly forward in power-slide
      Math.max(-0.04, Math.min(0.04, player.localAccelFwd * 0.001)) * bobScale;

    this.smoothPelvisX += (targetPelvisX - this.smoothPelvisX) * Math.min(1, 18 * safeDt);
    this.smoothPelvisZ += (targetPelvisZ - this.smoothPelvisZ) * Math.min(1, 18 * safeDt);

    // Tactile micro-rumble through pelvis when sliding fast on poured concrete
    let slideRumbleY = 0;
    let slideRumbleX = 0;
    if (player.state === 'slide' && player.grounded && bobScale > 0.05) {
      const sFactor = Math.min(1.2, player.horizSpeed / 18) * bobScale;
      const brakeBoost = player.slideBraking ? 1.65 : 1.0;
      this.slideChatterPhase += safeDt * (38 + player.horizSpeed * 1.4);
      slideRumbleY =
        (Math.sin(this.slideChatterPhase) * 0.0032 +
          Math.sin(this.slideChatterPhase * 2.3) * 0.0018) *
        sFactor *
        brakeBoost;
      slideRumbleX = Math.cos(this.slideChatterPhase * 1.7) * 0.0022 * sFactor * brakeBoost;
    }

    // 5. Thoracic breathing (calms at rest, deeper right after an intense rooftop sprint!)
    const breathFreq = 0.3 + player.exertion * 0.52;
    this.breathPhase += safeDt * breathFreq * Math.PI * 2;
    const idleFactor = Math.max(0.15, 1 - this.gaitWeight * 0.85);
    const breathAmp = (0.004 + player.exertion * 0.011) * idleFactor * bobScale;
    const breathY = Math.sin(this.breathPhase) * breathAmp;
    const breathPitch = Math.sin(this.breathPhase - 0.4) * breathAmp * 0.55;

    // 6. Spine pitch (acceleration lean, braking dip, slide recline, mantle pull, slope coupling)
    const accelLean =
      Math.max(-0.036, Math.min(0.032, -player.localAccelFwd * 0.0011)) * bobScale;
    let actionPitch = 0;
    if (player.state === 'mantle') {
      // Chin dips down toward gripping hands over the coping, then presses cleanly up!
      const mt = player.actionTimer / Math.max(0.01, player.actionDuration);
      actionPitch = -Math.sin(mt * Math.PI) * 0.145;
    } else if (player.state === 'vault') {
      const vt = player.actionTimer / Math.max(0.01, player.actionDuration);
      actionPitch = -Math.sin(vt * Math.PI) * 0.045;
    } else if (player.state === 'slide') {
      // Subtle slope-ride pitch when shooting down concrete chutes + slight brake dip
      actionPitch =
        Math.max(-0.065, Math.min(0.04, player.groundSlopePitch * 0.22)) -
        (player.slideBraking ? 0.022 : 0);
    }

    const gaitPitch = -Math.cos(phi * 2 - 0.55) * 0.0085 * gAmp * wallFactor;
    const targetSpinePitch = accelLean + actionPitch + breathPitch;
    this.smoothSpinePitch +=
      (targetSpinePitch - this.smoothSpinePitch) * Math.min(1, 12 * safeDt);

    // 7. Spine & skull roll (wall-run tilt, slide-carve bank, lateral G-force cut, alternating stride roll)
    let targetRoll = 0;
    const gForceBank =
      Math.max(-0.052, Math.min(0.052, -player.localAccelRight * 0.0019)) *
      Math.max(0.4, bobScale);

    if (player.state === 'wallrun') {
      targetRoll = player.wallSide * 0.24; // ~13.8° signature wall-run horizon tilt
    } else if (player.state === 'slide') {
      // Power-slide side lean + responsive carve banking on A/D!
      targetRoll = -0.075 - player.slideSteer * 0.075 + gForceBank * 0.4;
    } else if (player.state === 'vault') {
      const vt = player.actionTimer / Math.max(0.01, player.actionDuration);
      targetRoll = Math.sin(vt * Math.PI) * 0.125;
    } else if (player.state === 'mantle') {
      const mt = player.actionTimer / Math.max(0.01, player.actionDuration);
      targetRoll = -Math.sin(mt * Math.PI) * 0.045;
    } else if (player.state === 'grapple') {
      targetRoll =
        -rightInput * 0.085 +
        gForceBank * 0.8 +
        Math.sin(player.grappleTimer * 3.0) * 0.03;
    } else {
      targetRoll = -rightInput * 0.022 + gForceBank;
    }
    this.smoothSpineRoll += (targetRoll - this.smoothSpineRoll) * Math.min(1, 12.5 * safeDt);

    // Natural phase-lagged skull roll & VOR-stabilized micro-yaw from each footfall
    const gaitSkullRoll = Math.sin(phi - 0.35) * 0.0125 * gAmp * wallFactor;
    const targetHeadYaw = Math.sin(phi - 0.2) * 0.005 * gAmp * wallFactor;
    this.smoothHeadYaw += (targetHeadYaw - this.smoothHeadYaw) * Math.min(1, 16 * safeDt);

    // 8. Drive the 3D bone hierarchy & read world eye position straight from the runner's face!
    this.pelvisBone.position.set(
      this.smoothPelvisX + slideRumbleX,
      this.smoothPelvisY + this.kneeOffset + pelvisBobY + slideRumbleY,
      this.smoothPelvisZ
    );
    this.pelvisBone.rotation.set(0, 0, this.smoothSpineRoll * 0.35);

    this.spineBone.position.set(0, this.smoothSpineY + breathY, 0);
    this.spineBone.rotation.set(this.smoothSpinePitch * 0.65, 0, this.smoothSpineRoll * 0.65);

    const finalPitch = Math.max(
      -1.48,
      Math.min(
        1.48,
        player.pitch + this.smoothSpinePitch + gaitPitch + this.headPitchOffset
      )
    );
    const finalYaw = player.yaw + this.smoothHeadYaw;
    const finalRoll = this.smoothSpineRoll + gaitSkullRoll + this.headRollOffset;

    // Pitch headBone on the actual neck joint so eyeSocket (7.5cm forward on face) arcs realistically!
    this.headBone.rotation.set(
      player.pitch * 0.85 + this.headPitchOffset + gaitPitch,
      this.smoothHeadYaw,
      gaitSkullRoll + this.headRollOffset
    );

    this.rootBone.updateMatrixWorld(true);
    this.eyeSocket.getWorldPosition(this.worldEye);

    this.camera.position.copy(this.worldEye);
    this.camera.rotation.set(finalPitch, finalYaw, finalRoll, 'YXZ');

    // 9. Track smoothed angular velocity for our post-process velocity motion blur
    if (this.hasPrevAngles) {
      let dYaw = player.yaw - this.prevYaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const dPitch = player.pitch - this.prevPitch;
      const dRoll = finalRoll - this.prevRoll;
      const invDt = 1 / safeDt;
      const blend = Math.min(1, 22 * safeDt);
      this.angVelYaw += (dYaw * invDt - this.angVelYaw) * blend;
      this.angVelPitch += (dPitch * invDt - this.angVelPitch) * blend;
      this.angVelRoll += (dRoll * invDt - this.angVelRoll) * blend;
    } else {
      this.hasPrevAngles = true;
    }
    this.prevYaw = player.yaw;
    this.prevPitch = player.pitch;
    this.prevRoll = finalRoll;

    // 10. Velocity-scaled dynamic FOV + action boost punch
    this.fovPunch += (0 - this.fovPunch) * Math.min(1, 5.8 * safeDt);
    const speedFactor = Math.max(0, Math.min(1, (player.horizSpeed - 9.8) / 15.0));
    // Smooth curve gives subtle lift at base sprint and dramatic wide tunnel at 22+ m/s
    const curvedSpeed = speedFactor * (0.7 + 0.3 * speedFactor);
    const targetFov = Math.min(126, baseFov + curvedSpeed * 14.0 + this.fovPunch);
    this.smoothFov += (targetFov - this.smoothFov) * Math.min(1, 9.5 * safeDt);

    if (Math.abs(this.camera.fov - this.smoothFov) > 0.02) {
      this.camera.fov = this.smoothFov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateFlyover(course: CourseDef, dt: number): void {
    this.hasPrevAngles = false;
    this.angVelYaw = 0;
    this.angVelPitch = 0;
    this.angVelRoll = 0;

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
