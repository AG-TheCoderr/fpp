import * as THREE from 'three';
import { BoxDef, CourseDef, FoliageDensity } from '../types';
import { CulledInstancedBatch, FrustumCuller, RawInstance } from './culler';
import { MaterialLibrary } from './materials';

export interface SkylineTerrace {
  x: number;
  topY: number;
  z: number;
  w: number;
  d: number;
}

interface KeepOutRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Injects lightweight GPU vertex wind sway into a MeshStandardMaterial.
 * Zero per-frame CPU vertex updates — driven by a single shared float uniform.
 */
export function applyGpuWind(
  mat: THREE.MeshStandardMaterial,
  windTimeUniform: { value: number },
  cacheKey: string,
  baseY: number,
  heightSpan: number,
  swayAmp: number,
  flutterAmp: number
): THREE.MeshStandardMaterial {
  const invH = 1 / Math.max(0.1, heightSpan);
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTimeUniform;
    shader.vertexShader =
      `uniform float uWindTime;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          vec2 wOrg = vec2(0.0);
          #ifdef USE_INSTANCING
            wOrg = instanceMatrix[3].xz;
          #endif
          float wFactor = clamp((position.y - ${baseY.toFixed(3)}) * ${invH.toFixed(4)}, 0.0, 1.0);
          wFactor *= wFactor;
          float wPhase = uWindTime * 1.85 + dot(wOrg, vec2(0.12, 0.09));
          float wGust = 0.62 + 0.38 * sin(uWindTime * 0.68 + wOrg.x * 0.04 - wOrg.y * 0.035);
          float wAmt = ${swayAmp.toFixed(4)} * wGust * wFactor;
          transformed.x += sin(wPhase) * wAmt;
          transformed.z += cos(wPhase * 0.82 + 0.8) * wAmt * 0.65;
          float wFlut = sin(uWindTime * 4.2 + position.x * 3.8 + position.z * 3.3 + wOrg.x * 0.7) * ${flutterAmp.toFixed(4)} * wFactor;
          transformed.x += wFlut;
          transformed.y -= abs(sin(wPhase)) * wAmt * 0.12;
        }
        `
      );
  };
  return mat;
}

/** Merge tiny sub-part arrays into a single compact vertex-colored BufferGeometry. */
function buildColoredMergedGeo(
  parts: {
    geo: THREE.BufferGeometry;
    tx: number;
    ty: number;
    tz: number;
    rx?: number;
    ry?: number;
    rz?: number;
    sx?: number;
    sy?: number;
    sz?: number;
    colorFn: (lx: number, ly: number, lz: number, wx: number, wy: number, wz: number) => [number, number, number];
  }[]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const m4 = new THREE.Matrix4();
  const n3 = new THREE.Matrix3();
  const pos = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const lv = new THREE.Vector3();
  const wv = new THREE.Vector3();
  const wn = new THREE.Vector3();

  for (const p of parts) {
    // Expand to non-indexed so flat sunlit facets have crisp normals & exact per-vertex AO
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.computeVertexNormals();

    pos.set(p.tx, p.ty, p.tz);
    euler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'XYZ');
    quat.setFromEuler(euler);
    scl.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    m4.compose(pos, quat, scl);
    n3.getNormalMatrix(m4);

    const pa = g.attributes.position as THREE.BufferAttribute;
    const na = g.attributes.normal as THREE.BufferAttribute;

    for (let i = 0; i < pa.count; i++) {
      lv.fromBufferAttribute(pa, i);
      wv.copy(lv).applyMatrix4(m4);
      wn.fromBufferAttribute(na, i).applyMatrix3(n3).normalize();

      positions.push(wv.x, wv.y, wv.z);
      normals.push(wn.x, wn.y, wn.z);
      const [r, gr, b] = p.colorFn(lv.x, lv.y, lv.z, wv.x, wv.y, wv.z);
      colors.push(r, gr, b);
    }

    g.dispose();
    p.geo.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

/** Tapered architectural birch/olive trunk splitting into 3 graceful upper branches (~54 tris). */
function createTreeTrunkGeometry(): THREE.BufferGeometry {
  const barkShade = (_lx: number, _ly: number, _lz: number, _wx: number, wy: number) => {
    // Dark grounded soil collar fading up into warm pale sunlit architectural bark
    const t = Math.max(0, Math.min(1, wy / 2.6));
    const v = 0.52 + t * 0.44;
    return [v, v * 0.96, v * 0.91] as [number, number, number];
  };

  return buildColoredMergedGeo([
    {
      geo: new THREE.CylinderGeometry(0.085, 0.155, 2.25, 6, 1),
      tx: 0,
      ty: 1.12,
      tz: 0,
      rz: 0.04,
      colorFn: barkShade,
    },
    {
      geo: new THREE.CylinderGeometry(0.042, 0.078, 1.15, 5, 1),
      tx: 0.24,
      ty: 2.38,
      tz: 0.1,
      rz: -0.46,
      rx: 0.18,
      colorFn: barkShade,
    },
    {
      geo: new THREE.CylinderGeometry(0.04, 0.074, 1.08, 5, 1),
      tx: -0.26,
      ty: 2.3,
      tz: 0.14,
      rz: 0.5,
      rx: 0.24,
      colorFn: barkShade,
    },
    {
      geo: new THREE.CylinderGeometry(0.038, 0.068, 1.0, 5, 1),
      tx: -0.02,
      ty: 2.42,
      tz: -0.24,
      rx: -0.46,
      colorFn: barkShade,
    },
  ]);
}

/** Sculpted 5-cluster sunlit rooftop tree canopy (LOD0: ~200 tris, baked bottom-to-top AO). */
function createTreeCanopyHiGeometry(): THREE.BufferGeometry {
  const aoFn = (_lx: number, ly: number, _lz: number, _wx: number, wy: number) => {
    // Combine per-cluster underside shade + overall crown height sunlit lift!
    const localUp = Math.max(0, Math.min(1, (ly + 0.9) / 1.8));
    const crownUp = Math.max(0, Math.min(1, (wy - 2.0) / 2.3));
    const shade = 0.46 + localUp * 0.34 + crownUp * 0.26;
    // Slight warm golden tint on sunlit crown tips, cool emerald-blue in lower shade
    return [shade * 1.02, shade * 1.03, shade * 0.92] as [number, number, number];
  };

  return buildColoredMergedGeo([
    // Central high crown
    {
      geo: new THREE.IcosahedronGeometry(1.05, 1),
      tx: 0.02,
      ty: 3.45,
      tz: 0.0,
      sx: 1.25,
      sy: 0.78,
      sz: 1.18,
      ry: 0.4,
      colorFn: aoFn,
    },
    // Sunlit right bough cloud
    {
      geo: new THREE.IcosahedronGeometry(0.84, 0),
      tx: 0.78,
      ty: 2.95,
      tz: 0.22,
      sx: 1.22,
      sy: 0.72,
      sz: 1.1,
      ry: 1.1,
      colorFn: aoFn,
    },
    // Left counter-balance bough cloud
    {
      geo: new THREE.IcosahedronGeometry(0.82, 0),
      tx: -0.76,
      ty: 2.84,
      tz: 0.28,
      sx: 1.18,
      sy: 0.7,
      sz: 1.12,
      ry: 2.2,
      colorFn: aoFn,
    },
    // Rear bough cloud
    {
      geo: new THREE.IcosahedronGeometry(0.8, 0),
      tx: -0.05,
      ty: 3.02,
      tz: -0.68,
      sx: 1.2,
      sy: 0.72,
      sz: 1.08,
      ry: 0.8,
      colorFn: aoFn,
    },
    // Delicate upper crest accent
    {
      geo: new THREE.IcosahedronGeometry(0.62, 0),
      tx: 0.28,
      ty: 4.02,
      tz: -0.14,
      sx: 1.12,
      sy: 0.68,
      sz: 1.05,
      ry: 1.7,
      colorFn: aoFn,
    },
  ]);
}

/** Ultra-light single-volume tree canopy proxy for distant LOD1 (88m..210m, only 20 tris!). */
function createTreeCanopyLoGeometry(): THREE.BufferGeometry {
  return buildColoredMergedGeo([
    {
      geo: new THREE.IcosahedronGeometry(1.42, 0),
      tx: 0,
      ty: 3.25,
      tz: 0,
      sx: 1.18,
      sy: 0.76,
      sz: 1.15,
      colorFn: (_lx, ly) => {
        const up = Math.max(0, Math.min(1, (ly + 1.2) / 2.4));
        const s = 0.5 + up * 0.54;
        return [s * 1.01, s * 1.02, s * 0.93];
      },
    },
  ]);
}

/** Tailored architectural rooftop shrub / cushion hedge (~40 tris). */
function createShrubGeometry(): THREE.BufferGeometry {
  const aoFn = (_lx: number, _ly: number, _lz: number, _wx: number, wy: number) => {
    const up = Math.max(0, Math.min(1, wy / 0.85));
    const s = 0.42 + up * 0.62;
    return [s, s * 1.03, s * 0.92] as [number, number, number];
  };
  return buildColoredMergedGeo([
    {
      geo: new THREE.IcosahedronGeometry(0.56, 0),
      tx: -0.16,
      ty: 0.38,
      tz: 0.04,
      sx: 1.18,
      sy: 0.78,
      sz: 1.02,
      ry: 0.5,
      colorFn: aoFn,
    },
    {
      geo: new THREE.IcosahedronGeometry(0.46, 0),
      tx: 0.28,
      ty: 0.32,
      tz: -0.06,
      sx: 1.1,
      sy: 0.74,
      sz: 0.96,
      ry: 1.9,
      colorFn: aoFn,
    },
  ]);
}

/**
 * Pure geometric 7-blade arched ornamental grass tuft (21 tris, zero alpha-discard overdraw!).
 * Root-to-tip baked vertex color gradient bends organically under GPU wind.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const bladeCount = 7;
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.24;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // Tangent perpendicular to radial direction for blade width
    const tx = -sa;
    const tz = ca;

    const h = 0.56 + (i % 3) * 0.16;
    const lean = 0.18 + (i % 2) * 0.13;
    const r0 = 0.05 + (i % 3) * 0.025;
    const w0 = 0.048;
    const w1 = 0.03;

    // 2 segments per blade (lower quad = 2 tris + tapered tip tri = 3 tris per blade)
    const bx = ca * r0;
    const bz = sa * r0;
    const mx = ca * (r0 + lean * 0.42);
    const my = h * 0.54;
    const mz = sa * (r0 + lean * 0.42);
    const px = ca * (r0 + lean);
    const py = h;
    const pz = sa * (r0 + lean);

    // Upward-tilted outward normal catches bright midday sun cleanly from every angle
    const nx = ca * 0.45;
    const ny = 0.89;
    const nz = sa * 0.45;

    const cRoot: [number, number, number] = [0.22, 0.42, 0.2];
    const cMid: [number, number, number] = [0.52, 0.82, 0.34];
    const cTip: [number, number, number] = [0.88, 1.04, 0.52];

    const pushV = (x: number, y: number, z: number, c: [number, number, number]) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      colors.push(c[0], c[1], c[2]);
    };

    const p0L: [number, number, number] = [bx - tx * w0, 0, bz - tz * w0];
    const p0R: [number, number, number] = [bx + tx * w0, 0, bz + tz * w0];
    const p1L: [number, number, number] = [mx - tx * w1, my, mz - tz * w1];
    const p1R: [number, number, number] = [mx + tx * w1, my, mz + tz * w1];

    // Lower segment (2 tris)
    pushV(p0L[0], p0L[1], p0L[2], cRoot);
    pushV(p0R[0], p0R[1], p0R[2], cRoot);
    pushV(p1R[0], p1R[1], p1R[2], cMid);

    pushV(p0L[0], p0L[1], p0L[2], cRoot);
    pushV(p1R[0], p1R[1], p1R[2], cMid);
    pushV(p1L[0], p1L[1], p1L[2], cMid);

    // Tapered sunlit tip (1 tri)
    pushV(p1L[0], p1L[1], p1L[2], cMid);
    pushV(p1R[0], p1R[1], p1R[2], cMid);
    pushV(px, py, pz, cTip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

// Mirror's Edge Catalyst sunlit rooftop greenery palette (emerald, olive, lime + signature coral-gold maple!)
const TREE_GREENS = [
  new THREE.Color('#47a844'), // Fresh sunlit rooftop emerald
  new THREE.Color('#5cb848'), // Vibrant city-garden leaf green
  new THREE.Color('#6dbe4e'), // Warm sunlit chartreuse-green
  new THREE.Color('#3f9648'), // Deep architectural ficus green
  new THREE.Color('#7ab846'), // Sun-drenched silver-birch lime
];

const TREE_ACCENTS = [
  new THREE.Color('#f08a24'), // Iconic Mirror's Edge Catalyst golden-amber tree!
  new THREE.Color('#e85d2a'), // Sunlit Japanese coral-maple accent
];

const SHRUB_GREENS = [
  new THREE.Color('#3c8f3d'),
  new THREE.Color('#4da343'),
  new THREE.Color('#5eb046'),
];

const GRASS_TINTS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#eefad2'),
  new THREE.Color('#daf5c4'),
];

/**
 * Complete GPU-instanced, wind-animated, frustum- & LOD-culled architectural foliage system.
 * Renders hundreds of planters, trees, shrubs, and grass tufts in just 6 total draw calls!
 */
export class CourseFoliage {
  readonly group = new THREE.Group();
  private readonly batches: CulledInstancedBatch[] = [];
  private readonly grassBatch: CulledInstancedBatch;
  private readonly canopyHiBatch: CulledInstancedBatch;
  private readonly disposables: THREE.BufferGeometry[] = [];
  private readonly matDisposables: THREE.Material[] = [];
  private readonly windTime = { value: 0 };

  constructor(
    course: CourseDef,
    mats: MaterialLibrary,
    skylineTerraces: SkylineTerrace[]
  ) {
    const rand = seededRand(course.id.charCodeAt(0) * 7919 + 2026);
    const keepOuts = this.buildKeepOuts(course);

    const planters: RawInstance[] = [];
    const soils: RawInstance[] = [];
    const trunks: RawInstance[] = [];
    const canopies: RawInstance[] = [];
    const shrubs: RawInstance[] = [];
    const grasses: RawInstance[] = [];

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();

    const addPlanterBed = (
      x: number,
      floorY: number,
      z: number,
      w: number,
      d: number,
      hasTree: boolean,
      accentTree: boolean,
      priority: boolean
    ) => {
      const h = 0.44;
      // Sleek white brutalist planter curb
      pos.set(x, floorY + h * 0.5, z);
      quat.identity();
      scl.set(w, h, d);
      m.compose(pos, quat, scl);
      const rad = Math.hypot(w, h, d) * 0.5;
      planters.push({
        matrix: m.clone(),
        cx: x,
        cy: floorY + h * 0.5,
        cz: z,
        radius: rad,
        priority,
      });

      // Recessed dark organic mulch bed on top
      const sw = Math.max(0.4, w - 0.24);
      const sd = Math.max(0.4, d - 0.24);
      pos.set(x, floorY + h + 0.01, z);
      scl.set(sw, 0.05, sd);
      m.compose(pos, quat, scl);
      soils.push({
        matrix: m.clone(),
        cx: x,
        cy: floorY + h,
        cz: z,
        radius: rad,
        priority,
      });

      const bedY = floorY + h;
      const alongX = w >= d;
      const longSpan = alongX ? sw : sd;

      // Optional sculpted rooftop tree
      if (hasTree) {
        const tOff = longSpan > 4.2 ? (rand() - 0.5) * (longSpan * 0.35) : 0;
        const tx = alongX ? x + tOff : x;
        const tz = alongX ? z : z + tOff;
        const tScale = 0.84 + rand() * 0.34;
        const tYaw = rand() * Math.PI * 2;

        pos.set(tx, bedY, tz);
        euler.set(0, tYaw, 0);
        quat.setFromEuler(euler);
        scl.set(tScale, tScale, tScale);
        m.compose(pos, quat, scl);

        const col = accentTree
          ? TREE_ACCENTS[Math.floor(rand() * TREE_ACCENTS.length)]
          : TREE_GREENS[Math.floor(rand() * TREE_GREENS.length)];

        trunks.push({
          matrix: m.clone(),
          cx: tx,
          cy: bedY + 1.4 * tScale,
          cz: tz,
          radius: 1.6 * tScale,
          priority,
        });
        canopies.push({
          matrix: m.clone(),
          cx: tx,
          cy: bedY + 3.25 * tScale,
          cz: tz,
          radius: 2.35 * tScale,
          color: col,
          priority,
        });
      }

      // Tailored shrubs nestled along the planter
      const shrubCount = Math.max(1, Math.min(3, Math.floor(longSpan / 2.2)));
      for (let i = 0; i < shrubCount; i++) {
        const u = ((i + 0.5) / shrubCount - 0.5) * (longSpan - 0.7);
        const jitter = (rand() - 0.5) * 0.16;
        const sx = alongX ? x + u : x + jitter;
        const sz = alongX ? z + jitter : z + u;
        const sc = 0.72 + rand() * 0.38;
        pos.set(sx, bedY, sz);
        euler.set(0, rand() * Math.PI * 2, 0);
        quat.setFromEuler(euler);
        scl.set(sc, sc * (0.85 + rand() * 0.25), sc);
        m.compose(pos, quat, scl);
        shrubs.push({
          matrix: m.clone(),
          cx: sx,
          cy: bedY + 0.35 * sc,
          cz: sz,
          radius: 0.95 * sc,
          color: SHRUB_GREENS[Math.floor(rand() * SHRUB_GREENS.length)],
          priority: priority && i === 0,
        });
      }

      // Lush wind-swaying ornamental grass tufts filling planter gaps!
      const tuftCount = Math.max(3, Math.min(8, Math.round(longSpan * 1.45)));
      for (let i = 0; i < tuftCount; i++) {
        const u = ((i + 0.2 + rand() * 0.6) / tuftCount - 0.5) * (longSpan - 0.35);
        const v = (rand() - 0.5) * ((alongX ? sd : sw) - 0.28);
        const gx = alongX ? x + u : x + v;
        const gz = alongX ? z + v : z + u;
        const gs = 0.78 + rand() * 0.52;
        pos.set(gx, bedY, gz);
        euler.set(0, rand() * Math.PI * 2, 0);
        quat.setFromEuler(euler);
        scl.set(gs, gs, gs);
        m.compose(pos, quat, scl);
        grasses.push({
          matrix: m.clone(),
          cx: gx,
          cy: bedY + 0.35 * gs,
          cz: gz,
          radius: 0.7 * gs,
          color: GRASS_TINTS[i % GRASS_TINTS.length],
          priority: false,
        });
      }
    };

    const isClearOfObstacles = (x: number, z: number, w: number, d: number): boolean => {
      const aMinX = x - w * 0.5;
      const aMaxX = x + w * 0.5;
      const aMinZ = z - d * 0.5;
      const aMaxZ = z + d * 0.5;
      for (let i = 0; i < keepOuts.length; i++) {
        const k = keepOuts[i];
        if (aMaxX > k.minX && aMinX < k.maxX && aMaxZ > k.minZ && aMinZ < k.maxZ) {
          return false;
        }
      }
      return true;
    };

    // 1. Populate playable rooftops along safe outer lateral margins (zero parkour interference!)
    for (const b of course.boxes) {
      if (b.style !== 'rooftop' || b.noShaft) continue;
      const topY = b.y + b.h;

      if (!b.noCollide && !b.cleanRoof && b.w >= 14 && b.d >= 16) {
        const alongX = b.guideDir === '+x' || b.guideDir === '-x';
        const isFinishRoof = b.label === 'FIN';
        const runSpan = alongX ? b.w : b.d;
        const crossSpan = alongX ? b.d : b.w;

        // Lateral edge margin sits flush against outer parapet, leaving >= 11m clear central track!
        const edgeOffset = crossSpan * 0.5 - 0.92;
        if (edgeOffset < 5.6) continue;

        const bedLen = Math.min(6.2, Math.max(3.4, runSpan * 0.24));
        const bedWide = 1.48;
        const pw = alongX ? bedLen : bedWide;
        const pd = alongX ? bedWide : bedLen;

        // Up to 2 staggered stations along long roofs; mirrored twin garden beds on Finish Plazas!
        const stations = isFinishRoof
          ? [-0.14, 0.24]
          : runSpan >= 32
            ? [-0.24, 0.22]
            : [0.0];

        for (let si = 0; si < stations.length; si++) {
          const u = stations[si] * (runSpan - bedLen - 5.2);
          for (const side of [-1, 1] as const) {
            // Slight asymmetric architectural rhythm on standard roofs, grand symmetry on FIN
            if (!isFinishRoof && stations.length > 1 && (si + (side > 0 ? 1 : 0)) % 2 === 1 && rand() < 0.35) {
              continue;
            }
            const px = alongX ? b.x + u : b.x + side * edgeOffset;
            const pz = alongX ? b.z + side * edgeOffset : b.z + u;

            if (!isClearOfObstacles(px, pz, pw, pd)) continue;

            const placeTree = isFinishRoof || rand() < 0.72;
            // Iconic golden/coral accent trees grace the Finish Plaza & occasional courtyard highlight!
            const isAccent = (isFinishRoof && si === 1) || (!isFinishRoof && rand() < 0.2);
            addPlanterBed(
              px,
              topY,
              pz,
              pw,
              pd,
              placeTree,
              isAccent,
              isFinishRoof || si === 0
            );
          }
        }
      } else if (b.noCollide && b.w >= 12 && b.d >= 14) {
        // 2. Flanking wall-run skyscraper rooftops get lush elevated sky-garden trees along their inner cornice!
        const count = 2;
        for (let i = 0; i < count; i++) {
          const alongX = b.w >= b.d;
          const u = (i === 0 ? -0.26 : 0.26) * (alongX ? b.w : b.d);
          const v = (rand() - 0.5) * ((alongX ? b.d : b.w) * 0.45);
          const tx = alongX ? b.x + u : b.x + v;
          const tz = alongX ? b.z + v : b.z + u;
          const sc = 0.95 + rand() * 0.38;
          pos.set(tx, topY, tz);
          euler.set(0, rand() * Math.PI * 2, 0);
          quat.setFromEuler(euler);
          scl.set(sc, sc, sc);
          m.compose(pos, quat, scl);
          trunks.push({
            matrix: m.clone(),
            cx: tx,
            cy: topY + 1.4 * sc,
            cz: tz,
            radius: 1.7 * sc,
            priority: false,
          });
          canopies.push({
            matrix: m.clone(),
            cx: tx,
            cy: topY + 3.3 * sc,
            cz: tz,
            radius: 2.5 * sc,
            color:
              rand() < 0.18
                ? TREE_ACCENTS[0]
                : TREE_GREENS[Math.floor(rand() * TREE_GREENS.length)],
            priority: false,
          });
        }
      }
    }

    // 3. Nearby skyline penthouse green-roofs (adds crisp living eco-brutalist city depth!)
    for (let i = 0; i < skylineTerraces.length; i++) {
      const st = skylineTerraces[i];
      if (i % 2 !== 0) continue;
      const treeN = 1 + (rand() > 0.5 ? 1 : 0);
      for (let k = 0; k < treeN; k++) {
        const tx = st.x + (rand() - 0.5) * (st.w * 0.55);
        const tz = st.z + (rand() - 0.5) * (st.d * 0.55);
        const sc = 1.05 + rand() * 0.45;
        pos.set(tx, st.topY, tz);
        euler.set(0, rand() * Math.PI * 2, 0);
        quat.setFromEuler(euler);
        scl.set(sc, sc, sc);
        m.compose(pos, quat, scl);
        canopies.push({
          matrix: m.clone(),
          cx: tx,
          cy: st.topY + 3.0 * sc,
          cz: tz,
          radius: 2.7 * sc,
          color: TREE_GREENS[Math.floor(rand() * TREE_GREENS.length)],
          priority: false,
        });
      }
    }

    // Build shared foliage materials with GPU vertex wind
    const soilMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: '#3c342e',
        roughness: 0.95,
        metalness: 0.0,
      })
    );

    const trunkMat = this.trackMat(
      applyGpuWind(
        new THREE.MeshStandardMaterial({
          color: '#9e8e7e',
          vertexColors: true,
          roughness: 0.86,
          metalness: 0.0,
          flatShading: true,
        }),
        this.windTime,
        'stride-trunk-wind-v1',
        0.35,
        3.1,
        0.11,
        0.0
      )
    );

    const canopyMat = this.trackMat(
      applyGpuWind(
        new THREE.MeshStandardMaterial({
          color: '#ffffff',
          vertexColors: true,
          roughness: 0.66,
          metalness: 0.0,
          flatShading: true,
        }),
        this.windTime,
        'stride-canopy-wind-v1',
        0.6,
        3.5,
        0.2,
        0.045
      )
    );

    const grassMat = this.trackMat(
      applyGpuWind(
        new THREE.MeshStandardMaterial({
          color: '#ffffff',
          vertexColors: true,
          roughness: 0.58,
          metalness: 0.0,
          side: THREE.DoubleSide,
        }),
        this.windTime,
        'stride-grass-wind-v1',
        0.02,
        0.72,
        0.16,
        0.032
      )
    );

    // Build shared sculpted low-poly geometries
    const unitBox = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
    const trunkGeo = this.trackGeo(createTreeTrunkGeometry());
    const canopyHiGeo = this.trackGeo(createTreeCanopyHiGeometry());
    const canopyLoGeo = this.trackGeo(createTreeCanopyLoGeometry());
    const shrubGeo = this.trackGeo(createShrubGeometry());
    const grassGeo = this.trackGeo(createGrassTuftGeometry());

    // Create frustum- & LOD-culled GPU instanced batches (just 7 tiny batches total!)
    const planterBatch = new CulledInstancedBatch(unitBox, mats.whiteConcrete, planters, {
      castShadow: false,
      receiveShadow: true,
      maxDist: 165,
      allowSubsample: true,
    });
    const soilBatch = new CulledInstancedBatch(unitBox, soilMat, soils, {
      castShadow: false,
      receiveShadow: true,
      maxDist: 115,
      allowSubsample: true,
    });
    const trunkBatch = new CulledInstancedBatch(trunkGeo, trunkMat, trunks, {
      castShadow: false,
      receiveShadow: false,
      maxDist: 118,
      allowSubsample: true,
    });
    // LOD 0 Canopy (0 .. 88m): full 5-cluster sunlit crown with dappled rooftop shadow!
    this.canopyHiBatch = new CulledInstancedBatch(canopyHiGeo, canopyMat, canopies, {
      castShadow: true,
      receiveShadow: true,
      minDist: 0,
      maxDist: 88,
      frustumPad: 4.5,
      allowSubsample: true,
    });
    // LOD 1 Canopy (88 .. 225m): 20-triangle proxy for distant rooftops & skyline green roofs!
    const canopyLoBatch = new CulledInstancedBatch(canopyLoGeo, canopyMat, canopies, {
      castShadow: false,
      receiveShadow: false,
      minDist: 88,
      maxDist: 225,
      allowSubsample: true,
    });
    // Shrubs (0 .. 110m, smooth base-anchored horizon scale-out 86..110m)
    const shrubBatch = new CulledInstancedBatch(shrubGeo, canopyMat, shrubs, {
      castShadow: false,
      receiveShadow: true,
      maxDist: 110,
      fadeStart: 86,
      allowSubsample: true,
    });
    // Ornamental Grass Tufts (0 .. 72m, smooth scale-out 52..72m — zero far-field vertex cost!)
    this.grassBatch = new CulledInstancedBatch(grassGeo, grassMat, grasses, {
      castShadow: false,
      receiveShadow: false,
      maxDist: 72,
      fadeStart: 52,
      allowSubsample: true,
    });

    this.batches.push(
      planterBatch,
      soilBatch,
      trunkBatch,
      this.canopyHiBatch,
      canopyLoBatch,
      shrubBatch,
      this.grassBatch
    );

    for (const b of this.batches) {
      this.group.add(b.mesh);
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposables.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.matDisposables.push(m);
    return m;
  }

  /** Build padded XZ keep-out rectangles around every interactive obstacle, shortcut, gate & spawn. */
  private buildKeepOuts(course: CourseDef): KeepOutRect[] {
    const rects: KeepOutRect[] = [];
    const add = (x: number, z: number, w: number, d: number, pad: number) => {
      rects.push({
        minX: x - w * 0.5 - pad,
        maxX: x + w * 0.5 + pad,
        minZ: z - d * 0.5 - pad,
        maxZ: z + d * 0.5 + pad,
      });
    };

    // Spawn area
    add(course.spawn[0], course.spawn[2], 5, 5, 2.2);
    // Finish arch pylons & lane
    add(course.finish.x, course.finish.z, course.finish.w, course.finish.d, 2.2);

    for (const cp of course.checkpoints) {
      add(cp.x, cp.z, cp.w, cp.d, 2.0);
    }
    for (const lp of course.launchPads) {
      add(lp.x, lp.z, lp.w ?? 3.6, lp.d ?? 3.6, 3.0);
    }
    for (const r of course.ramps) {
      add(r.x, r.z, r.w, r.d, 2.4);
    }
    for (const b of course.boxes) {
      if (b.style === 'rooftop' || b.style === 'deck') continue;
      // Extra generous buffer around shortcut catwalks, vaults, slide gates, bulkheads & wallruns!
      const pad = b.style === 'catwalk' ? 2.6 : 1.8;
      add(b.x, b.z, b.w, b.d, pad);
    }

    return rects;
  }

  setCanopyShadows(enabled: boolean): void {
    this.canopyHiBatch.mesh.castShadow = enabled;
  }

  update(
    dt: number,
    culler: FrustumCuller,
    density: FoliageDensity,
    distScale: number,
    forceCull = false
  ): void {
    if (density === 'off') {
      if (this.group.visible) {
        this.group.visible = false;
      }
      return;
    }

    const becameVisible = !this.group.visible;
    this.group.visible = true;
    this.windTime.value += dt;

    if (!culler.cameraMoved && !forceCull && !becameVisible) {
      return;
    }

    const mode: 1 | 2 = density === 'low' ? 1 : 2;
    for (let i = 0; i < this.batches.length; i++) {
      const b = this.batches[i];
      // On LOW foliage, trim grass draw distance extra tightly for maximum FPS
      const scale = b === this.grassBatch && mode === 1 ? distScale * 0.72 : distScale;
      b.cull(culler, scale, mode);
    }
  }

  dispose(): void {
    for (const b of this.batches) {
      b.mesh.dispose();
    }
    this.batches.length = 0;
    for (const g of this.disposables) {
      g.dispose();
    }
    this.disposables.length = 0;
    for (const m of this.matDisposables) {
      m.dispose();
    }
    this.matDisposables.length = 0;
  }
}
