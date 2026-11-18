import * as THREE from 'three';

interface SpeedFilament {
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
  private filaments: SpeedFilament[] = [];
  private smoothIntensity = 0;
  private flashAlpha = 0;
  private flashColor = '255, 255, 255';
  private time = 0;
  private slideDustAccum = 0;

  // Ambient sunlit floating motes around camera
  private motes: THREE.Points;
  private moteOffsets: Float32Array;
  private readonly moteCount = 85;

  // Reusable burst materials & geometry (zero GPU allocations in gameplay)
  private bursts: BurstParticle[] = [];
  private burstGeo: THREE.BoxGeometry;
  private matCache = new Map<string, THREE.MeshBasicMaterial>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();

    // Subtle, minor peripheral wind filaments (understated & atmospheric, never loud anime lines)
    const count = 24;
    for (let i = 0; i < count; i++) {
      this.filaments.push({
        angle: (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.18,
        phase: Math.random(),
        speed: 1.5 + Math.random() * 1.4,
        length: 0.045 + Math.random() * 0.065,
        width: 0.55 + Math.random() * 0.55,
      });
    }

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
      size: 0.085,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.motes = new THREE.Points(moteGeo, moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    this.burstGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  private getBurstMat(colorHex: string): THREE.MeshBasicMaterial {
    let m = this.matCache.get(colorHex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.78,
      });
      this.matCache.set(colorHex, m);
    }
    return m;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
  }

  triggerFlash(rgb: string, alpha = 0.14): void {
    this.flashColor = rgb;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  spawnBurst(x: number, y: number, z: number, colorHex: string, count = 12): void {
    const mat = this.getBurstMat(colorHex);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.burstGeo, mat);
      mesh.position.set(
        x + (Math.random() - 0.5) * 1.1,
        y + Math.random() * 0.9,
        z + (Math.random() - 0.5) * 1.1
      );
      this.group.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const spd = 2.0 + Math.random() * 5.2;
      this.bursts.push({
        mesh,
        vx: Math.cos(a) * spd,
        vy: 1.6 + Math.random() * 4.5,
        vz: Math.sin(a) * spd,
        life: 0,
        maxLife: 0.36 + Math.random() * 0.22,
      });
    }
  }

  emitSlideGrit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    extraIntensity: number,
    dt: number
  ): void {
    const rate = 18 + extraIntensity * 22;
    this.slideDustAccum += dt * rate;
    const mat = this.getBurstMat('#e6ebf0');
    while (this.slideDustAccum >= 1) {
      this.slideDustAccum -= 1;
      const mesh = new THREE.Mesh(this.burstGeo, mat);
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.55,
        y + 0.06 + Math.random() * 0.1,
        z + (Math.random() - 0.5) * 0.55
      );
      this.group.add(mesh);
      this.bursts.push({
        mesh,
        vx: -vx * 0.12 + (Math.random() - 0.5) * 2.2,
        vy: 0.9 + Math.random() * 1.8,
        vz: -vz * 0.12 + (Math.random() - 0.5) * 2.2,
        life: 0,
        maxLife: 0.22 + Math.random() * 0.14,
      });
    }
  }

  update(
    dt: number,
    totalSpeed: number,
    cameraPos: THREE.Vector3,
    isGameplay: boolean
  ): void {
    this.time += dt;

    // Wrap ambient sunlit rooftop motes around camera
    const posAttr = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const span = 34;
    const spanY = 18;
    const wrap = (v: number, center: number, s: number) => {
      const rel = ((((v - center) % s) + s) % s) - s * 0.5;
      return center + rel;
    };
    for (let i = 0; i < this.moteCount; i++) {
      arr[i * 3] = wrap(this.moteOffsets[i * 3] + this.time * 0.6, cameraPos.x, span);
      arr[i * 3 + 1] = wrap(
        this.moteOffsets[i * 3 + 1] + Math.sin(this.time + i) * 0.4,
        cameraPos.y,
        spanY
      );
      arr[i * 3 + 2] = wrap(this.moteOffsets[i * 3 + 2] + this.time * 0.35, cameraPos.z, span);
    }
    posAttr.needsUpdate = true;

    // Update 3D burst/dust particles
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      if (b.life >= b.maxLife) {
        this.group.remove(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      b.vy -= 11 * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.scale.setScalar(1 - b.life / b.maxLife);
    }

    // 2D overlay: minor, delicate peripheral wind filaments ONLY at high velocity (> 16.2 m/s)
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    const targetIntensity = isGameplay
      ? Math.max(0, Math.min(1, (totalSpeed - 16.2) / 9.5))
      : 0;
    this.smoothIntensity += (targetIntensity - this.smoothIntensity) * Math.min(1, 8 * dt);

    if (this.smoothIntensity > 0.015) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const rx = cx;
      const ry = cy;
      const diag = Math.hypot(cx, cy);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.ctx.save();
      this.ctx.lineCap = 'round';
      for (let i = 0; i < this.filaments.length; i++) {
        const f = this.filaments[i];
        f.phase = (f.phase + dt * f.speed * (0.75 + this.smoothIntensity * 0.85)) % 1;

        // Strictly outer 22% periphery so screen stays clean, natural, and uncluttered
        const rStart = 0.78 + f.phase * 0.24;
        const rEnd = rStart + f.length * (0.65 + this.smoothIntensity * 0.65);
        const ca = Math.cos(f.angle);
        const sa = Math.sin(f.angle);

        const alpha = Math.sin(f.phase * Math.PI) * this.smoothIntensity * 0.135;
        if (alpha < 0.008) continue;

        this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        this.ctx.lineWidth = f.width * dpr;
        this.ctx.beginPath();
        this.ctx.moveTo(cx + ca * rx * rStart, cy + sa * ry * rStart + ca * diag * 0.0);
        this.ctx.lineTo(cx + ca * rx * rEnd, cy + sa * ry * rEnd);
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
