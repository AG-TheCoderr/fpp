import * as THREE from 'three';
import { GhostFrame, MoveState } from '../types';
import { Player } from './player';

const STATE_LIST: MoveState[] = [
  'idle',
  'run',
  'air',
  'slide',
  'wallrun',
  'vault',
  'mantle',
  'grapple',
];

function stateToId(s: MoveState): number {
  const i = STATE_LIST.indexOf(s);
  return i >= 0 ? i : 0;
}

const TRAIL_POINTS = 28;

export class GhostSystem {
  readonly group = new THREE.Group();
  private runner: THREE.Group;
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private runnerMat: THREE.MeshBasicMaterial;
  private trailLine: THREE.Line;
  private trailPositions: Float32Array;
  private trailHistory: THREE.Vector3[] = [];

  private recorded: GhostFrame[] = [];
  private recordAccum = 0;

  private playback: GhostFrame[] = [];
  private playbackCursor = 0;

  constructor() {
    this.runnerMat = new THREE.MeshBasicMaterial({
      color: '#22d4ff',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    this.runner = new THREE.Group();

    // Sleek geometric runner silhouette (head + tapered athletic torso + directional visor)
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 0.28), this.runnerMat);
    this.torso.position.y = 0.86;
    this.head = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 1), this.runnerMat);
    this.head.position.y = 1.62;

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.24), this.runnerMat);
    legs.position.y = 0.22;

    this.runner.add(legs, this.torso, this.head);
    this.runner.visible = false;
    this.group.add(this.runner);

    // Sleek cyan wind-stream trail behind PB ghost
    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: '#4de4ff',
      transparent: true,
      opacity: 0.55,
    });
    this.trailLine = new THREE.Line(trailGeo, trailMat);
    this.trailLine.visible = false;
    this.trailLine.frustumCulled = false;
    this.group.add(this.trailLine);
  }

  setPlaybackGhost(frames: GhostFrame[]): void {
    this.playback = frames;
    this.resetRun();
  }

  resetRun(): void {
    this.recorded = [];
    this.recordAccum = 0;
    this.playbackCursor = 0;
    this.trailHistory.length = 0;
    this.runner.visible = false;
    this.trailLine.visible = false;
  }

  getRecordedFrames(): GhostFrame[] {
    return this.recorded;
  }

  recordStep(player: Player, dt: number): void {
    if (!player.runStarted || player.runFinished) return;

    if (this.recorded.length === 0) {
      this.pushFrame(player);
      return;
    }

    this.recordAccum += dt;
    if (this.recordAccum >= 0.05) {
      this.recordAccum -= 0.05;
      this.pushFrame(player);
    }
  }

  captureFinalFrame(player: Player): void {
    this.pushFrame(player);
  }

  private pushFrame(player: Player): void {
    this.recorded.push({
      t: player.runTime,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      state: stateToId(player.state),
    });
  }

  updatePlayback(player: Player, enabled: boolean): void {
    if (
      !enabled ||
      !player.runStarted ||
      player.runFinished ||
      this.playback.length < 2
    ) {
      this.runner.visible = false;
      this.trailLine.visible = false;
      return;
    }

    const t = player.runTime;
    const last = this.playback[this.playback.length - 1];
    if (t > last.t + 0.4) {
      this.runner.visible = false;
      this.trailLine.visible = false;
      return;
    }

    // Advance cursor monotonically
    while (
      this.playbackCursor < this.playback.length - 2 &&
      this.playback[this.playbackCursor + 1].t < t
    ) {
      this.playbackCursor++;
    }
    // Handle rewind if somehow needed
    if (this.playback[this.playbackCursor].t > t) {
      this.playbackCursor = 0;
    }

    const a = this.playback[this.playbackCursor];
    const b = this.playback[Math.min(this.playback.length - 1, this.playbackCursor + 1)];
    const span = Math.max(1e-4, b.t - a.t);
    const k = Math.max(0, Math.min(1, (t - a.t) / span));

    const gx = a.x + (b.x - a.x) * k;
    const gy = a.y + (b.y - a.y) * k;
    const gz = a.z + (b.z - a.z) * k;

    // Shortest angular interpolation for yaw
    let dYaw = b.yaw - a.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const gyaw = a.yaw + dYaw * k;

    this.runner.position.set(gx, gy, gz);
    this.runner.rotation.y = gyaw;

    // Match slide crouch posture visually!
    const isSlide = a.state === 3;
    this.torso.scale.y = isSlide ? 0.52 : 1.0;
    this.torso.position.y = isSlide ? 0.52 : 0.86;
    this.head.position.y = isSlide ? 0.92 : 1.62;

    // Fade out gently if overlapping player so ghost NEVER obstructs camera!
    const playerDist = Math.hypot(gx - player.x, gy - player.y, gz - player.z);
    const fade = Math.max(0, Math.min(1, (playerDist - 1.1) / 2.2));
    this.runnerMat.opacity = 0.42 * fade;
    this.runner.visible = fade > 0.03;

    // Update trailing wake ribbon
    const ribbonPos = new THREE.Vector3(gx, gy + (isSlide ? 0.55 : 1.05), gz);
    if (
      this.trailHistory.length === 0 ||
      this.trailHistory[0].distanceToSquared(ribbonPos) > 0.06
    ) {
      this.trailHistory.unshift(ribbonPos);
      if (this.trailHistory.length > TRAIL_POINTS) {
        this.trailHistory.pop();
      }
    }

    if (this.trailHistory.length >= 2) {
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const pt = this.trailHistory[Math.min(i, this.trailHistory.length - 1)];
        this.trailPositions[i * 3] = pt.x;
        this.trailPositions[i * 3 + 1] = pt.y;
        this.trailPositions[i * 3 + 2] = pt.z;
      }
      (this.trailLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
        true;
      this.trailLine.visible = fade > 0.1;
    }
  }
}
