import * as THREE from 'three';
import { Player } from './player';

/**
 * Full-presence first-person parkour body (fingerless runner gloves + power-slide
 * leg & iconic red/white parkour shoe + world-space grapple tether).
 * Rendered in a crisp dedicated overlay pass so hands & shoes never blur or clip walls!
 */
export class ViewModel {
  readonly viewScene = new THREE.Scene();
  readonly handRig = new THREE.Group();
  readonly lowerBodyRig = new THREE.Group();
  readonly ropeMesh: THREE.Mesh;

  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private slideLeg: THREE.Group;
  private tuckLeg: THREE.Group;

  private lPos = new THREE.Vector3(-0.32, -0.44, -0.38);
  private rPos = new THREE.Vector3(0.32, -0.44, -0.38);
  private lRot = new THREE.Vector3(0.3, 0.1, 0);
  private rRot = new THREE.Vector3(0.3, -0.1, 0);
  private slideLegBlend = 0;

  private viewSun: THREE.DirectionalLight;

  private worldWrist = new THREE.Vector3();
  private anchorVec = new THREE.Vector3();
  private midVec = new THREE.Vector3();
  private upAxis = new THREE.Vector3(0, 1, 0);
  private dirVec = new THREE.Vector3();

  private visible = false;

  constructor() {
    // Match sunlit brutalist lighting in the crisp first-person body overlay scene
    const hemi = new THREE.HemisphereLight('#96c9ff', '#cfc6ba', 1.15);
    this.viewSun = new THREE.DirectionalLight('#fff7ea', 2.1);
    this.viewSun.position.set(12, 18, -10);
    this.viewScene.add(hemi, this.viewSun);

    this.leftArm = this.createRunnerArm(-1);
    this.rightArm = this.createRunnerArm(1);
    this.handRig.add(this.leftArm, this.rightArm);

    // Iconic Mirror's Edge extended left leg + tucked right leg during power-slides & looking down!
    this.slideLeg = this.createRunnerLeg(true);
    this.tuckLeg = this.createRunnerLeg(false);
    this.lowerBodyRig.add(this.slideLeg, this.tuckLeg);
    this.viewScene.add(this.handRig, this.lowerBodyRig);

    // Taut amber-steel grapple cable in main world space
    const ropeGeo = new THREE.CylinderGeometry(0.024, 0.018, 1, 6);
    const ropeMat = new THREE.MeshBasicMaterial({ color: '#ffaa1d' });
    this.ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    this.ropeMesh.visible = false;
    this.ropeMesh.frustumCulled = false;
  }

  private createRunnerArm(side: -1 | 1): THREE.Group {
    const g = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({
      color: '#d9a482',
      roughness: 0.64,
      metalness: 0.02,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: '#1e232b',
      roughness: 0.52,
      metalness: 0.14,
    });
    const redStrapMat = new THREE.MeshStandardMaterial({
      color: '#e52b1e',
      roughness: 0.4,
      metalness: 0.08,
    });
    const whiteTrimMat = new THREE.MeshStandardMaterial({
      color: '#f2f5f8',
      roughness: 0.48,
    });

    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.072, 0.36), skinMat);
    forearm.position.set(0, -0.02, 0.21);

    const wrist = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.08, 0.068),
      side === 1 ? redStrapMat : gloveMat
    );
    wrist.position.set(0, -0.008, 0.04);

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.046, 0.096), gloveMat);
    palm.position.set(0, 0, -0.03);

    const knuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.082, 0.014, 0.036),
      side === 1 ? redStrapMat : whiteTrimMat
    );
    knuckle.position.set(0, 0.024, -0.045);

    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.036, 0.052), skinMat);
    fingers.position.set(0, -0.006, -0.095);
    fingers.rotation.x = 0.25;

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.055), gloveMat);
    thumb.position.set(-side * 0.052, -0.008, -0.045);
    thumb.rotation.y = side * 0.42;

    g.add(forearm, wrist, palm, knuckle, fingers, thumb);
    return g;
  }

  private createRunnerLeg(isLead: boolean): THREE.Group {
    const g = new THREE.Group();

    const pantsMat = new THREE.MeshStandardMaterial({
      color: '#1b2028',
      roughness: 0.72,
      metalness: 0.05,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#f0f3f7',
      roughness: 0.55,
    });
    const shoeRedMat = new THREE.MeshStandardMaterial({
      color: '#e52b1e',
      roughness: 0.38,
      metalness: 0.06,
    });
    const soleMat = new THREE.MeshStandardMaterial({
      color: '#f5f7fa',
      roughness: 0.6,
    });

    // Tapered athletic cargo runner pants shin/thigh
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.125, 0.54), pantsMat);
    shin.position.set(0, 0, 0.16);

    // Crisp white side runner stripe along outer leg
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.5), stripeMat);
    stripe.position.set(isLead ? -0.068 : 0.068, 0.015, 0.16);

    g.add(shin, stripe);

    if (isLead) {
      // Iconic Mirror's Edge signal-red split-toe runner sneaker kicking forward!
      const shoeGroup = new THREE.Group();
      shoeGroup.position.set(0, 0.02, -0.15);
      shoeGroup.rotation.x = 0.22; // Toe angled slightly up skimming over concrete!

      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.23, 0.095), shoeRedMat);
      upper.position.set(0, 0.06, 0);

      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.1), pantsMat);
      strap.position.set(0, 0.03, 0.005);

      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.032), soleMat);
      sole.position.set(0, 0.06, -0.055);

      shoeGroup.add(upper, strap, sole);
      g.add(shoeGroup);
    }

    return g;
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.viewSun.position.copy(dir).multiplyScalar(20);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.handRig.visible = visible;
    this.lowerBodyRig.visible = visible;
    if (!visible) this.ropeMesh.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(player: Player, dt: number, camera: THREE.Camera): void {
    if (!this.visible) return;

    const safeDt = Math.min(0.05, Math.max(1e-4, dt));
    const sp = player.stridePhase;
    const spdFrac = Math.min(1.3, player.horizSpeed / 12);

    // Sync viewmodel parent directly to face-boned camera transform
    camera.updateMatrixWorld();
    this.handRig.position.copy(camera.position);
    this.handRig.quaternion.copy(camera.quaternion);

    // Subtle lag/sway from lateral acceleration so hands feel physically weighted
    const swayX = Math.max(-0.035, Math.min(0.035, -player.localAccelRight * 0.0009));

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
        // Biomechanical counter-swing: left foot strike (+sin) drives RIGHT arm forward!
        const lSwing = -Math.sin(sp);
        const rSwing = Math.sin(sp);
        const drive = player.crouched ? 0.35 : spdFrac;

        tlx = -0.31 + Math.max(0, lSwing) * 0.055 + swayX;
        tly = -0.37 + lSwing * 0.115 * drive;
        tlz = -0.38 - lSwing * 0.095 * drive;
        tlRx = 0.44 + lSwing * 0.34;
        tlRz = 0.18;

        trx = 0.31 - Math.max(0, rSwing) * 0.055 + swayX;
        try_ = -0.37 + rSwing * 0.115 * drive;
        trz = -0.38 - rSwing * 0.095 * drive;
        trRx = 0.44 + rSwing * 0.34;
        trRz = -0.18;
        break;
      }

      case 'vault': {
        const vt = Math.min(1, player.actionTimer / Math.max(0.01, player.actionDuration));
        const arc = Math.sin(vt * Math.PI);
        tlx = -0.15;
        tly = -0.21 - vt * 0.13 + arc * 0.09;
        tlz = -0.49 + vt * 0.17;
        tlRx = -0.38 - arc * 0.25;
        tlRy = -0.22;
        tlRz = -0.16;

        trx = 0.36;
        try_ = -0.23 + arc * 0.11;
        trz = -0.42;
        trRx = 0.56;
        break;
      }

      case 'mantle': {
        const mt = Math.min(1, player.actionTimer / Math.max(0.01, player.actionDuration));
        const pullY = -0.09 - mt * 0.34;
        tlx = -0.2;
        tly = pullY;
        tlz = -0.46;
        tlRx = -0.26;
        tlRy = -0.08;
        tlRz = 0;

        trx = 0.2;
        try_ = pullY;
        trz = -0.46;
        trRx = -0.26;
        trRy = 0.08;
        trRz = 0;
        break;
      }

      case 'wallrun': {
        const skim = Math.sin(sp * 0.85) * 0.022;
        const pump = Math.sin(sp) * 0.085;
        if (player.wallSide === 1) {
          trx = 0.38;
          try_ = -0.19 + skim;
          trz = -0.44;
          trRx = 0.2;
          trRy = -0.46;
          trRz = -0.66;

          tlx = -0.3;
          tly = -0.33 + pump;
          tlz = -0.4 - pump * 0.5;
          tlRx = 0.46;
        } else {
          tlx = -0.38;
          tly = -0.19 + skim;
          tlz = -0.44;
          tlRx = 0.2;
          tlRy = 0.46;
          tlRz = 0.66;

          trx = 0.3;
          try_ = -0.33 + pump;
          trz = -0.4 - pump * 0.5;
          trRx = 0.46;
        }
        break;
      }

      case 'slide': {
        // Left hand skims low near concrete for balance; right arm stabilizes across carve!
        const carve = player.slideSteer;
        tlx = -0.36 - carve * 0.04;
        tly = -0.32;
        tlz = -0.4;
        tlRx = -0.22;
        tlRz = 0.38;

        trx = 0.29 - carve * 0.05;
        try_ = -0.25 + (player.slideBraking ? 0.04 : 0);
        trz = -0.46;
        trRx = 0.3;
        trRy = 0.16;
        trRz = -0.26 - carve * 0.14;
        break;
      }

      case 'grapple': {
        trx = 0.22 + swayX * 0.5;
        try_ = -0.14;
        trz = -0.5;
        trRx = 0.55;
        trRy = 0.08;
        trRz = -0.12;

        tlx = -0.36 + swayX;
        tly = -0.31;
        tlz = -0.38;
        tlRx = 0.16;
        tlRz = 0.36;
        break;
      }

      case 'air': {
        const lift = Math.max(-0.08, Math.min(0.11, player.vy * 0.009));
        tlx = -0.34 + swayX;
        tly = -0.32 + lift;
        tlz = -0.42;
        tlRx = 0.32 + lift * 1.4;
        tlRz = 0.26;

        trx = 0.34 + swayX;
        try_ = -0.32 + lift;
        trz = -0.42;
        trRx = 0.32 + lift * 1.4;
        trRz = -0.26;
        break;
      }

      default:
        break;
    }

    const blend = Math.min(1, 16 * safeDt);
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

    // Update extended parkour slide leg (world-yaw aligned so looking up/down shows your sliding shoe naturally!)
    const wantSlideLeg = player.state === 'slide' ? 1 : 0;
    this.slideLegBlend += (wantSlideLeg - this.slideLegBlend) * Math.min(1, 15 * safeDt);

    if (this.slideLegBlend > 0.02) {
      this.lowerBodyRig.visible = true;
      // Anchor at hip beneath camera, rotated with slide travel direction
      const slideYaw =
        player.horizSpeed > 1.5
          ? Math.atan2(-player.vx, -player.vz)
          : player.yaw;
      this.lowerBodyRig.position.set(
        camera.position.x,
        camera.position.y - 0.46 - (1 - this.slideLegBlend) * 0.42,
        camera.position.z
      );
      this.lowerBodyRig.rotation.set(0, slideYaw, -player.slideSteer * 0.12);

      // Lead left leg kicks straight out with signal-red runner sneaker!
      this.slideLeg.position.set(-0.11, -0.02, -0.58 * this.slideLegBlend);
      this.slideLeg.rotation.set(-0.08, 0.06, 0.08);

      // Right knee bends athletically out to the side
      this.tuckLeg.position.set(0.18, -0.07, -0.34 * this.slideLegBlend);
      this.tuckLeg.rotation.set(-0.14, -0.55, -0.35);
    } else {
      this.lowerBodyRig.visible = false;
    }

    // Update 3D world-space grapple cable from right wrist to active skyhook
    if (player.state === 'grapple' && player.activeGrapple) {
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

  renderOverlay(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.visible) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.viewScene, camera);
    renderer.autoClear = prevAutoClear;
  }
}
