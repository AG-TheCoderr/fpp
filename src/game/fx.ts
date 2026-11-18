import * as THREE from 'three';

interface SpeedFilament {
  angle: number;
  phase: number;
  speed: number;
  length: number;
  width: number;
}

interface BurstParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  cr: number;
  cg: number;
  cb: number;
  alive: boolean;
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
  private canvasDirty = true;

  // Ambient sunlit floating motes around camera
  private motes: THREE.Points;
  private moteOffsets: Float32Array;
  private readonly moteCount = 85;

  private readonly poolSize = 160;
  private bursts: BurstParticle[] = [];
  private burstMesh: THREE.InstancedMesh;
  private burstDummy = new THREE.Object3D();
  private burstColor = new THREE.Color();

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

    const burstGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const burstMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, this.poolSize);
    this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.burstMesh.frustumCulled = false;
    this.burstMesh.count = 0;
    this.group.add(this.burstMesh);
    for (let i = 0; i < this.poolSize; i++) {
      this.bursts.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        cr: 1,
        cg: 1,
        cb: 1,
        alive: false,
      });
    }
  }

  private parseColor(hex: string): [number, number, number] {
    const c = this.burstColor.set(hex);
    return [c.r, c.g, c.b];
  }

  private spawnOne(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    hex: string
  ): void {
    for (let i = 0; i < this.poolSize; i++) {
      const p = this.bursts[i];
      if (p.alive) continue;
      const [r, g, b] = this.parseColor(hex);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.life = 0;
      p.maxLife = maxLife;
      p.cr = r;
      p.cg = g;
      p.cb = b;
      return;
    }
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
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2.0 + Math.random() * 5.2;
      this.spawnOne(
        x + (Math.random() - 0.5) * 1.1,
        y + Math.random() * 0.9,
        z + (Math.random() - 0.5) * 1.1,
        Math.cos(a) * spd,
        1.6 + Math.random() * 4.5,
        Math.sin(a) * spd,
        0.36 + Math.random() * 0.22,
        colorHex
      );
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
    while (this.slideDustAccum >= 1) {
      this.slideDustAccum -= 1;
      this.spawnOne(
        x + (Math.random() - 0.5) * 0.55,
        y + 0.06 + Math.random() * 0.1,
        z + (Math.random() - 0.5) * 0.55,
        -vx * 0.12 + (Math.random() - 0.5) * 2.2,
        0.9 + Math.random() * 1.8,
        -vz * 0.12 + (Math.random() - 0.5) * 2.2,
        0.22 + Math.random() * 0.14,
        '#e6ebf0'
      );
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

    let vis = 0;
    const dummy = this.burstDummy;
    for (let i = 0; i < this.poolSize; i++) {
      const b = this.bursts[i];
      if (!b.alive) continue;
      b.life += dt;
      if (b.life >= b.maxLife) {
        b.alive = false;
        continue;
      }
      b.vy -= 11 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const s = 1 - b.life / b.maxLife;
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.burstMesh.setMatrixAt(vis, dummy.matrix);
      this.burstColor.setRGB(b.cr, b.cg, b.cb);
      this.burstMesh.setColorAt(vis, this.burstColor);
      vis++;
    }
    this.burstMesh.count = vis;
    this.burstMesh.visible = vis > 0;
    if (vis > 0) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
      if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const targetIntensity = isGameplay
      ? Math.max(0, Math.min(1, (totalSpeed - 16.2) / 9.5))
      : 0;
    this.smoothIntensity += (targetIntensity - this.smoothIntensity) * Math.min(1, 8 * dt);
    const needCanvas = this.smoothIntensity > 0.015 || this.flashAlpha > 0.004;
    if (!needCanvas && !this.canvasDirty) {
      return;
    }
    this.ctx.clearRect(0, 0, w, h);
    this.canvasDirty = needCanvas;

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
