import * as THREE from 'three';
import { RampDir } from '../types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  srgb = true,
  aniso = 8
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  if (srgb) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

// Deterministic pseudo-random for crisp consistent surface grain
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function addSubtleGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength: number
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i >> 2) % w;
    const py = Math.floor((i >> 2) / w);
    const n = (hash2(px, py) - 0.5) * strength;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export interface MaterialLibrary {
  roofTop: THREE.MeshStandardMaterial;
  whiteConcrete: THREE.MeshStandardMaterial;
  darkConcrete: THREE.MeshStandardMaterial;
  runnerRed: THREE.MeshStandardMaterial;
  runnerChevron: THREE.MeshStandardMaterial;
  wallRunRed: THREE.MeshStandardMaterial;
  slideHazard: THREE.MeshStandardMaterial;
  slideChute: THREE.MeshStandardMaterial;
  catwalk: THREE.MeshStandardMaterial;
  glassFacade: THREE.MeshStandardMaterial;
  distantTowerA: THREE.MeshStandardMaterial;
  distantTowerB: THREE.MeshStandardMaterial;
  brushedMetal: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  grappleAmber: THREE.MeshStandardMaterial;
  grappleGlow: THREE.MeshBasicMaterial;
  launchCyan: THREE.MeshBasicMaterial;
  checkpointIdle: THREE.MeshBasicMaterial;
  checkpointHit: THREE.MeshBasicMaterial;
  finishGlow: THREE.MeshBasicMaterial;
  finishBanner: THREE.MeshStandardMaterial;
  runnerGuide: THREE.MeshStandardMaterial;
  makeStencilTexture: (label: string) => THREE.CanvasTexture;
}

export function createMaterials(maxAnisotropy: number): MaterialLibrary {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Walkable Roof Deck (sun-bleached crisp light concrete tiles — strong optical flow!)
  const [roofC, roofCtx] = makeCanvas(512, 512);
  roofCtx.fillStyle = '#eaedf2';
  roofCtx.fillRect(0, 0, 512, 512);
  // Subtle slab value variation in 4x4 panel grid
  const cells = 4;
  const step = 512 / cells;
  for (let gx = 0; gx < cells; gx++) {
    for (let gy = 0; gy < cells; gy++) {
      const v = 232 + Math.round((hash2(gx + 3, gy + 7) - 0.5) * 10);
      roofCtx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      roofCtx.fillRect(gx * step, gy * step, step, step);
    }
  }
  addSubtleGrain(roofCtx, 512, 512, 11);
  // Crisp expansion joints
  roofCtx.strokeStyle = 'rgba(130, 142, 158, 0.52)';
  roofCtx.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    const p = i * step + 0.5;
    roofCtx.beginPath();
    roofCtx.moveTo(p, 0);
    roofCtx.lineTo(p, 512);
    roofCtx.moveTo(0, p);
    roofCtx.lineTo(512, p);
    roofCtx.stroke();
  }
  // Major seam border
  roofCtx.strokeStyle = 'rgba(105, 116, 132, 0.65)';
  roofCtx.lineWidth = 3;
  roofCtx.strokeRect(1.5, 1.5, 509, 509);
  const roofTex = finalizeTexture(roofC, true, aniso);

  // Concrete bump map shared across concrete surfaces
  const [bumpC, bumpCtx] = makeCanvas(256, 256);
  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, 256, 256);
  addSubtleGrain(bumpCtx, 256, 256, 36);
  bumpCtx.strokeStyle = '#404040';
  bumpCtx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * 64;
    bumpCtx.beginPath();
    bumpCtx.moveTo(p, 0);
    bumpCtx.lineTo(p, 256);
    bumpCtx.moveTo(0, p);
    bumpCtx.lineTo(256, p);
    bumpCtx.stroke();
  }
  const concreteBump = finalizeTexture(bumpC, false, aniso);

  // 2. Architectural Brutalist White Concrete (with formwork tie-rod holes!)
  const [wcC, wcCtx] = makeCanvas(512, 512);
  wcCtx.fillStyle = '#f2f4f7';
  wcCtx.fillRect(0, 0, 512, 512);
  addSubtleGrain(wcCtx, 512, 512, 9);
  wcCtx.strokeStyle = 'rgba(145, 155, 168, 0.45)';
  wcCtx.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    wcCtx.beginPath();
    wcCtx.moveTo(i * 256, 0);
    wcCtx.lineTo(i * 256, 512);
    wcCtx.moveTo(0, i * 256);
    wcCtx.lineTo(512, i * 256);
    wcCtx.stroke();
  }
  // Tie-rod dots inside each formwork panel
  wcCtx.fillStyle = 'rgba(120, 130, 144, 0.55)';
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 2; py++) {
      const ox = px * 256;
      const oy = py * 256;
      for (const [dx, dy] of [
        [36, 36],
        [220, 36],
        [36, 220],
        [220, 220],
      ]) {
        wcCtx.beginPath();
        wcCtx.arc(ox + dx, oy + dy, 3.5, 0, Math.PI * 2);
        wcCtx.fill();
      }
    }
  }
  const whiteConcreteTex = finalizeTexture(wcC, true, aniso);

  // 3. Dark Cast Concrete
  const [dcC, dcCtx] = makeCanvas(256, 256);
  dcCtx.fillStyle = '#535c68';
  dcCtx.fillRect(0, 0, 256, 256);
  addSubtleGrain(dcCtx, 256, 256, 14);
  dcCtx.strokeStyle = 'rgba(42, 48, 56, 0.65)';
  dcCtx.lineWidth = 2;
  dcCtx.strokeRect(1, 1, 254, 254);
  dcCtx.beginPath();
  dcCtx.moveTo(0, 128);
  dcCtx.lineTo(256, 128);
  dcCtx.stroke();
  const darkConcreteTex = finalizeTexture(dcC, true, aniso);

  // 4. Signal Red Runner Surface (vault blocks, accent trims)
  const [rrC, rrCtx] = makeCanvas(256, 256);
  rrCtx.fillStyle = '#e52b1e';
  rrCtx.fillRect(0, 0, 256, 256);
  addSubtleGrain(rrCtx, 256, 256, 10);
  // Subtle crisp panel ribs & top white accent stripe
  rrCtx.strokeStyle = 'rgba(160, 18, 10, 0.45)';
  rrCtx.lineWidth = 2;
  for (let x = 0; x < 256; x += 64) {
    rrCtx.beginPath();
    rrCtx.moveTo(x, 0);
    rrCtx.lineTo(x, 256);
    rrCtx.stroke();
  }
  rrCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  rrCtx.fillRect(0, 14, 256, 10);
  const runnerRedTex = finalizeTexture(rrC, true, aniso);

  // 5. Signal Red Launch Ramp Chevron Texture
  const [rcC, rcCtx] = makeCanvas(512, 512);
  rcCtx.fillStyle = '#e2291c';
  rcCtx.fillRect(0, 0, 512, 512);
  addSubtleGrain(rcCtx, 512, 512, 10);
  // Crisp white edge sidelines + forward white chevrons
  rcCtx.fillStyle = '#ffffff';
  rcCtx.fillRect(14, 0, 16, 512);
  rcCtx.fillRect(482, 0, 16, 512);
  rcCtx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  rcCtx.lineWidth = 24;
  rcCtx.lineCap = 'square';
  for (const cy of [150, 310, 470]) {
    rcCtx.beginPath();
    rcCtx.moveTo(130, cy);
    rcCtx.lineTo(256, cy - 85);
    rcCtx.lineTo(382, cy);
    rcCtx.stroke();
  }
  // Subtle grip tread lines
  rcCtx.strokeStyle = 'rgba(120, 12, 8, 0.25)';
  rcCtx.lineWidth = 3;
  for (let y = 0; y < 512; y += 16) {
    rcCtx.beginPath();
    rcCtx.moveTo(0, y);
    rcCtx.lineTo(512, y);
    rcCtx.stroke();
  }
  const chevronTex = finalizeTexture(rcC, true, aniso);

  // 6. Wall-Run Panel Texture (corrugated signal-red with sleek horizontal runner bands & shoe scuff!)
  const [wrC, wrCtx] = makeCanvas(512, 512);
  wrCtx.fillStyle = '#df281b';
  wrCtx.fillRect(0, 0, 512, 512);
  // Vertical panel seams for extreme speed sensation when running past!
  for (let x = 0; x < 512; x += 64) {
    wrCtx.fillStyle = x % 128 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    wrCtx.fillRect(x, 0, 4, 512);
  }
  // Bold horizontal white architectural runner band
  wrCtx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  wrCtx.fillRect(0, 210, 512, 34);
  wrCtx.fillRect(0, 258, 512, 10);
  // Subtle dark rubber shoe-scuff arc streak (Mirror's Edge signature!)
  wrCtx.fillStyle = 'rgba(30, 20, 20, 0.16)';
  wrCtx.fillRect(0, 300, 512, 46);
  addSubtleGrain(wrCtx, 512, 512, 11);
  const wallRunTex = finalizeTexture(wrC, true, aniso);

  // 7. Slide Barrier Hazard Texture (industrial white/red diagonal stripes + dark lower bumper)
  const [shC, shCtx] = makeCanvas(512, 256);
  shCtx.fillStyle = '#f4f6f8';
  shCtx.fillRect(0, 0, 512, 256);
  // Bottom bold hazard stripe band
  shCtx.save();
  shCtx.beginPath();
  shCtx.rect(0, 150, 512, 106);
  shCtx.clip();
  shCtx.fillStyle = '#e52b1e';
  for (let x = -256; x < 768; x += 96) {
    shCtx.beginPath();
    shCtx.moveTo(x, 256);
    shCtx.lineTo(x + 48, 256);
    shCtx.lineTo(x + 112, 150);
    shCtx.lineTo(x + 64, 150);
    shCtx.closePath();
    shCtx.fill();
  }
  shCtx.restore();
  // Dark steel trim dividing upper duct from hazard bumper
  shCtx.fillStyle = '#242a33';
  shCtx.fillRect(0, 138, 512, 14);
  shCtx.fillRect(0, 0, 512, 14);
  // Upper panel seams
  shCtx.strokeStyle = 'rgba(130, 140, 154, 0.6)';
  shCtx.lineWidth = 3;
  for (let x = 0; x < 512; x += 128) {
    shCtx.beginPath();
    shCtx.moveTo(x, 14);
    shCtx.lineTo(x, 138);
    shCtx.stroke();
  }
  const slideTex = finalizeTexture(shC, true, aniso);

  // 8. Smooth Concrete Slide Chute (fast directional lines + subtle polish sheen)
  const [scC, scCtx] = makeCanvas(512, 512);
  scCtx.fillStyle = '#dde3eb';
  scCtx.fillRect(0, 0, 512, 512);
  // Central runner wear track + red guide pinstripes
  scCtx.fillStyle = '#e8edf3';
  scCtx.fillRect(96, 0, 320, 512);
  scCtx.fillStyle = '#e52b1e';
  scCtx.fillRect(72, 0, 14, 512);
  scCtx.fillRect(426, 0, 14, 512);
  // Cross expansion grooves for crisp speed perception
  scCtx.fillStyle = 'rgba(115, 128, 145, 0.55)';
  for (let y = 0; y < 512; y += 64) {
    scCtx.fillRect(0, y, 512, 3);
  }
  addSubtleGrain(scCtx, 512, 512, 8);
  const slideChuteTex = finalizeTexture(scC, true, aniso);

  // 9. Skyscraper Curtain-Wall Glass Facade (cool sunlit Mirror's Edge City of Glass!)
  const [gfC, gfCtx] = makeCanvas(512, 512);
  const grad = gfCtx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#9bc0e0');
  grad.addColorStop(0.5, '#82accf');
  grad.addColorStop(1, '#6f98bc');
  gfCtx.fillStyle = grad;
  gfCtx.fillRect(0, 0, 512, 512);

  // Architectural floor spandrels & glass panes (4 floors x 8 bays per tile)
  const floors = 4;
  const bays = 8;
  const fh = 512 / floors;
  const bw = 512 / bays;
  for (let fy = 0; fy < floors; fy++) {
    for (let bx = 0; bx < bays; bx++) {
      const r = hash2(bx * 3.1, fy * 7.3);
      const bright = r > 0.72 ? 'rgba(225, 242, 255, 0.36)' : r < 0.25 ? 'rgba(42, 68, 96, 0.26)' : 'rgba(175, 212, 242, 0.14)';
      gfCtx.fillStyle = bright;
      gfCtx.fillRect(bx * bw + 4, fy * fh + 26, bw - 8, fh - 30);
    }
    // Crisp white brutalist spandrel slab band each floor!
    gfCtx.fillStyle = '#e7ecf2';
    gfCtx.fillRect(0, fy * fh, 512, 24);
    gfCtx.fillStyle = '#b4c0ce';
    gfCtx.fillRect(0, fy * fh + 22, 512, 4);
  }
  // Clean aluminum vertical mullions
  gfCtx.fillStyle = '#cfd8e3';
  for (let bx = 0; bx <= bays; bx++) {
    gfCtx.fillRect(bx * bw - 2, 0, 4, 512);
  }
  const glassTex = finalizeTexture(gfC, true, aniso);

  // 10. Distant Skyline Tower Variant (clean white monolith with subtle window strips)
  const [dtC, dtCtx] = makeCanvas(256, 512);
  dtCtx.fillStyle = '#eef2f7';
  dtCtx.fillRect(0, 0, 256, 512);
  for (let y = 12; y < 512; y += 28) {
    dtCtx.fillStyle = y % 112 === 12 ? '#7a95b0' : '#9bb7d4';
    dtCtx.fillRect(18, y, 220, 12);
  }
  // Vertical white structural piers
  dtCtx.fillStyle = '#f1f5f9';
  dtCtx.fillRect(78, 0, 16, 512);
  dtCtx.fillRect(162, 0, 16, 512);
  const distantTex = finalizeTexture(dtC, true, aniso);

  // 11. Painted Rooftop Runner Guide Strip (subtle red twin stripe + directional arrow)
  const [rgC, rgCtx] = makeCanvas(256, 512);
  rgCtx.fillStyle = '#e4e9ef';
  rgCtx.fillRect(0, 0, 256, 512);
  // Subtle crisp signal-red edge tracks
  rgCtx.fillStyle = '#e52b1e';
  rgCtx.fillRect(10, 0, 14, 512);
  rgCtx.fillRect(232, 0, 14, 512);
  // Forward minimalist chevron in center
  rgCtx.strokeStyle = 'rgba(229, 43, 30, 0.72)';
  rgCtx.lineWidth = 14;
  rgCtx.beginPath();
  rgCtx.moveTo(78, 300);
  rgCtx.lineTo(128, 236);
  rgCtx.lineTo(178, 300);
  rgCtx.stroke();
  const guideTex = finalizeTexture(rgC, true, aniso);

  // 12. Finish Gate Flag / Banner Texture (clean emerald + white high-contrast geometric bars)
  const [fbC, fbCtx] = makeCanvas(128, 512);
  fbCtx.fillStyle = '#10c96f';
  fbCtx.fillRect(0, 0, 128, 512);
  fbCtx.fillStyle = '#ffffff';
  fbCtx.fillRect(0, 48, 128, 28);
  fbCtx.fillRect(0, 92, 128, 12);
  // Checkered finish strip near bottom
  for (let y = 360; y < 456; y += 32) {
    for (let x = 0; x < 128; x += 32) {
      if (((x + y) / 32) % 2 === 0) {
        fbCtx.fillStyle = '#ffffff';
        fbCtx.fillRect(x, y, 32, 32);
      }
    }
  }
  const finishBannerTex = finalizeTexture(fbC, true, aniso);

  // Stencil cache for architectural rooftop sector codes (R-01, A-02, FIN)
  const patchLook = (
    mat: THREE.MeshStandardMaterial,
    kind: 'ao' | 'rim' | 'glass' | 'shaft'
  ): THREE.MeshStandardMaterial => {
    mat.customProgramCacheKey = () => `stride-look-${kind}-v1`;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vStrideW;
          varying vec3 vStrideN;
          `
        )
        .replace(
          '#include <worldpos_vertex>',
          /* glsl */ `
          #include <worldpos_vertex>
          vStrideW = worldPosition.xyz;
          vStrideN = inverseTransformDirection(transformedNormal, viewMatrix);
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vStrideW;
          varying vec3 vStrideN;
          `
        )
        .replace(
          '#include <map_fragment>',
          kind === 'glass' || kind === 'shaft'
            ? /* glsl */ `
#ifdef USE_MAP
  vec3 nw = abs(normalize(vStrideN));
  vec3 nw3 = nw / max(nw.x + nw.y + nw.z, 0.001);
  float tScale = ${kind === 'glass' ? '0.085' : '0.055'};
  vec4 tX = texture2D(map, vStrideW.zy * tScale);
  vec4 tY = texture2D(map, vStrideW.xz * tScale);
  vec4 tZ = texture2D(map, vStrideW.xy * tScale);
  vec4 sampledDiffuseColor = tX * nw3.x + tY * nw3.y + tZ * nw3.z;
  diffuseColor *= sampledDiffuseColor;
#endif
`
            : '#include <map_fragment>'
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            vec3 nW = normalize(vStrideN);
            vec3 viewW = normalize(cameraPosition - vStrideW);
            float nv = 1.0 - abs(dot(nW, viewW));
            ${
              kind === 'ao' || kind === 'shaft'
                ? `
            float ao = 1.0 - 0.24 * pow(1.0 - abs(nW.y), 1.55);
            ao *= mix(1.0, 0.76, smoothstep(0.12, 0.82, -nW.y));
            diffuseColor.rgb *= ao;
            `
                : ''
            }
            ${
              kind === 'rim'
                ? `
            float rim = pow(nv, 3.2);
            diffuseColor.rgb += vec3(1.0, 0.16, 0.07) * rim * 0.55;
            `
                : ''
            }
            ${
              kind === 'glass'
                ? `
            float fres = pow(nv, 2.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.90, 1.0), fres * 0.42);
            vec2 cell = floor(vec2(vStrideW.x, vStrideW.y) * 0.42);
            float lit = step(0.68, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
            diffuseColor.rgb += vec3(1.0, 0.86, 0.58) * lit * 0.09 * (1.0 - fres);
            `
                : ''
            }
          }
          `
        );
    };
    return mat;
  };

  const stencilCache = new Map<string, THREE.CanvasTexture>();
  const makeStencilTexture = (label: string): THREE.CanvasTexture => {
    const existing = stencilCache.get(label);
    if (existing) return existing;
    const [c, ctx] = makeCanvas(512, 256);
    ctx.clearRect(0, 0, 512, 256);
    // Sharp athletic brutalist border slash + stencil code
    ctx.fillStyle = 'rgba(229, 43, 30, 0.85)';
    ctx.fillRect(24, 48, 16, 160);
    ctx.fillStyle = 'rgba(30, 38, 48, 0.72)';
    ctx.font = '800 132px "Barlow Condensed", "DIN Alternate", "Bahnschrift", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 62, 132);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    stencilCache.set(label, tex);
    return tex;
  };

  return {
    roofTop: patchLook(
      new THREE.MeshStandardMaterial({
        map: roofTex,
        bumpMap: concreteBump,
        bumpScale: 0.018,
        roughness: 0.82,
        metalness: 0.02,
      }),
      'ao'
    ),
    whiteConcrete: patchLook(
      new THREE.MeshStandardMaterial({
        map: whiteConcreteTex,
        bumpMap: concreteBump,
        bumpScale: 0.02,
        roughness: 0.78,
        metalness: 0.02,
      }),
      'ao'
    ),
    darkConcrete: patchLook(
      new THREE.MeshStandardMaterial({
        map: darkConcreteTex,
        bumpMap: concreteBump,
        bumpScale: 0.025,
        roughness: 0.85,
        metalness: 0.05,
      }),
      'ao'
    ),
    runnerRed: patchLook(
      new THREE.MeshStandardMaterial({
        map: runnerRedTex,
        roughness: 0.42,
        metalness: 0.08,
      }),
      'rim'
    ),
    runnerChevron: patchLook(
      new THREE.MeshStandardMaterial({
        map: chevronTex,
        roughness: 0.4,
        metalness: 0.08,
      }),
      'rim'
    ),
    wallRunRed: patchLook(
      new THREE.MeshStandardMaterial({
        map: wallRunTex,
        roughness: 0.46,
        metalness: 0.06,
      }),
      'rim'
    ),
    slideHazard: patchLook(
      new THREE.MeshStandardMaterial({
        map: slideTex,
        roughness: 0.48,
        metalness: 0.14,
      }),
      'rim'
    ),
    slideChute: patchLook(
      new THREE.MeshStandardMaterial({
        map: slideChuteTex,
        roughness: 0.35,
        metalness: 0.06,
      }),
      'ao'
    ),
    catwalk: patchLook(
      new THREE.MeshStandardMaterial({
        color: '#e52b1e',
        roughness: 0.36,
        metalness: 0.25,
      }),
      'rim'
    ),
    glassFacade: patchLook(
      new THREE.MeshStandardMaterial({
        map: glassTex,
        roughness: 0.18,
        metalness: 0.55,
        envMapIntensity: 1.25,
      }),
      'glass'
    ),
    distantTowerA: patchLook(
      new THREE.MeshStandardMaterial({
        map: distantTex,
        roughness: 0.55,
        metalness: 0.12,
      }),
      'shaft'
    ),
    distantTowerB: new THREE.MeshStandardMaterial({
      color: '#dce7f3',
      roughness: 0.65,
      metalness: 0.08,
    }),
    brushedMetal: new THREE.MeshStandardMaterial({
      color: '#c2cbd4',
      roughness: 0.36,
      metalness: 0.62,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: '#262d36',
      roughness: 0.44,
      metalness: 0.58,
    }),
    grappleAmber: new THREE.MeshStandardMaterial({
      color: '#ff9c08',
      emissive: '#ff7700',
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.35,
    }),
    grappleGlow: new THREE.MeshBasicMaterial({
      color: '#ffb830',
      transparent: true,
      opacity: 0.85,
    }),
    launchCyan: new THREE.MeshBasicMaterial({
      color: '#2cd8ff',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
    checkpointIdle: new THREE.MeshBasicMaterial({
      color: '#12d976',
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    checkpointHit: new THREE.MeshBasicMaterial({
      color: '#b8ffda',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    finishGlow: new THREE.MeshBasicMaterial({
      color: '#14e07c',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    finishBanner: new THREE.MeshStandardMaterial({
      map: finishBannerTex,
      roughness: 0.6,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    runnerGuide: new THREE.MeshStandardMaterial({
      map: guideTex,
      roughness: 0.65,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    makeStencilTexture,
  };
}

/**
 * Create a BoxGeometry with world-scale UVs so concrete tiles, windows,
 * and wall-run panels NEVER stretch regardless of box dimensions!
 * Three.js BoxGeometry face order: +X(0), -X(1), +Y(2), -Y(3), +Z(4), -Z(5).
 */
export function createWorldBoxGeometry(
  w: number,
  h: number,
  d: number,
  tileU = 4,
  tileV = 4
): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;

  // Dimensions (uSpan, vSpan) per face pair:
  // Face 0,1 (+X,-X): d x h
  // Face 2,3 (+Y,-Y): w x d
  // Face 4,5 (+Z,-Z): w x h
  const faceSpans: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];

  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceSpans[f];
    const ru = su / tileU;
    const rv = sv / tileV;
    const base = f * 4;
    for (let k = 0; k < 4; k++) {
      const idx = base + k;
      uv.setXY(idx, uv.getX(idx) * ru, uv.getY(idx) * rv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Create a crisp right-triangle wedge geometry centered in XZ with bottom at y=0
 * rising to y=h toward `dir`, with clean UVs orienting chevrons straight uphill!
 */
export function createRampGeometry(
  w: number,
  h: number,
  d: number,
  dir: RampDir,
  isRedRamp: boolean
): THREE.BufferGeometry {
  const hx = w * 0.5;
  const hz = d * 0.5;

  // Compute height at each of the 4 top corners:
  // c00=(-hx,-hz), c10=(+hx,-hz), c11=(+hx,+hz), c01=(-hx,+hz)
  const yAt = (x: number, z: number): number => {
    if (dir === '-z') return z < 0 ? h : 0;
    if (dir === '+z') return z > 0 ? h : 0;
    if (dir === '+x') return x > 0 ? h : 0;
    return x < 0 ? h : 0;
  };

  // Bottom 4 corners (y = 0)
  const b0: [number, number, number] = [-hx, 0, -hz];
  const b1: [number, number, number] = [hx, 0, -hz];
  const b2: [number, number, number] = [hx, 0, hz];
  const b3: [number, number, number] = [-hx, 0, hz];

  // Slope 4 corners (low corners coincide with bottom corners)
  const t0: [number, number, number] = [-hx, yAt(-hx, -hz), -hz];
  const t1: [number, number, number] = [hx, yAt(hx, -hz), -hz];
  const t2: [number, number, number] = [hx, yAt(hx, hz), hz];
  const t3: [number, number, number] = [-hx, yAt(-hx, hz), hz];

  const positions: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number]
  ) => {
    positions.push(...a, ...b, ...c);
    uvs.push(...ua, ...ub, ...uc);
  };

  // Order slope quad [lowLeft, lowRight, highRight, highLeft] so UV +V ALWAYS points uphill!
  let lowL: [number, number, number];
  let lowR: [number, number, number];
  let highR: [number, number, number];
  let highL: [number, number, number];
  const run = dir === '+x' || dir === '-x' ? w : d;
  const vRepeat = isRedRamp ? Math.max(1, Math.round(run / 5)) : run / 4;

  if (dir === '-z') {
    lowL = t3;
    lowR = t2;
    highR = t1;
    highL = t0;
  } else if (dir === '+z') {
    lowL = t1;
    lowR = t0;
    highR = t3;
    highL = t2;
  } else if (dir === '+x') {
    lowL = t0;
    lowR = t3;
    highR = t2;
    highL = t1;
  } else {
    // '-x'
    lowL = t2;
    lowR = t1;
    highR = t0;
    highL = t3;
  }

  // Top slope face (CCW facing upward!)
  pushTri(lowL, lowR, highR, [0, 0], [1, 0], [1, vRepeat]);
  pushTri(lowL, highR, highL, [0, 0], [1, vRepeat], [0, vRepeat]);

  // Helper for vertical faces (skip degenerate 0-height low face)
  const pushWallQuad = (
    bl: [number, number, number],
    br: [number, number, number],
    tr: [number, number, number],
    tl: [number, number, number]
  ) => {
    if (tl[1] < 1e-4 && tr[1] < 1e-4) return;
    if (tl[1] < 1e-4) {
      // Triangle (bl, br, tr)
      pushTri(bl, br, tr, [0, 0], [1, 0], [1, 1]);
    } else if (tr[1] < 1e-4) {
      // Triangle (bl, br, tl)
      pushTri(bl, br, tl, [0, 0], [1, 0], [0, 1]);
    } else {
      // Full high back face
      pushTri(bl, br, tr, [0, 0], [1, 0], [1, 1]);
      pushTri(bl, tr, tl, [0, 0], [1, 1], [0, 1]);
    }
  };

  // -Z face (outward normal 0,0,-1): looking from -Z, left=+X (b1), right=-X (b0)
  pushWallQuad(b1, b0, t0, t1);
  // +Z face (outward normal 0,0,+1): left=-X (b3), right=+X (b2)
  pushWallQuad(b3, b2, t2, t3);
  // +X face (outward normal +1,0,0): left=+Z (b2), right=-Z (b1)
  pushWallQuad(b2, b1, t1, t2);
  // -X face (outward normal -1,0,0): left=-Z (b0), right=+Z (b3)
  pushWallQuad(b0, b3, t3, t0);
  // Bottom face (outward normal 0,-1,0)
  pushTri(b0, b1, b2, [0, 0], [1, 0], [1, 1]);
  pushTri(b0, b2, b3, [0, 0], [1, 1], [0, 1]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}
