import * as THREE from 'three';

interface SpeedStreak {
  angle: number;
  phase: number;
  speed: number;
  length: number;
  width: number;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export class EffectsSystem {
  readonly group = new THREE.Group();
  private ctx: CanvasRenderingContext2D;
  private streaks: SpeedStreak[] = [];
  private smoothIntensity = 0;
  private flashAlpha = 0;
  private flashColor = '255, 255, 255';
  private time = 0;

  // Ambient sunlit floating motes around the camera
  private motes: THREE.Points;
  private moteOffsets: Float32Array;
  private readonly moteCount = 90;

  // Burst particles (checkpoint flare / slide dust)
  private bursts: BurstParticle[] = [];
  private burstGeo: THREE.BoxGeometry;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();

    for (let i = 0; i < 42; i++) {
      this.streaks.push({
        angle: (i / 42) * Math.PI * 2 + (Math.random() - 0.5) * 0.12,
        phase: Math.random(),
        speed: 1.8 + Math.random() * 1.9,
        length: 0.08 + Math.random() * 0.12,
        width: 1.0 + Math.random() * 1.4,
      });
    }

    // Subtle sunlit dust motes drifting across rooftops
    this.moteOffsets = new Float32Array(this.moteCount * 3);
    for (let i = 0; i < this.moteCount; i++) {
      this.moteOffsets[i * 3] = (Math.random() - 0.5) * 34;
      this.moteOffsets[i * 3 + 1] = (Math.random() - 0.5) * 18;
      this.moteOffsets[i * 3 + 2] = (Math.random() - 0.5) * 34;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.moteOffsets), 3)
    );
    const moteMat = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 0.09,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.motes = new THREE.Points(moteGeo, moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    this.burstGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
  }

  triggerFlash(rgb: string, alpha = 0.16): void {
    this.flashColor = rgb;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  spawnBurst(x: number, y: number, z: number, colorHex: string, count = 14): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.burstGeo, mat);
      mesh.position.set(
        x + (Math.random() - 0.5) * 1.4,
        y + Math.random() * 1.2,
        z + (Math.random() - 0.5) * 1.4
      );
      this.group.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 6.0;
      this.bursts.push({
        mesh,
        vx: Math.cos(a) * spd,
        vy: 2.0 + Math.random() * 5.5,
        vz: Math.sin(a) * spd,
        life: 0,
        maxLife: 0.42 + Math.random() * 0.25,
      });
    }
  }

  update(
    dt: number,
    horizSpeed: number,
    cameraPos: THREE.Vector3,
    isGameplay: boolean
  ): void {
    this.time += dt;

    // Wrap ambient sunlit particles seamlessly around camera position
    const posAttr = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const span = 34;
    const spanY = 18;
    for (let i = 0; i < this.moteCount; i++) {
      const ox = this.moteOffsets[i * 3] + this.time * 0.6;
      const oy = this.moteOffsets[i * 3 + 1] + Math.sin(this.time + i) * 0.4;
      const oz = this.moteOffsets[i * 3 + 2] + this.time * 0.35;

      const wrap = (v: number, center: number, s: number) => {
        const rel = ((((v - center) % s) + s) % s) - s * 0.5;
        return center + rel;
      };
      arr[i * 3] = wrap(ox, cameraPos.x, span);
      arr[i * 3 + 1] = wrap(oy, cameraPos.y, spanY);
      arr[i * 3 + 2] = wrap(oz, cameraPos.z, span);
    }
    posAttr.needsUpdate = true;

    // Update 3D burst particles
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      if (b.life >= b.maxLife) {
        this.group.remove(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      b.vy -= 12 * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      const s = 1 - b.life / b.maxLife;
      b.mesh.scale.setScalar(s);
    }

    // 2D overlay: crisp peripheral speed lines only at high speed (> 15.2 m/s) + subtle screen flash
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    const targetIntensity = isGameplay
      ? Math.max(0, Math.min(1, (horizSpeed - 15.0) / 9.5))
      : 0;
    this.smoothIntensity += (targetIntensity - this.smoothIntensity) * Math.min(1, 9 * dt);

    if (this.smoothIntensity > 0.02) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const maxR = Math.hypot(cx, cy);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.ctx.save();
      this.ctx.lineCap = 'round';
      for (let i = 0; i < this.streaks.length; i++) {
        const st = this.streaks[i];
        st.phase = (st.phase + dt * st.speed * (0.7 + this.smoothIntensity)) % 1;
        // Keep center 62% of screen completely crystal clear!
        const r0 = maxR * (0.64 + st.phase * 0.34);
        const r1 = r0 + maxR * st.length * (0.5 + this.smoothIntensity * 0.8);
        const ca = Math.cos(st.angle);
        const sa = Math.sin(st.angle);
        const alpha =
          Math.sin(st.phase * Math.PI) * this.smoothIntensity * 0.34;
        if (alpha < 0.01) continue;

        this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        this.ctx.lineWidth = st.width * dpr;
        this.ctx.beginPath();
        this.ctx.moveTo(cx + ca * r0, cy + sa * r0);
        this.ctx.lineTo(cx + ca * r1, cy + sa * r1);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

    if (this.flashAlpha > 0.004) {
      this.ctx.fillStyle = `rgba(${this.flashColor}, ${this.flashAlpha.toFixed(3)})`;
      this.ctx.fillRect(0, 0, w, h);
      this.flashAlpha *= Math.max(0, 1 - 7.5 * dt);
    }
  }
}
