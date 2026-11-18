import * as THREE from 'three';
import { Player } from './player';

/**
 * Stylized Mirror's Edge first-person parkour hands (fingerless charcoal/red runner gloves)
 * + 3D world-space grapple cable rendered cleanly during skyhook swings.
 */
export class ViewModel {
  readonly handRig = new THREE.Group();
  readonly ropeMesh: THREE.Mesh;

  private leftArm: THREE.Group;
  private rightArm: THREE.Group;

  // Smoothed targets so pose transitions feel fluid and weighty
  private lPos = new THREE.Vector3(-0.32, -0.44, -0.38);
  private rPos = new THREE.Vector3(0.32, -0.44, -0.38);
  private lRot = new THREE.Vector3(0.3, 0.1, 0);
  private rRot = new THREE.Vector3(0.3, -0.1, 0);

  private worldWrist = new THREE.Vector3();
  private anchorVec = new THREE.Vector3();
  private midVec = new THREE.Vector3();
  private upAxis = new THREE.Vector3(0, 1, 0);
  private dirVec = new THREE.Vector3();

  constructor() {
    this.leftArm = this.createRunnerArm(-1);
    this.rightArm = this.createRunnerArm(1);
    this.handRig.add(this.leftArm, this.rightArm);

    // Sleek taut amber-core grapple cable in world space
    const ropeGeo = new THREE.CylinderGeometry(0.024, 0.018, 1, 6);
    const ropeMat = new THREE.MeshBasicMaterial({
      color: '#ffaa1d',
    });
    this.ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    this.ropeMesh.visible = false;
    this.ropeMesh.frustumCulled = false;
  }

  private createRunnerArm(side: -1 | 1): THREE.Group {
    const g = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({
      color: '#d9a482',
      roughness: 0.65,
      metalness: 0.02,
      depthTest: false,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: '#1f242c',
      roughness: 0.55,
      metalness: 0.12,
      depthTest: false,
    });
    const redStrapMat = new THREE.MeshStandardMaterial({
      color: '#e52b1e',
      roughness: 0.42,
      metalness: 0.08,
      depthTest: false,
    });
    const whiteTrimMat = new THREE.MeshStandardMaterial({
      color: '#f2f5f8',
      roughness: 0.5,
      depthTest: false,
    });

    // Forearm extending back toward camera shoulder
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.072, 0.34), skinMat);
    forearm.position.set(0, -0.02, 0.2);

    // Athletic wrist wrap (right glove features iconic red runner wrap!)
    const wrist = new THREE.Mesh(
      new THREE.BoxGeometry(0.084, 0.08, 0.065),
      side === 1 ? redStrapMat : gloveMat
    );
    wrist.position.set(0, -0.008, 0.04);

    // Fingerless parkour glove body + white knuckle guard
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.046, 0.095), gloveMat);
    palm.position.set(0, 0, -0.03);

    const knuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.082, 0.014, 0.036),
      side === 1 ? redStrapMat : whiteTrimMat
    );
    knuckle.position.set(0, 0.024, -0.045);

    // Finger tips + thumb
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.036, 0.052), skinMat);
    fingers.position.set(0, -0.006, -0.095);
    fingers.rotation.x = 0.25;

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.055), gloveMat);
    thumb.position.set(-side * 0.052, -0.008, -0.045);
    thumb.rotation.y = side * 0.42;

    for (const part of [forearm, wrist, palm, knuckle, fingers, thumb]) {
      part.renderOrder = 999;
      g.add(part);
    }

    return g;
  }

  setVisible(visible: boolean): void {
    this.handRig.visible = visible;
    if (!visible) this.ropeMesh.visible = false;
  }

  update(player: Player, dt: number, camera: THREE.Camera): void {
    if (!this.handRig.visible) return;

    const sp = player.stridePhase;
    const spdFrac = Math.min(1.25, player.horizSpeed / 12);

    // Default tucked rest pose (just below lower screen corners)
    let tlx = -0.33,
      tly = -0.46,
      tlz = -0.36;
    let trx = 0.33,
      try_ = -0.46,
      trz = -0.36;
    let tlRx = 0.25,
      tlRy = 0.12,
      tlRz = 0.1;
    let trRx = 0.25,
      trRy = -0.12,
      trRz = -0.1;

    switch (player.state) {
      case 'run': {
        // Rhythmic alternating runner arm drive glimpsed crisply on forward upswing!
        const lSwing = Math.sin(sp);
        const rSwing = -lSwing;
        tlx = -0.31 + Math.max(0, lSwing) * 0.05;
        tly = -0.38 + lSwing * 0.11 * spdFrac;
        tlz = -0.38 - lSwing * 0.09 * spdFrac;
        tlRx = 0.42 + lSwing * 0.32;
        tlRz = 0.18;

        trx = 0.31 - Math.max(0, rSwing) * 0.05;
        try_ = -0.38 + rSwing * 0.11 * spdFrac;
        trz = -0.38 - rSwing * 0.09 * spdFrac;
        trRx = 0.42 + rSwing * 0.32;
        trRz = -0.18;
        break;
      }

      case 'vault': {
        // Iconic Mirror's Edge one-hand speed vault plant & push-off!
        const vt = Math.min(1, player.actionTimer / Math.max(0.01, player.actionDuration));
        const arc = Math.sin(vt * Math.PI);
        tlx = -0.16;
        tly = -0.22 - vt * 0.12 + arc * 0.08;
        tlz = -0.48 + vt * 0.16;
        tlRx = -0.35 - arc * 0.25;
        tlRy = -0.2;
        tlRz = -0.15;

        trx = 0.36;
        try_ = -0.24 + arc * 0.1;
        trz = -0.42;
        trRx = 0.55;
        break;
      }

      case 'mantle': {
        // Both gloved hands grab the rooftop lip and pull straight down!
        const mt = Math.min(1, player.actionTimer / Math.max(0.01, player.actionDuration));
        const pullY = -0.1 - mt * 0.32;
        tlx = -0.2;
        tly = pullY;
        tlz = -0.46;
        tlRx = -0.25;
        tlRy = -0.08;
        tlRz = 0;

        trx = 0.2;
        try_ = pullY;
        trz = -0.46;
        trRx = -0.25;
        trRy = 0.08;
        trRz = 0;
        break;
      }

      case 'wallrun': {
        // Wall-side palm skims gracefully along the wall; free arm pumps!
        const skim = Math.sin(sp * 0.8) * 0.02;
        const pump = Math.sin(sp) * 0.08;
        if (player.wallSide === 1) {
          trx = 0.38;
          try_ = -0.2 + skim;
          trz = -0.44;
          trRx = 0.2;
          trRy = -0.45;
          trRz = -0.65;

          tlx = -0.3;
          tly = -0.34 + pump;
          tlz = -0.4 - pump * 0.5;
          tlRx = 0.45;
        } else {
          tlx = -0.38;
          tly = -0.2 + skim;
          tlz = -0.44;
          tlRx = 0.2;
          tlRy = 0.45;
          tlRz = 0.65;

          trx = 0.3;
          try_ = -0.34 + pump;
          trz = -0.4 - pump * 0.5;
          trRx = 0.45;
        }
        break;
      }

      case 'slide': {
        // Low balanced power-slide stance
        tlx = -0.34;
        tly = -0.31;
        tlz = -0.42;
        tlRx = -0.2;
        tlRz = 0.35;

        trx = 0.28;
        try_ = -0.26;
        trz = -0.46;
        trRx = 0.28;
        trRy = 0.15;
        trRz = -0.25;
        break;
      }

      case 'grapple': {
        // Right grapple gauntlet extends forward/up holding the taut skyhook line!
        trx = 0.22;
        try_ = -0.14;
        trz = -0.5;
        trRx = 0.55;
        trRy = 0.08;
        trRz = -0.12;

        tlx = -0.36;
        tly = -0.32;
        tlz = -0.38;
        tlRx = 0.15;
        tlRz = 0.35;
        break;
      }

      case 'air': {
        // Expressive airborne balance hands riding the wind
        const lift = Math.max(-0.08, Math.min(0.1, player.vy * 0.009));
        tlx = -0.34;
        tly = -0.32 + lift;
        tlz = -0.42;
        tlRx = 0.32 + lift * 1.4;
        tlRz = 0.26;

        trx = 0.34;
        try_ = -0.32 + lift;
        trz = -0.42;
        trRx = 0.32 + lift * 1.4;
        trRz = -0.26;
        break;
      }

      default:
        break;
    }

    const blend = Math.min(1, 16 * dt);
    this.lPos.x += (tlx - this.lPos.x) * blend;
    this.lPos.y += (tly - this.lPos.y) * blend;
    this.lPos.z += (tlz - this.lPos.z) * blend;
    this.rPos.x += (trx - this.rPos.x) * blend;
    this.rPos.y += (try_ - this.rPos.y) * blend;
    this.rPos.z += (trz - this.rPos.z) * blend;

    this.lRot.x += (tlRx - this.lRot.x) * blend;
    this.lRot.y += (tlRy - this.lRot.y) * blend;
    this.lRot.z += (tlRz - this.lRot.z) * blend;
    this.rRot.x += (trRx - this.rRot.x) * blend;
    this.rRot.y += (trRy - this.rRot.y) * blend;
    this.rRot.z += (trRz - this.rRot.z) * blend;

    this.leftArm.position.copy(this.lPos);
    this.leftArm.rotation.set(this.lRot.x, this.lRot.y, this.lRot.z);
    this.rightArm.position.copy(this.rPos);
    this.rightArm.rotation.set(this.rRot.x, this.rRot.y, this.rRot.z);

    // Update 3D world-space grapple cable from right wrist to active skyhook
    if (player.state === 'grapple' && player.activeGrapple) {
      camera.updateMatrixWorld();
      this.worldWrist.set(0.24, -0.16, -0.52).applyMatrix4(camera.matrixWorld);
      this.anchorVec.set(
        player.activeGrapple.x,
        player.activeGrapple.y,
        player.activeGrapple.z
      );
      this.dirVec.subVectors(this.anchorVec, this.worldWrist);
      const len = this.dirVec.length();
      if (len > 0.2) {
        this.midVec.addVectors(this.worldWrist, this.anchorVec).multiplyScalar(0.5);
        this.ropeMesh.position.copy(this.midVec);
        this.ropeMesh.scale.set(1, len, 1);
        this.ropeMesh.quaternion.setFromUnitVectors(
          this.upAxis,
          this.dirVec.multiplyScalar(1 / len)
        );
        this.ropeMesh.visible = true;
      } else {
        this.ropeMesh.visible = false;
      }
    } else {
      this.ropeMesh.visible = false;
    }
  }
}
