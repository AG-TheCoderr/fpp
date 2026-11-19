import * as THREE from 'three';
import { PhysicsWorld } from './physics';
import { Player } from './player';

const GRAVITY = 24;

/** Faint runner-vision: aimed web lip + predicted landing disc. */
export class RunnerVision {
  readonly group = new THREE.Group();
  private lip: THREE.Mesh;
  private land: THREE.Mesh;
  private pulse = 0;

  constructor() {
    const lipMat = new THREE.MeshBasicMaterial({
      color: '#e52b1e',
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    const lipGeo = new THREE.TorusGeometry(0.55, 0.045, 6, 20);
    this.lip = new THREE.Mesh(lipGeo, lipMat);
    this.lip.rotation.x = Math.PI / 2;
    this.lip.visible = false;
    this.lip.renderOrder = 4;
    this.group.add(this.lip);

    const landMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const landGeo = new THREE.RingGeometry(0.28, 0.62, 20);
    this.land = new THREE.Mesh(landGeo, landMat);
    this.land.rotation.x = -Math.PI / 2;
    this.land.visible = false;
    this.land.renderOrder = 4;
    this.group.add(this.land);
  }

  update(player: Player, world: PhysicsWorld, dt: number): void {
    this.pulse += dt;
    const lock = player.lockedGrapple;
    if (lock && player.state !== 'grapple') {
      this.lip.visible = true;
      const s = 0.92 + Math.sin(this.pulse * 7) * 0.08;
      this.lip.position.set(lock.x, lock.y + 0.04, lock.z);
      this.lip.scale.setScalar(s);
      (this.lip.material as THREE.MeshBasicMaterial).opacity = 0.55 + s * 0.25;
    } else {
      this.lip.visible = false;
    }

    if (player.grounded || player.state === 'slide') {
      this.land.visible = false;
      return;
    }

    let x = player.x;
    let y = player.y;
    let z = player.z;
    let vx = player.vx;
    let vy = player.vy;
    let vz = player.vz;
    const step = 0.05;
    let hit = false;
    let hy = 0;
    for (let t = 0; t < 0.7; t += step) {
      vy -= GRAVITY * step;
      x += vx * step;
      y += vy * step;
      z += vz * step;
      const roof = world.roofAt(x, z);
      if (roof !== null && y <= roof + 0.35 && vy <= 2) {
        hy = roof;
        hit = true;
        break;
      }
    }
    if (!hit) {
      this.land.visible = false;
      return;
    }
    this.land.visible = true;
    this.land.position.set(x, hy + 0.05, z);
    const dist = Math.hypot(x - player.x, z - player.z);
    const op = THREE.MathUtils.clamp(1.1 - dist * 0.035, 0.16, 0.5);
    (this.land.material as THREE.MeshBasicMaterial).opacity = op;
  }

  setActive(on: boolean): void {
    this.group.visible = on;
    if (!on) {
      this.lip.visible = false;
      this.land.visible = false;
    }
  }
}
