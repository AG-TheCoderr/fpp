import * as THREE from 'three';
import {
  BoxDef,
  CheckpointDef,
  CourseDef,
  FinishDef,
  GrappleDef,
  LaunchPadDef,
  RampDef,
  RampDir,
} from '../types';
import {
  MaterialLibrary,
  createRampGeometry,
  createWorldBoxGeometry,
} from './materials';

interface AnimatedFan {
  mesh: THREE.Object3D;
  speed: number;
}

interface AnimatedRing {
  mesh: THREE.Mesh;
  baseY: number;
  phase: number;
}

interface AnimatedGrapple {
  id: string;
  ring: THREE.Mesh;
  core: THREE.Mesh;
  baseScale: number;
}

interface AnimatedBanner {
  mesh: THREE.Mesh;
  basePositions: Float32Array;
  phase: number;
}

interface CheckpointVisual {
  index: number;
  ribbon: THREE.Mesh;
  hit: boolean;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class BuiltCourse {
  readonly group = new THREE.Group();
  private disposables: THREE.BufferGeometry[] = [];
  private matDisposables: THREE.Material[] = [];
  private fans: AnimatedFan[] = [];
  private launchRings: AnimatedRing[] = [];
  private grapples: AnimatedGrapple[] = [];
  private banners: AnimatedBanner[] = [];
  private checkpoints: CheckpointVisual[] = [];
  private time = 0;

  constructor(course: CourseDef, private mats: MaterialLibrary) {
    this.buildCourse(course);
    this.buildSkyline(course);
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.disposables.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.matDisposables.push(mat);
    return mat;
  }

  private buildCourse(course: CourseDef): void {
    const rand = seededRand(course.id.charCodeAt(0) * 997 + course.boxes.length * 31);

    for (const b of course.boxes) {
      this.buildBox(b, rand);
    }
    for (const r of course.ramps) {
      this.buildRamp(r);
    }
    for (const lp of course.launchPads) {
      this.buildLaunchPad(lp);
    }
    for (const g of course.grapples) {
      this.buildGrapple(g);
    }
    for (const cp of course.checkpoints) {
      this.buildCheckpoint(cp);
    }
    this.buildFinish(course.finish);
  }

  private buildBox(b: BoxDef, rand: () => number): void {
    const cy = b.y + b.h * 0.5;
    const topY = b.y + b.h;

    switch (b.style) {
      case 'rooftop': {
        // 1. Crisp white brutalist roof coping slab (exact collision footprint)
        const roofMats = [
          this.mats.whiteConcrete,
          this.mats.whiteConcrete,
          this.mats.roofTop,
          this.mats.darkConcrete,
          this.mats.whiteConcrete,
          this.mats.whiteConcrete,
        ];
        const slabGeo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 4, 4));
        const slab = new THREE.Mesh(slabGeo, roofMats);
        slab.position.set(b.x, cy, b.z);
        slab.castShadow = true;
        slab.receiveShadow = true;
        this.group.add(slab);

        // 2. Towering glass-and-concrete skyscraper shaft dropping 140m into the daylight haze!
        const shaftH = 140;
        const inset = 0.35;
        const sw = Math.max(2, b.w - inset * 2);
        const sd = Math.max(2, b.d - inset * 2);
        const shaftGeo = this.trackGeo(createWorldBoxGeometry(sw, shaftH, sd, 16, 14));
        const shaft = new THREE.Mesh(shaftGeo, this.mats.glassFacade);
        shaft.position.set(b.x, b.y - shaftH * 0.5, b.z);
        shaft.receiveShadow = true;
        this.group.add(shaft);

        // 3. Four crisp white corner structural pilasters grounding the brutalist look
        const pilGeo = this.trackGeo(new THREE.BoxGeometry(0.9, shaftH, 0.9));
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const pil = new THREE.Mesh(pilGeo, this.mats.whiteConcrete);
            pil.position.set(
              b.x + sx * (b.w * 0.5 - 0.38),
              b.y - shaftH * 0.5,
              b.z + sz * (b.d * 0.5 - 0.38)
            );
            this.group.add(pil);
          }
        }

        // 4. Optional subtle runner track guide painted along center of walkable deck
        if (b.guideDir && !b.noCollide) {
          this.addRunnerGuide(b.x, topY, b.z, b.w, b.d, b.guideDir);
          // Subtle red edge strip on the TAKEOFF edge so rooftop lips read with 100% clarity!
          this.addTakeoffEdgeTrim(b.x, topY, b.z, b.w, b.d, b.guideDir);
        }

        // 5. Optional brutalist sector stencil stamped flat on the roof deck
        if (b.label) {
          const stTex = this.mats.makeStencilTexture(b.label);
          const stMat = this.trackMat(
            new THREE.MeshBasicMaterial({
              map: stTex,
              transparent: true,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            })
          );
          const stGeo = this.trackGeo(new THREE.PlaneGeometry(4.4, 2.2));
          const stMesh = new THREE.Mesh(stGeo, stMat);
          stMesh.rotation.x = -Math.PI * 0.5;
          if (b.guideDir === '+x') stMesh.rotation.z = -Math.PI * 0.5;
          else if (b.guideDir === '-x') stMesh.rotation.z = Math.PI * 0.5;
          const offX =
            b.guideDir === '+x' || b.guideDir === '-x' ? 0 : -Math.min(4.2, b.w * 0.3);
          const offZ =
            b.guideDir === '+x' || b.guideDir === '-x' ? Math.min(4.2, b.d * 0.3) : 0;
          stMesh.position.set(b.x + offX, topY + 0.018, b.z + offZ);
          this.group.add(stMesh);
        }

        // 6. Non-colliding decorative rooftop HVAC condensers & vents on far outer corners
        if (!b.cleanRoof && !b.noCollide && b.w >= 14 && b.d >= 16) {
          this.addRooftopEdgeProps(b, rand);
        } else if (b.noCollide && b.w >= 12) {
          // Flanking skyscrapers get tall rooftop comms antennas & penthouse mechanical boxes!
          this.addFlankTowerTop(b, rand);
        }
        break;
      }

      case 'deck': {
        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 3, 3));
        const mats = [
          this.mats.darkSteel,
          this.mats.darkSteel,
          this.mats.roofTop,
          this.mats.darkSteel,
          this.mats.darkSteel,
          this.mats.darkSteel,
        ];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Under-slung steel girder beams + red edge accents
        const girderGeo = this.trackGeo(new THREE.BoxGeometry(b.w * 0.92, 0.7, 0.35));
        for (const sz of [-1, 1]) {
          const g = new THREE.Mesh(girderGeo, this.mats.darkSteel);
          g.position.set(b.x, b.y - 0.35, b.z + sz * (b.d * 0.38));
          this.group.add(g);
        }
        if (b.guideDir) {
          this.addRunnerGuide(b.x, topY, b.z, b.w, b.d, b.guideDir);
          this.addTakeoffEdgeTrim(b.x, topY, b.z, b.w, b.d, b.guideDir);
        }
        break;
      }

      case 'catwalk': {
        const geo = this.trackGeo(new THREE.BoxGeometry(b.w, b.h, b.d));
        const mesh = new THREE.Mesh(geo, this.mats.catwalk);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Crisp white center speed stripe on catwalk
        const stripeGeo = this.trackGeo(
          new THREE.PlaneGeometry(
            b.guideDir === '+x' || b.guideDir === '-x' ? b.w - 0.4 : 0.22,
            b.guideDir === '+x' || b.guideDir === '-x' ? 0.22 : b.d - 0.4
          )
        );
        const stripe = new THREE.Mesh(
          stripeGeo,
          this.trackMat(new THREE.MeshBasicMaterial({ color: '#ffffff' }))
        );
        stripe.rotation.x = -Math.PI * 0.5;
        stripe.position.set(b.x, topY + 0.01, b.z);
        this.group.add(stripe);

        // Slim steel support legs below catwalk (non-colliding, positioned directly under catwalk)
        const legH = 1.9;
        const legGeo = this.trackGeo(new THREE.BoxGeometry(0.18, legH, 0.18));
        for (const s of [-0.42, 0, 0.42]) {
          const leg = new THREE.Mesh(legGeo, this.mats.darkSteel);
          const lx = b.w > b.d ? b.x + b.w * s : b.x;
          const lz = b.d >= b.w ? b.z + b.d * s : b.z;
          leg.position.set(lx, b.y - legH * 0.5, lz);
          this.group.add(leg);
        }
        break;
      }

      case 'vault': {
        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 2, 1.1));
        const mesh = new THREE.Mesh(geo, this.mats.runnerRed);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Sleek dark rubberized base plinth + crisp white top grip cap
        const capGeo = this.trackGeo(new THREE.BoxGeometry(b.w + 0.04, 0.07, b.d + 0.04));
        const cap = new THREE.Mesh(capGeo, this.mats.whiteConcrete);
        cap.position.set(b.x, topY - 0.035, b.z);
        this.group.add(cap);

        if (b.h > 0.5) {
          const baseGeo = this.trackGeo(new THREE.BoxGeometry(b.w + 0.06, 0.12, b.d + 0.06));
          const base = new THREE.Mesh(baseGeo, this.mats.darkSteel);
          base.position.set(b.x, b.y + 0.06, b.z);
          this.group.add(base);
        }
        break;
      }

      case 'slide': {
        // Overhead industrial duct barrier with high-vis red/white diagonal lower bumper
        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 4, b.h));
        const mats = [
          this.mats.slideHazard,
          this.mats.slideHazard,
          this.mats.brushedMetal,
          this.mats.runnerRed, // Bright signal-red underside makes slide gap unmistakable!
          this.mats.slideHazard,
          this.mats.slideHazard,
        ];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Twin heavy dark-steel support stanchions at the extreme LEFT/RIGHT ends of the barrier
        const spanAlongX = b.w >= b.d;
        const legH = 1.24;
        const legGeo = this.trackGeo(new THREE.BoxGeometry(0.28, legH, 0.28));
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(legGeo, this.mats.darkSteel);
          if (spanAlongX) {
            leg.position.set(b.x + side * (b.w * 0.5 - 0.16), b.y - legH * 0.5, b.z);
          } else {
            leg.position.set(b.x, b.y - legH * 0.5, b.z + side * (b.d * 0.5 - 0.16));
          }
          leg.castShadow = true;
          this.group.add(leg);
        }
        break;
      }

      case 'wallrun': {
        // Selective face materials: active runner side(s) are bold signal-red, backing is dark steel/concrete
        const f = b.wallFace ?? 'both-x';
        const pxMat =
          f === '+x' || f === 'both-x' ? this.mats.wallRunRed : this.mats.darkConcrete;
        const nxMat =
          f === '-x' || f === 'both-x' ? this.mats.wallRunRed : this.mats.darkConcrete;
        const pzMat =
          f === '+z' || f === 'both-z' ? this.mats.wallRunRed : this.mats.darkConcrete;
        const nzMat =
          f === '-z' || f === 'both-z' ? this.mats.wallRunRed : this.mats.darkConcrete;

        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 5, b.h));
        const mesh = new THREE.Mesh(geo, [
          pxMat,
          nxMat,
          this.mats.darkSteel,
          this.mats.darkSteel,
          pzMat,
          nzMat,
        ]);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Top & bottom crisp steel frame rails along the wall-run billboard
        const frameGeo = this.trackGeo(new THREE.BoxGeometry(b.w + 0.12, 0.2, b.d + 0.12));
        const topFrame = new THREE.Mesh(frameGeo, this.mats.darkSteel);
        topFrame.position.set(b.x, topY + 0.1, b.z);
        const botFrame = new THREE.Mesh(frameGeo, this.mats.darkSteel);
        botFrame.position.set(b.x, b.y - 0.1, b.z);
        this.group.add(topFrame, botFrame);
        break;
      }

      case 'dark':
      case 'pillar': {
        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 3, 3));
        const mesh = new THREE.Mesh(geo, this.mats.darkConcrete);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // High-visibility Mirror's Edge directional turn chevrons on corner backstop walls!
        if (b.guideDir === '+x' || b.guideDir === '-x') {
          const signGeo = this.trackGeo(new THREE.PlaneGeometry(2.6, 7.2));
          const sign = new THREE.Mesh(signGeo, this.mats.runnerChevron);
          // runnerChevron UV +V points along local +Y; rotate -PI/2 for +X (right), +PI/2 for -X (left)
          sign.rotation.z = b.guideDir === '+x' ? -Math.PI * 0.5 : Math.PI * 0.5;
          sign.position.set(b.x, b.y + b.h * 0.54, b.z + b.d * 0.5 + 0.04);
          this.group.add(sign);
        }
        break;
      }

      case 'concrete':
      default: {
        const geo = this.trackGeo(createWorldBoxGeometry(b.w, b.h, b.d, 4, 4));
        const mats = [
          this.mats.whiteConcrete,
          this.mats.whiteConcrete,
          this.mats.roofTop,
          this.mats.darkConcrete,
          this.mats.whiteConcrete,
          this.mats.whiteConcrete,
        ];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(b.x, cy, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Highlight mantle-height step lips with a crisp red coping edge!
        if (b.guideDir) {
          this.addRunnerGuide(b.x, topY, b.z, b.w, b.d, b.guideDir);
          if (b.h >= 1.2 && b.h <= 2.2) {
            const lipGeo = this.trackGeo(
              new THREE.BoxGeometry(
                b.guideDir === '+x' || b.guideDir === '-x' ? 0.22 : Math.min(b.w, 10),
                0.18,
                b.guideDir === '+x' || b.guideDir === '-x' ? Math.min(b.d, 10) : 0.22
              )
            );
            const lip = new THREE.Mesh(lipGeo, this.mats.runnerRed);
            let lx = b.x;
            let lz = b.z;
            // Approach lip is on opposite side of guideDir
            if (b.guideDir === '-z') lz = b.z + b.d * 0.5 - 0.08;
            else if (b.guideDir === '+z') lz = b.z - b.d * 0.5 + 0.08;
            else if (b.guideDir === '+x') lx = b.x - b.w * 0.5 + 0.08;
            else lx = b.x + b.w * 0.5 - 0.08;
            lip.position.set(lx, topY - 0.07, lz);
            this.group.add(lip);
          }
        }
        break;
      }
    }
  }

  private addRunnerGuide(
    x: number,
    topY: number,
    z: number,
    w: number,
    d: number,
    dir: RampDir
  ): void {
    const alongX = dir === '+x' || dir === '-x';
    const len = Math.max(2, (alongX ? w : d) - 2.4);
    const trackW = 2.6;
    const geo = this.trackGeo(new THREE.PlaneGeometry(trackW, len));
    // Repeat UVs cleanly along track length
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const reps = Math.max(1, Math.round(len / 7.5));
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, uv.getY(i) * reps);
    }
    uv.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, this.mats.runnerGuide);
    mesh.rotation.x = -Math.PI * 0.5;
    // Default PlaneGeometry rotated -PI/2 around X has +V pointing toward -Z!
    if (dir === '+z') mesh.rotation.z = Math.PI;
    else if (dir === '+x') mesh.rotation.z = -Math.PI * 0.5;
    else if (dir === '-x') mesh.rotation.z = Math.PI * 0.5;

    mesh.position.set(x, topY + 0.012, z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addTakeoffEdgeTrim(
    x: number,
    topY: number,
    z: number,
    w: number,
    d: number,
    dir: RampDir
  ): void {
    const alongX = dir === '+x' || dir === '-x';
    const span = Math.min(alongX ? d : w, 12);
    const geo = this.trackGeo(
      new THREE.BoxGeometry(alongX ? 0.38 : span, 0.12, alongX ? span : 0.38)
    );
    const trim = new THREE.Mesh(geo, this.mats.runnerRed);
    let tx = x;
    let tz = z;
    if (dir === '-z') tz = z - d * 0.5 + 0.2;
    else if (dir === '+z') tz = z + d * 0.5 - 0.2;
    else if (dir === '+x') tx = x + w * 0.5 - 0.2;
    else tx = x - w * 0.5 + 0.2;
    trim.position.set(tx, topY - 0.04, tz);
    this.group.add(trim);
  }

  private addRooftopEdgeProps(b: BoxDef, rand: () => number): void {
    const topY = b.y + b.h;
    const alongX = b.guideDir === '+x' || b.guideDir === '-x';

    // Place sleek HVAC condenser units with spinning fans along the far lateral margins
    const numProps = rand() > 0.45 ? 2 : 1;
    for (let i = 0; i < numProps; i++) {
      const side = i === 0 ? -1 : 1;
      // Avoid right side where catwalk shortcuts sometimes run; keep tight to edge
      const px = alongX
        ? b.x + (rand() - 0.5) * (b.w * 0.45)
        : b.x + side * (b.w * 0.5 - 1.15);
      const pz = alongX
        ? b.z + side * (b.d * 0.5 - 1.15)
        : b.z + (rand() - 0.5) * (b.d * 0.45);

      const hvac = new THREE.Group();
      const bodyGeo = this.trackGeo(new THREE.BoxGeometry(1.5, 1.1, 1.5));
      const body = new THREE.Mesh(bodyGeo, this.mats.brushedMetal);
      body.position.y = 0.55;
      body.castShadow = true;
      body.receiveShadow = true;
      hvac.add(body);

      // Dark fan shroud + rotating fan cross
      const rimGeo = this.trackGeo(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 12));
      const rim = new THREE.Mesh(rimGeo, this.mats.darkSteel);
      rim.position.y = 1.12;
      hvac.add(rim);

      const fanGroup = new THREE.Group();
      fanGroup.position.y = 1.14;
      const bladeGeo = this.trackGeo(new THREE.BoxGeometry(0.88, 0.03, 0.14));
      const b1 = new THREE.Mesh(bladeGeo, this.mats.whiteConcrete);
      const b2 = new THREE.Mesh(bladeGeo, this.mats.whiteConcrete);
      b2.rotation.y = Math.PI * 0.5;
      fanGroup.add(b1, b2);
      hvac.add(fanGroup);
      this.fans.push({ mesh: fanGroup, speed: 4.5 + rand() * 3.0 });

      hvac.position.set(px, topY, pz);
      this.group.add(hvac);
    }

    // Thin modern steel safety railing segments on lateral edges only (never takeoff/landing edges!)
    const railSpan = (alongX ? b.w : b.d) * 0.55;
    if (railSpan > 8) {
      const barGeo = this.trackGeo(
        new THREE.BoxGeometry(alongX ? railSpan : 0.06, 0.06, alongX ? 0.06 : railSpan)
      );
      const side = -1;
      const rx = alongX ? b.x : b.x + side * (b.w * 0.5 - 0.15);
      const rz = alongX ? b.z + side * (b.d * 0.5 - 0.15) : b.z;
      const topBar = new THREE.Mesh(barGeo, this.mats.brushedMetal);
      topBar.position.set(rx, topY + 0.95, rz);
      const midBar = new THREE.Mesh(barGeo, this.mats.brushedMetal);
      midBar.position.set(rx, topY + 0.5, rz);
      this.group.add(topBar, midBar);
    }
  }

  private addFlankTowerTop(b: BoxDef, rand: () => number): void {
    const topY = b.y + b.h;
    const pentGeo = this.trackGeo(
      createWorldBoxGeometry(b.w * 0.55, 3.2, b.d * 0.5, 4, 3.2)
    );
    const pent = new THREE.Mesh(pentGeo, this.mats.whiteConcrete);
    pent.position.set(b.x, topY + 1.6, b.z);
    pent.castShadow = true;
    pent.receiveShadow = true;
    this.group.add(pent);

    // Sleek rooftop radio mast
    const mastH = 7 + rand() * 8;
    const mastGeo = this.trackGeo(new THREE.CylinderGeometry(0.06, 0.14, mastH, 6));
    const mast = new THREE.Mesh(mastGeo, this.mats.darkSteel);
    mast.position.set(b.x + 1.5, topY + 3.2 + mastH * 0.5, b.z - 1.5);
    this.group.add(mast);
  }

  private buildRamp(r: RampDef): void {
    const isRed = r.style === 'rampRed';
    const geo = this.trackGeo(createRampGeometry(r.w, r.h, r.d, r.dir, isRed));
    const mesh = new THREE.Mesh(
      geo,
      isRed ? this.mats.runnerChevron : this.mats.slideChute
    );
    mesh.position.set(r.x, r.y, r.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Add sleek dark steel side curbs on downhill concrete slide chutes
    if (!isRed) {
      const alongX = r.dir === '+x' || r.dir === '-x';
      const run = alongX ? r.w : r.d;
      const hyp = Math.hypot(run, r.h);
      const angle = Math.atan2(r.h, run);
      const curbGeo = this.trackGeo(
        new THREE.BoxGeometry(alongX ? hyp : 0.24, 0.28, alongX ? 0.24 : hyp)
      );
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(curbGeo, this.mats.darkSteel);
        const cx = alongX ? r.x : r.x + side * (r.w * 0.5 + 0.1);
        const cz = alongX ? r.z + side * (r.d * 0.5 + 0.1) : r.z;
        curb.position.set(cx, r.y + r.h * 0.5 + 0.08, cz);
        if (r.dir === '+x') curb.rotation.z = angle;
        else if (r.dir === '-x') curb.rotation.z = -angle;
        else if (r.dir === '+z') curb.rotation.x = -angle;
        else curb.rotation.x = angle;
        this.group.add(curb);
      }
    }
  }

  private buildLaunchPad(lp: LaunchPadDef): void {
    const w = lp.w ?? 3.4;
    const d = lp.d ?? 3.4;
    const g = new THREE.Group();
    g.position.set(lp.x, lp.y, lp.z);

    // Industrial steel turbine cowling
    const baseGeo = this.trackGeo(new THREE.BoxGeometry(w, 0.26, d));
    const base = new THREE.Mesh(baseGeo, this.mats.darkSteel);
    base.position.y = 0.13;
    base.receiveShadow = true;
    g.add(base);

    // Spinning high-speed turbine rotor
    const radius = Math.min(w, d) * 0.39;
    const rotor = new THREE.Group();
    rotor.position.y = 0.27;
    const bladeGeo = this.trackGeo(new THREE.BoxGeometry(radius * 1.85, 0.04, 0.24));
    for (let i = 0; i < 3; i++) {
      const bl = new THREE.Mesh(bladeGeo, this.mats.brushedMetal);
      bl.rotation.y = (i * Math.PI) / 3;
      rotor.add(bl);
    }
    g.add(rotor);
    this.fans.push({ mesh: rotor, speed: 15.0 });

    // Glowing cyan updraft ring rim + 3 animated rising wind halo rings!
    const rimGeo = this.trackGeo(new THREE.RingGeometry(radius * 0.92, radius * 1.08, 24));
    const rim = new THREE.Mesh(rimGeo, this.mats.launchCyan);
    rim.rotation.x = -Math.PI * 0.5;
    rim.position.y = 0.29;
    g.add(rim);

    const haloGeo = this.trackGeo(new THREE.RingGeometry(radius * 0.85, radius * 0.94, 24));
    for (let i = 0; i < 3; i++) {
      const mat = this.trackMat(this.mats.launchCyan.clone());
      mat.depthWrite = false;
      const ring = new THREE.Mesh(haloGeo, mat);
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.y = 0.4 + i * 0.9;
      g.add(ring);
      this.launchRings.push({
        mesh: ring,
        baseY: 0.35,
        phase: i / 3,
      });
    }

    this.group.add(g);
  }

  private buildGrapple(gr: GrappleDef): void {
    const g = new THREE.Group();
    g.position.set(gr.x, gr.y, gr.z);

    // High-visibility signal-amber skyhook assembly
    const outerRingGeo = this.trackGeo(new THREE.TorusGeometry(0.95, 0.14, 10, 24));
    const ring = new THREE.Mesh(outerRingGeo, this.mats.grappleAmber);
    g.add(ring);

    const coreGeo = this.trackGeo(new THREE.OctahedronGeometry(0.42, 0));
    const core = new THREE.Mesh(coreGeo, this.mats.grappleGlow);
    g.add(core);

    // Vertical suspension hoist cable up to cantilevered tower crane jib!
    const cableH = 4.2;
    const cableGeo = this.trackGeo(new THREE.CylinderGeometry(0.06, 0.06, cableH, 6));
    const cable = new THREE.Mesh(cableGeo, this.mats.darkSteel);
    cable.position.y = cableH * 0.5 + 0.5;
    g.add(cable);

    const mount = gr.mountSide ?? '+x';
    if (mount === 'arch') {
      // Overhead brutalist crane gantry spanning high across the gap
      const beamGeo = this.trackGeo(new THREE.BoxGeometry(28, 0.85, 0.85));
      const beam = new THREE.Mesh(beamGeo, this.mats.grappleAmber);
      beam.position.y = cableH + 0.7;
      beam.castShadow = true;
      g.add(beam);

      const mastGeo = this.trackGeo(new THREE.BoxGeometry(1.1, 130, 1.1));
      for (const sx of [-13.5, 13.5]) {
        const m = new THREE.Mesh(mastGeo, this.mats.darkSteel);
        m.position.set(sx, cableH - 64, 0);
        g.add(m);
      }
    } else {
      // Cantilevered construction crane boom extending out from the side!
      const boomLen = 20;
      const alongX = mount === '+x' || mount === '-x';
      const sign = mount === '+x' || mount === '+z' ? 1 : -1;
      const boomGeo = this.trackGeo(
        new THREE.BoxGeometry(alongX ? boomLen : 0.75, 0.75, alongX ? 0.75 : boomLen)
      );
      const boom = new THREE.Mesh(boomGeo, this.mats.grappleAmber);
      boom.position.set(
        alongX ? sign * (boomLen * 0.5 - 1.5) : 0,
        cableH + 0.7,
        alongX ? 0 : sign * (boomLen * 0.5 - 1.5)
      );
      boom.castShadow = true;
      g.add(boom);

      // Vertical crane tower mast dropping into the city canyon at far end of boom
      const mastGeo = this.trackGeo(new THREE.BoxGeometry(1.4, 135, 1.4));
      const mast = new THREE.Mesh(mastGeo, this.mats.darkSteel);
      mast.position.set(
        alongX ? sign * (boomLen - 2.2) : 0,
        cableH - 62,
        alongX ? 0 : sign * (boomLen - 2.2)
      );
      g.add(mast);
    }

    this.group.add(g);
    this.grapples.push({ id: gr.id, ring, core, baseScale: 1.0 });
  }

  private buildCheckpoint(cp: CheckpointDef): void {
    const g = new THREE.Group();
    g.position.set(cp.x, cp.y, cp.z);
    if (cp.axis === 'x') {
      g.rotation.y = Math.PI * 0.5;
    }

    const span = cp.axis === 'x' ? cp.d : cp.w;
    const halfSpan = span * 0.5 - 0.5;
    const pylonH = 5.4;

    // Sleek twin white/steel brutalist checkpoint pylons
    const pylonGeo = this.trackGeo(new THREE.BoxGeometry(0.42, pylonH, 0.42));
    const capGeo = this.trackGeo(new THREE.BoxGeometry(0.54, 0.45, 0.54));
    for (const sx of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, this.mats.whiteConcrete);
      pylon.position.set(sx * halfSpan, pylonH * 0.5, 0);
      pylon.castShadow = true;
      g.add(pylon);

      const cap = new THREE.Mesh(capGeo, this.mats.finishBanner);
      cap.position.set(sx * halfSpan, pylonH + 0.2, 0);
      g.add(cap);
    }

    // Translucent emerald threshold ribbon across ankle/waist level
    const ribbonGeo = this.trackGeo(new THREE.PlaneGeometry(halfSpan * 2 - 0.4, 1.1));
    const ribbon = new THREE.Mesh(ribbonGeo, this.mats.checkpointIdle);
    ribbon.position.set(0, 0.85, 0);
    g.add(ribbon);

    this.checkpoints.push({ index: cp.index, ribbon, hit: false });
    this.group.add(g);
  }

  private buildFinish(f: FinishDef): void {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    if (f.axis === 'x') {
      g.rotation.y = Math.PI * 0.5;
    }

    const span = f.axis === 'x' ? f.d : f.w;
    const halfSpan = span * 0.5 - 0.4;
    const archH = 8.6;

    // Monumental twin brutalist finish pylons + top lintel arch
    const colGeo = this.trackGeo(new THREE.BoxGeometry(0.95, archH, 1.1));
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(colGeo, this.mats.darkSteel);
      col.position.set(sx * halfSpan, archH * 0.5, 0);
      col.castShadow = true;
      g.add(col);

      // Tall fluttering emerald/white runner banners hanging inside the arch!
      const banGeo = this.trackGeo(new THREE.PlaneGeometry(1.15, 5.4, 2, 12));
      const basePos = new Float32Array(
        (banGeo.attributes.position as THREE.BufferAttribute).array
      );
      const ban = new THREE.Mesh(banGeo, this.mats.finishBanner);
      ban.position.set(sx * (halfSpan - 1.15), archH - 3.3, 0);
      ban.castShadow = true;
      g.add(ban);
      this.banners.push({ mesh: ban, basePositions: basePos, phase: sx * 1.1 });
    }

    const topGeo = this.trackGeo(new THREE.BoxGeometry(halfSpan * 2 + 2.2, 1.1, 1.4));
    const topBeam = new THREE.Mesh(topGeo, this.mats.whiteConcrete);
    topBeam.position.set(0, archH + 0.5, 0);
    topBeam.castShadow = true;
    g.add(topBeam);

    // Emerald energy threshold curtain + towering sky beacon visible from spawn!
    const gateGeo = this.trackGeo(new THREE.PlaneGeometry(halfSpan * 2 - 1.0, 2.8));
    const gate = new THREE.Mesh(gateGeo, this.mats.finishGlow);
    gate.position.set(0, 1.5, 0);
    g.add(gate);

    const beaconGeo = this.trackGeo(new THREE.CylinderGeometry(0.65, 1.4, 58, 12, 1, true));
    const beaconMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: '#19e684',
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(0, archH + 29, 0);
    g.add(beacon);

    this.group.add(g);
  }

  /**
   * Build the iconic sunlit City of Glass skyscraper skyline surrounding the course,
   * guaranteeing wide clearance from every course structure and camera corridor.
   */
  private buildSkyline(course: CourseDef): void {
    const rand = seededRand(course.id.charCodeAt(1) * 4099 + 1337);

    // Compute overall bounding box of the course
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const b of course.boxes) {
      minX = Math.min(minX, b.x - b.w * 0.5);
      maxX = Math.max(maxX, b.x + b.w * 0.5);
      minZ = Math.min(minZ, b.z - b.d * 0.5);
      maxZ = Math.max(maxZ, b.z + b.d * 0.5);
    }

    const isClear = (tx: number, tz: number, tw: number, td: number): boolean => {
      const pad = 20;
      const aMinX = tx - tw * 0.5 - pad;
      const aMaxX = tx + tw * 0.5 + pad;
      const aMinZ = tz - td * 0.5 - pad;
      const aMaxZ = tz + td * 0.5 + pad;

      for (const b of course.boxes) {
        if (
          aMaxX > b.x - b.w * 0.5 &&
          aMinX < b.x + b.w * 0.5 &&
          aMaxZ > b.z - b.d * 0.5 &&
          aMinZ < b.z + b.d * 0.5
        ) {
          return false;
        }
      }
      for (const g of course.grapples) {
        if (aMaxX > g.x - 16 && aMinX < g.x + 16 && aMaxZ > g.z - 16 && aMinZ < g.z + 16) {
          return false;
        }
      }
      return true;
    };

    const towerGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
    let placed = 0;
    let attempts = 0;

    while (placed < 78 && attempts < 450) {
      attempts++;
      const tx = minX - 210 + rand() * (maxX - minX + 420);
      const tz = minZ - 210 + rand() * (maxZ - minZ + 380);
      const tw = 16 + rand() * 26;
      const td = 16 + rand() * 26;

      if (!isClear(tx, tz, tw, td)) continue;

      // Distance from course spine influences height — dramatic towering skyline peaks further out!
      const distOut = Math.hypot(
        Math.max(0, minX - tx, tx - maxX),
        Math.max(0, minZ - tz, tz - maxZ)
      );
      const topY = -28 + rand() * 52 + (distOut > 75 ? rand() * 48 : 0);
      const botY = -165;
      const th = topY - botY;

      const matChoice = rand();
      const mat =
        matChoice < 0.48
          ? this.mats.distantTowerA
          : matChoice < 0.78
            ? this.mats.glassFacade
            : this.mats.distantTowerB;

      const mesh = new THREE.Mesh(towerGeo, mat);
      mesh.scale.set(tw, th, td);
      mesh.position.set(tx, botY + th * 0.5, tz);
      this.group.add(mesh);

      // Crown penthouse tier on taller towers for unmistakable architectural silhouette
      if (rand() > 0.52) {
        const crownH = 5 + rand() * 11;
        const crown = new THREE.Mesh(towerGeo, this.mats.whiteConcrete);
        crown.scale.set(tw * 0.62, crownH, td * 0.62);
        crown.position.set(tx, topY + crownH * 0.5, tz);
        this.group.add(crown);

        if (rand() > 0.55) {
          const spireH = 12 + rand() * 18;
          const spire = new THREE.Mesh(towerGeo, this.mats.darkSteel);
          spire.scale.set(0.35, spireH, 0.35);
          spire.position.set(tx, topY + crownH + spireH * 0.5, tz);
          this.group.add(spire);
        }
      }

      placed++;
    }
  }

  markCheckpointReached(index: number): void {
    for (const cp of this.checkpoints) {
      if (cp.index <= index && !cp.hit) {
        cp.hit = true;
        cp.ribbon.material = this.mats.checkpointHit;
      }
    }
  }

  resetCheckpoints(): void {
    for (const cp of this.checkpoints) {
      cp.hit = false;
      cp.ribbon.material = this.mats.checkpointIdle;
    }
  }

  update(
    dt: number,
    lockedGrappleId: string | null,
    activeGrappleId: string | null
  ): void {
    this.time += dt;
    const t = this.time;

    // Spin HVAC condenser & turbine launch pad fans
    for (let i = 0; i < this.fans.length; i++) {
      const f = this.fans[i];
      f.mesh.rotation.y += f.speed * dt;
    }

    // Rising updraft rings on launch pads
    for (let i = 0; i < this.launchRings.length; i++) {
      const r = this.launchRings[i];
      const p = (t * 0.95 + r.phase) % 1;
      r.mesh.position.y = r.baseY + p * 3.1;
      const scale = 1.0 + p * 0.35;
      r.mesh.scale.set(scale, scale, 1);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.65;
    }

    // Rotate & pulse grapple skyhooks (snappy scale-up when locked in reticle!)
    for (let i = 0; i < this.grapples.length; i++) {
      const g = this.grapples[i];
      const highlighted = g.id === lockedGrappleId || g.id === activeGrappleId;
      g.ring.rotation.y = t * (highlighted ? 4.2 : 1.4);
      g.core.rotation.y = -t * 2.6;
      g.core.rotation.x = t * 1.5;
      const targetS = highlighted ? 1.28 : 1.0 + Math.sin(t * 3.2 + i) * 0.05;
      g.baseScale += (targetS - g.baseScale) * Math.min(1, 14 * dt);
      g.ring.scale.setScalar(g.baseScale);
      g.core.scale.setScalar(g.baseScale);
    }

    // Wind-rippling finish arch banners
    for (let i = 0; i < this.banners.length; i++) {
      const b = this.banners[i];
      const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const base = b.basePositions;
      for (let v = 0; v < pos.count; v++) {
        const y = base[v * 3 + 1];
        // Top of banner is pinned (y = +2.7), bottom billows freely (y = -2.7)
        const hang = Math.max(0, (2.7 - y) / 5.4);
        arr[v * 3 + 2] =
          Math.sin(t * 5.2 - hang * 4.5 + b.phase) * 0.32 * hang * hang;
        arr[v * 3] =
          base[v * 3] + Math.cos(t * 3.4 - hang * 3.0 + b.phase) * 0.08 * hang;
      }
      pos.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const geo of this.disposables) {
      geo.dispose();
    }
    this.disposables.length = 0;
    for (const mat of this.matDisposables) {
      mat.dispose();
    }
    this.matDisposables.length = 0;
  }
}
