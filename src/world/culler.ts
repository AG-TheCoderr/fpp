import * as THREE from 'three';

/**
 * Zero-allocation 6-plane camera frustum + distance + LOD culler.
 * Stores plane equations in a flat Float32Array(24) for branch-minimal hot loops.
 */
export class FrustumCuller {
  camX = 0;
  camY = 0;
  camZ = 0;
  cameraMoved = true;

  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  // [nx, ny, nz, constant] * 6 planes
  private readonly planeData = new Float32Array(24);

  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastZ = Number.NaN;
  private lastQx = 0;
  private lastQy = 0;
  private lastQz = 0;
  private lastQw = 1;
  private lastFov = 0;

  update(camera: THREE.PerspectiveCamera, force = false): boolean {
    camera.updateMatrixWorld();
    const pos = camera.position;
    const q = camera.quaternion;
    const dx = pos.x - this.lastX;
    const dy = pos.y - this.lastY;
    const dz = pos.z - this.lastZ;
    const posDeltaSq = dx * dx + dy * dy + dz * dz;
    const qDot = Math.abs(
      q.x * this.lastQx + q.y * this.lastQy + q.z * this.lastQz + q.w * this.lastQw
    );
    const fovDelta = Math.abs(camera.fov - this.lastFov);

    this.camX = pos.x;
    this.camY = pos.y;
    this.camZ = pos.z;

    if (
      !force &&
      !Number.isNaN(this.lastX) &&
      posDeltaSq < 0.025 &&
      qDot > 0.99992 &&
      fovDelta < 0.08
    ) {
      this.cameraMoved = false;
      return false;
    }

    this.lastX = pos.x;
    this.lastY = pos.y;
    this.lastZ = pos.z;
    this.lastQx = q.x;
    this.lastQy = q.y;
    this.lastQz = q.z;
    this.lastQw = q.w;
    this.lastFov = camera.fov;

    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const planes = this.frustum.planes;
    const pd = this.planeData;
    for (let i = 0; i < 6; i++) {
      const p = planes[i];
      const o = i * 4;
      pd[o] = p.normal.x;
      pd[o + 1] = p.normal.y;
      pd[o + 2] = p.normal.z;
      pd[o + 3] = p.constant;
    }

    this.cameraMoved = true;
    return true;
  }

  /** Fast combined distance + 6-plane frustum bounding-sphere test (zero allocations). */
  isSphereVisible(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    maxDist = Infinity
  ): boolean {
    if (maxDist < Infinity) {
      const dx = cx - this.camX;
      const dy = cy - this.camY;
      const dz = cz - this.camZ;
      const limit = maxDist + radius;
      if (dx * dx + dy * dy + dz * dz > limit * limit) {
        return false;
      }
    }
    return this.intersectsFrustum(cx, cy, cz, radius);
  }

  /** Pure 6-plane frustum sphere test (with slight negative margin so shadow edges stay clean). */
  intersectsFrustum(cx: number, cy: number, cz: number, radius: number): boolean {
    const pd = this.planeData;
    const negR = -radius;
    for (let o = 0; o < 24; o += 4) {
      if (pd[o] * cx + pd[o + 1] * cy + pd[o + 2] * cz + pd[o + 3] < negR) {
        return false;
      }
    }
    return true;
  }
}

export interface InstanceBatchOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Minimum center distance for LOD band switching (default 0). */
  minDist?: number;
  /** Maximum draw distance before instance is culled (default 650). */
  maxDist?: number;
  /** Optional distance where smooth scale-to-zero fade begins (e.g. grass tufts). */
  fadeStart?: number;
  /** Expand bounding sphere subtly so shadow casters just off-screen keep grounding shadows. */
  frustumPad?: number;
  /** Optional sparsity step (e.g. 2 keeps every 2nd instance on LOW foliage density). */
  allowSubsample?: boolean;
}

export interface RawInstance {
  matrix: THREE.Matrix4;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  color?: THREE.Color;
  /** If true, always kept even in 'low' foliage mode (e.g. landmark plaza trees & planter boxes). */
  priority?: boolean;
}

/**
 * GPU InstancedMesh with per-frame CPU frustum culling, distance LOD bands,
 * density filtering, and smooth horizon scale-out (compacts only visible instances).
 */
export class CulledInstancedBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly totalCount: number;
  visibleCount = 0;

  private readonly srcMatrices: Float32Array;
  private readonly srcBounds: Float32Array; // [cx, cy, cz, radius]
  private readonly srcColors: Float32Array | null;
  private readonly srcPriority: Uint8Array | null;

  private readonly minDist: number;
  private readonly maxDist: number;
  private readonly fadeStart: number;
  private readonly frustumPad: number;
  private readonly allowSubsample: boolean;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    instances: RawInstance[],
    opts: InstanceBatchOptions = {}
  ) {
    const n = instances.length;
    this.totalCount = n;
    this.minDist = opts.minDist ?? 0;
    this.maxDist = opts.maxDist ?? 680;
    this.fadeStart = opts.fadeStart ?? 0;
    this.frustumPad = opts.frustumPad ?? 0;
    this.allowSubsample = opts.allowSubsample ?? false;

    this.srcMatrices = new Float32Array(n * 16);
    this.srcBounds = new Float32Array(n * 4);

    const hasColor = instances.some((it) => it.color !== undefined);
    this.srcColors = hasColor ? new Float32Array(n * 3) : null;
    this.srcPriority = this.allowSubsample ? new Uint8Array(n) : null;

    this.mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
    this.mesh.castShadow = opts.castShadow ?? false;
    this.mesh.receiveShadow = opts.receiveShadow ?? false;
    // Individual instances are frustum-culled tightly each update; disable whole-mesh origin test
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const tmpColor = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const it = instances[i];
      this.srcMatrices.set(it.matrix.elements, i * 16);
      const bo = i * 4;
      this.srcBounds[bo] = it.cx;
      this.srcBounds[bo + 1] = it.cy;
      this.srcBounds[bo + 2] = it.cz;
      this.srcBounds[bo + 3] = it.radius;

      this.mesh.setMatrixAt(i, it.matrix);
      if (this.srcColors) {
        const c = it.color ?? tmpColor;
        const co = i * 3;
        this.srcColors[co] = c.r;
        this.srcColors[co + 1] = c.g;
        this.srcColors[co + 2] = c.b;
        this.mesh.setColorAt(i, c);
      }
      if (this.srcPriority) {
        this.srcPriority[i] = it.priority ? 1 : 0;
      }
    }

    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.visibleCount = n;
  }

  /**
   * Compact all in-frustum, in-range instances into slots [0..visibleCount).
   * `densityMode`: 0 = hidden, 1 = sparse/low, 2 = full/high.
   */
  cull(culler: FrustumCuller, distScale = 1.0, densityMode: 0 | 1 | 2 = 2): number {
    if (this.totalCount === 0 || densityMode === 0) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      this.visibleCount = 0;
      return 0;
    }

    const minD = this.minDist * distScale;
    const maxD = this.maxDist * distScale;
    const minDSq = minD * minD;
    const useFade = this.fadeStart > 0 && this.fadeStart < this.maxDist;
    const fadeS = this.fadeStart * distScale;
    const fadeInv = useFade ? 1 / Math.max(0.5, maxD - fadeS) : 0;
    const pad = this.frustumPad;

    const camX = culler.camX;
    const camY = culler.camY;
    const camZ = culler.camZ;

    const srcM = this.srcMatrices;
    const srcB = this.srcBounds;
    const srcC = this.srcColors;
    const srcP = this.srcPriority;

    const dstM = this.mesh.instanceMatrix.array as Float32Array;
    const dstC = this.mesh.instanceColor
      ? (this.mesh.instanceColor.array as Float32Array)
      : null;

    const sparse = densityMode === 1 && this.allowSubsample;
    let vis = 0;

    for (let i = 0; i < this.totalCount; i++) {
      if (sparse && srcP && srcP[i] === 0 && (i & 1) === 1) {
        continue;
      }

      const bo = i * 4;
      const cx = srcB[bo];
      const cy = srcB[bo + 1];
      const cz = srcB[bo + 2];
      const r = srcB[bo + 3];

      const dx = cx - camX;
      const dy = cy - camY;
      const dz = cz - camZ;
      const dSq = dx * dx + dy * dy + dz * dz;

      const outer = maxD + r;
      if (dSq > outer * outer) continue;
      if (minDSq > 0 && dSq < minDSq) continue;

      if (!culler.intersectsFrustum(cx, cy, cz, r + pad)) continue;

      const sOff = i * 16;
      const dOff = vis * 16;

      if (useFade && dSq > fadeS * fadeS) {
        const d = Math.sqrt(dSq);
        const raw = Math.max(0, Math.min(1, (maxD - d) * fadeInv));
        // Smoothstep shrink anchored at instance base origin (no sudden horizon pop!)
        const k = raw * raw * (3 - 2 * raw);
        if (k < 0.04) continue;
        dstM[dOff] = srcM[sOff] * k;
        dstM[dOff + 1] = srcM[sOff + 1] * k;
        dstM[dOff + 2] = srcM[sOff + 2] * k;
        dstM[dOff + 3] = 0;
        dstM[dOff + 4] = srcM[sOff + 4] * k;
        dstM[dOff + 5] = srcM[sOff + 5] * k;
        dstM[dOff + 6] = srcM[sOff + 6] * k;
        dstM[dOff + 7] = 0;
        dstM[dOff + 8] = srcM[sOff + 8] * k;
        dstM[dOff + 9] = srcM[sOff + 9] * k;
        dstM[dOff + 10] = srcM[sOff + 10] * k;
        dstM[dOff + 11] = 0;
        dstM[dOff + 12] = srcM[sOff + 12];
        dstM[dOff + 13] = srcM[sOff + 13];
        dstM[dOff + 14] = srcM[sOff + 14];
        dstM[dOff + 15] = 1;
      } else {
        for (let m = 0; m < 16; m++) {
          dstM[dOff + m] = srcM[sOff + m];
        }
      }

      if (srcC && dstC) {
        const sCo = i * 3;
        const dCo = vis * 3;
        dstC[dCo] = srcC[sCo];
        dstC[dCo + 1] = srcC[sCo + 1];
        dstC[dCo + 2] = srcC[sCo + 2];
      }

      vis++;
    }

    this.visibleCount = vis;
    this.mesh.count = vis;
    this.mesh.visible = vis > 0;

    if (vis > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, vis * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor && dstC) {
        this.mesh.instanceColor.clearUpdateRanges();
        this.mesh.instanceColor.addUpdateRange(0, vis * 3);
        this.mesh.instanceColor.needsUpdate = true;
      }
    }

    return vis;
  }
}

export interface CulledSectorMesh {
  mesh: THREE.Mesh;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  maxDist: number;
  /** Extra padding for shadow-casting architecture so sun shadows never pop at screen edges. */
  shadowPad: number;
}

interface GeoChunk {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  vertCount: number;
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  maxDist: number;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMat = new THREE.Matrix3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * Spatially buckets static course geometry into ~56m sectors grouped by shared Material.
 * Cuts hundreds of per-box/per-face draw calls down to a handful of tight sector meshes
 * that frustum-cull cleanly in O(1) as the player sprints through the course!
 */
export class StaticSectorBatcher {
  private readonly buckets = new Map<string, GeoChunk>();
  private readonly matIds = new Map<THREE.Material, number>();
  private nextMatId = 1;

  constructor(private readonly sectorSize = 56) {}

  private getMatId(mat: THREE.Material): number {
    let id = this.matIds.get(mat);
    if (id === undefined) {
      id = this.nextMatId++;
      this.matIds.set(mat, id);
    }
    return id;
  }

  private getBucket(
    wx: number,
    wz: number,
    mat: THREE.Material,
    castShadow: boolean,
    receiveShadow: boolean,
    maxDist: number
  ): GeoChunk {
    const sx = Math.floor(wx / this.sectorSize);
    const sz = Math.floor(wz / this.sectorSize);
    const mId = this.getMatId(mat);
    const flags = (castShadow ? 2 : 0) | (receiveShadow ? 1 : 0);
    const key = `${sx}:${sz}:${mId}:${flags}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        positions: [],
        normals: [],
        uvs: [],
        indices: [],
        vertCount: 0,
        material: mat,
        castShadow,
        receiveShadow,
        maxDist,
      };
      this.buckets.set(key, b);
    } else if (maxDist > b.maxDist) {
      b.maxDist = maxDist;
    }
    return b;
  }

  addTransform(
    geo: THREE.BufferGeometry,
    mat: THREE.Material | THREE.Material[],
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    castShadow = false,
    receiveShadow = false,
    maxDist = 460,
    skipFaceMask = 0
  ): void {
    _pos.set(x, y, z);
    _euler.set(rx, ry, rz, 'XYZ');
    _quat.setFromEuler(_euler);
    _scale.set(sx, sy, sz);
    _mat4.compose(_pos, _quat, _scale);
    _normalMat.getNormalMatrix(_mat4);

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normAttr = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const indexAttr = geo.index;

    if (Array.isArray(mat) && geo.groups.length > 0) {
      // Split multi-material box faces directly into their matching single-material sector buffers!
      for (let g = 0; g < geo.groups.length; g++) {
        if ((skipFaceMask & (1 << g)) !== 0) continue;
        const grp = geo.groups[g];
        const m = mat[grp.materialIndex ?? g];
        if (!m) continue;
        const bucket = this.getBucket(x, z, m, castShadow, receiveShadow, maxDist);
        this.appendRange(
          bucket,
          posAttr,
          normAttr,
          uvAttr,
          indexAttr,
          grp.start,
          grp.count
        );
      }
    } else if (skipFaceMask !== 0 && geo.groups.length > 0) {
      const singleMat = Array.isArray(mat) ? mat[0] : mat;
      const bucket = this.getBucket(x, z, singleMat, castShadow, receiveShadow, maxDist);
      for (let g = 0; g < geo.groups.length; g++) {
        if ((skipFaceMask & (1 << g)) !== 0) continue;
        const grp = geo.groups[g];
        this.appendRange(
          bucket,
          posAttr,
          normAttr,
          uvAttr,
          indexAttr,
          grp.start,
          grp.count
        );
      }
    } else {
      const singleMat = Array.isArray(mat) ? mat[0] : mat;
      const bucket = this.getBucket(x, z, singleMat, castShadow, receiveShadow, maxDist);
      const totalCount = indexAttr ? indexAttr.count : posAttr.count;
      this.appendRange(bucket, posAttr, normAttr, uvAttr, indexAttr, 0, totalCount);
    }

    // Source geometry has been baked into world buffer; free immediately
    geo.dispose();
  }

  private appendRange(
    bucket: GeoChunk,
    posAttr: THREE.BufferAttribute,
    normAttr: THREE.BufferAttribute | undefined,
    uvAttr: THREE.BufferAttribute | undefined,
    indexAttr: THREE.BufferAttribute | null,
    start: number,
    count: number
  ): void {
    const remap = new Map<number, number>();
    const end = start + count;

    for (let k = start; k < end; k++) {
      const srcIdx = indexAttr ? indexAttr.getX(k) : k;
      let dstIdx = remap.get(srcIdx);
      if (dstIdx === undefined) {
        dstIdx = bucket.vertCount++;
        remap.set(srcIdx, dstIdx);

        _v.fromBufferAttribute(posAttr, srcIdx).applyMatrix4(_mat4);
        bucket.positions.push(_v.x, _v.y, _v.z);

        if (normAttr) {
          _n.fromBufferAttribute(normAttr, srcIdx).applyMatrix3(_normalMat).normalize();
          bucket.normals.push(_n.x, _n.y, _n.z);
        } else {
          bucket.normals.push(0, 1, 0);
        }

        if (uvAttr) {
          bucket.uvs.push(uvAttr.getX(srcIdx), uvAttr.getY(srcIdx));
        } else {
          bucket.uvs.push(0, 0);
        }
      }
      bucket.indices.push(dstIdx);
    }
  }

  build(
    parent: THREE.Group,
    trackGeo: <T extends THREE.BufferGeometry>(g: T) => T
  ): CulledSectorMesh[] {
    const result: CulledSectorMesh[] = [];

    for (const b of this.buckets.values()) {
      if (b.indices.length === 0) continue;

      const geo = trackGeo(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
      geo.setIndex(b.indices);
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false;
      // Managed explicitly by our sector frustum + distance culler (with shadow margin)
      mesh.frustumCulled = false;
      mesh.updateMatrix();
      parent.add(mesh);

      const sp = geo.boundingSphere!;
      result.push({
        mesh,
        cx: sp.center.x,
        cy: sp.center.y,
        cz: sp.center.z,
        radius: sp.radius,
        maxDist: b.maxDist,
        shadowPad: b.castShadow ? 14 : 2,
      });
    }

    this.buckets.clear();
    return result;
  }
}
